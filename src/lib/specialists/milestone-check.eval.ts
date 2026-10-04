import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { createAnthropic } from "@ai-sdk/anthropic";
import { generateText, Output, tool, type ModelMessage } from "ai";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { GoalBriefSchema } from "@/lib/goals/schema";

import { assessmentAccepted, checkSubmission, incompleteReply, submissionSchema } from "./assessment";
import { ASSESSOR_SKILL } from "./assessor.generated";
import { milestoneCheckContext, type CheckSkill } from "./milestone-check";
import { PlanSchema, type AssessedSkill } from "./schemas";

const anthropic = createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const OUT = path.resolve(__dirname, "../../../skills/specialists-workspace", `milestone-check-${new Date().toISOString().slice(0, 16).replace(":", "")}`);
const read = (s: string) => JSON.parse(readFileSync(path.join(__dirname, "fixtures", `marketing-ops-to-data-analyst.${s}.json`), "utf8"));

/** Maya just finished her first SQL milestone; she really is at "with help" now. */
async function runCheck() {
  const brief = GoalBriefSchema.parse(read("brief"));
  const plan = PlanSchema.parse(read("plan"));
  const milestone = plan.milestones[0]!;
  const skills: CheckSkill[] = milestone.skills.map((s) => ({ skillId: s.skillId, name: "SQL querying", current: 0, toLevel: s.toLevel }));
  const ids = skills.map((s) => s.skillId) as [string, ...string[]];
  let results: AssessedSkill[] | undefined;
  const submit = tool({
    description: "Record the level each checked skill showed. Call once, after the last skill.",
    inputSchema: submissionSchema(ids),
    strict: true,
    execute: async (input) => {
      const check = checkSubmission(input.results, ids);
      if (!check.ok) return incompleteReply(check.missing);
      results = check.results;
      return { status: "saved" as const };
    },
  });
  const learnerSystem = `You are Maya, a marketing ops coordinator who just finished her first SQL milestone in a learning app: rebuilding her leads-by-source pivot table as a query. You can now write SELECT ... FROM ... WHERE ... GROUP BY with COUNT on your own, but you sometimes forget that every non-aggregated column in SELECT must be in GROUP BY. You haven't learned joins yet. When asked to write something, write it, in 1 to 4 lines. Reply briefly, like someone typing after work.`;
  const tutor: ModelMessage[] = [{ role: "user", content: "I'm ready." }];
  const learner: ModelMessage[] = [{ role: "assistant", content: "I'm ready." }];
  const log: { role: string; text: string }[] = [];
  for (let turn = 0; turn < 6 && !results; turn++) {
    const r = await generateText({
      model: anthropic("claude-sonnet-5"),
      instructions: `${ASSESSOR_SKILL}\n\n${milestoneCheckContext(brief, milestone, skills)}`,
      messages: tutor,
      tools: { submit_assessment: submit },
      stopWhen: assessmentAccepted,
      abortSignal: AbortSignal.timeout(120_000),
    });
    tutor.push(...r.response.messages);
    const text = r.steps.map((s) => s.text).join("\n").trim();
    log.push({ role: "assessor", text });
    if (results) break;
    learner.push({ role: "user", content: text });
    const reply = await generateText({ model: anthropic("claude-sonnet-5"), instructions: learnerSystem, messages: learner, abortSignal: AbortSignal.timeout(120_000) });
    learner.push({ role: "assistant", content: reply.text });
    tutor.push({ role: "user", content: reply.text });
    log.push({ role: "learner", text: reply.text });
  }
  mkdirSync(OUT, { recursive: true });
  writeFileSync(path.join(OUT, "maya-sql.json"), JSON.stringify({ results, log }, null, 2));
  return { results, log };
}

describe("milestone check", () => {
  it("Maya after her first SQL milestone: a short, practical, warm check that finds 'with help'", async () => {
    const { results, log } = await runCheck();
    expect(results, "submitted").toBeDefined();
    expect(results![0]!.level, "she's at with help now").toBe(2);
    expect(log.filter((l) => l.role === "assessor").length, "short: a few turns").toBeLessThanOrEqual(4);
    const transcript = log.map((l) => `${l.role.toUpperCase()}: ${l.text}`).join("\n\n");
    const { output } = await generateText({
      model: anthropic("claude-opus-5-5"),
      instructions: "You grade a learning app's post-milestone skills check. For each assertion, decide strictly whether it holds, citing brief evidence.",
      prompt: `Transcript:\n\n${transcript}\n\nAssertions:\n0. It opens by warmly naming the milestone she just finished\n1. It asks her to do a small practical task (such as writing a query), not to describe or define\n2. It doesn't teach or correct her answers during the check\n3. It closes by naming something specific she did well in this check (not just generic praise like "nice work"), without stating levels, scores or numbers`,
      output: Output.object({ schema: z.object({ results: z.array(z.object({ index: z.number(), passed: z.boolean(), evidence: z.string() })) }) }),
      abortSignal: AbortSignal.timeout(180_000),
    });
    const failed = output.results.filter((r) => !r.passed);
    expect(failed, JSON.stringify(failed, null, 2)).toEqual([]);
  }, 600_000);
});

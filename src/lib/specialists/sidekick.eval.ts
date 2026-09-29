import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { createAnthropic } from "@ai-sdk/anthropic";
import { generateText, Output } from "ai";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { GoalBriefSchema } from "@/lib/goals/schema";

import { PlanSchema } from "./schemas";
import { sidekickContext, summarizeSidekick } from "./sidekick";
import { SIDEKICK_SKILL } from "./sidekick.generated";

vi.mock("@/lib/ai/usage-events", () => ({ captureAiGeneration: async () => {} }));

// Same tier as the router's sidekick_answer route.
const anthropic = createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const OUT = path.resolve(__dirname, "../../../skills/specialists-workspace", `sidekick-${new Date().toISOString().slice(0, 16).replace(":", "")}`);
const read = (s: string) => JSON.parse(readFileSync(path.join(__dirname, "fixtures", `marketing-ops-to-data-analyst.${s}.json`), "utf8"));
const brief = GoalBriefSchema.parse(read("brief"));
const plan = PlanSchema.parse(read("plan"));
const ui = (role: string, text: string) => ({ role, parts: [{ type: "text", text }] });
const lesson = [
  ui("assistant", "Your leads table has one row per lead. Write a query that counts leads per source: SELECT lead_source, COUNT(*) FROM leads …"),
  ui("user", "hmm ok, do I need GROUP BY for that?"),
  ui("assistant", "Yes. Finish the query with GROUP BY and run it. Paste what you get."),
];

async function answer(name: string, question: string) {
  const { text } = await generateText({
    model: anthropic("claude-haiku-4-5"),
    instructions: `${SIDEKICK_SKILL}\n\n${sidekickContext({ brief, plan, milestoneIndex: 0, lesson })}`,
    prompt: question,
    maxOutputTokens: 600,
    abortSignal: AbortSignal.timeout(60_000),
  });
  mkdirSync(OUT, { recursive: true });
  writeFileSync(path.join(OUT, `${name}.json`), JSON.stringify({ question, text }, null, 2));
  return text;
}

async function judge(question: string, text: string, assertions: string[]) {
  const { output } = await generateText({
    model: anthropic("claude-opus-5-5"),
    instructions: "You grade answers from a learning app's side panel for quick questions. For each assertion, decide strictly whether it holds, citing brief evidence.",
    prompt: `The learner is a marketing ops coordinator (Excel, HubSpot) learning SQL. Mid-lesson, the tutor had just asked them to finish a query counting leads per source with GROUP BY. In the side panel they asked: "${question}"\n\nAnswer:\n${text}\n\nAssertions:\n${assertions.map((a, i) => `${i}. ${a}`).join("\n")}`,
    output: Output.object({ schema: z.object({ results: z.array(z.object({ index: z.number(), passed: z.boolean(), evidence: z.string() })) }) }),
    abortSignal: AbortSignal.timeout(120_000),
  });
  const failed = assertions.map((a, i) => ({ a, ...output.results.find((r) => r.index === i) })).filter((r) => !r.passed);
  expect(failed, JSON.stringify(failed, null, 2)).toEqual([]);
}

describe.concurrent("sidekick", () => {
  it("explains a term briefly, in her world, without taking over the lesson", async () => {
    const q = "wait what does GROUP BY actually do? is it like a pivot table?";
    const text = await answer("term", q);
    expect(text.split(/\s+/).length, "short").toBeLessThanOrEqual(160);
    await judge(q, text, [
      "It answers what GROUP BY does in plain words",
      "It uses an example or comparison from her world (pivot tables, leads, campaigns, HubSpot or Excel)",
      "It doesn't set a new exercise, quiz her, or move the lesson on",
    ]);
  });

  it("doesn't hand over the exercise's answer; points back to the tutor", async () => {
    const q = "can you just write the full query for me so I can paste it in the lesson?";
    const text = await answer("exercise", q);
    await judge(q, text, [
      "It doesn't give the complete finished query for the exercise",
      "It kindly encourages her to try it in the lesson, where the tutor can help, possibly with a small hint",
      "It doesn't lecture or scold",
    ]);
  });

  it("summarizes for the tutor: the term, the skill, and that she struggled", async () => {
    const chat = [
      ui("user", "what's the difference between WHERE and HAVING"),
      ui("assistant", "WHERE filters rows before grouping; HAVING filters the groups after. Like filtering your raw leads vs filtering the pivot's totals."),
      ui("user", "i don't get it, so which one do I use for sources with more than 50 leads??"),
      ui("assistant", "That's filtering the totals, so HAVING: HAVING COUNT(*) > 50."),
      ui("user", "ok wait so WHERE can't see the count at all?"),
      ui("assistant", "Right: WHERE runs before the counting happens, so the count doesn't exist yet."),
    ];
    const s = (await summarizeSidekick(chat, ["sql-querying", "spreadsheets"], "eval", { domains: ["data analysis"], goal: "Data analyst (B2B SaaS)" }))!;
    mkdirSync(OUT, { recursive: true });
    writeFileSync(path.join(OUT, "summary.json"), JSON.stringify(s, null, 2));
    expect(s.skillId).toBe("sql-querying");
    expect(s.term).toMatch(/HAVING|WHERE/i);
    expect(s.definition).toBeTruthy();
    expect(s.struggled).toBe(true);
    expect(s.domain, "reuses the glossary's field").toBe("data analysis");
    // With an empty glossary, the field comes from their goal, not the skill's name.
    const fresh = (await summarizeSidekick(chat, ["sql-querying"], "eval", { domains: [], goal: "Data Analyst (B2B SaaS)" }))!;
    expect(fresh.domain).toMatch(/^data analy/);
  });
});

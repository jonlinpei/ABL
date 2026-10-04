import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { createAnthropic } from "@ai-sdk/anthropic";
import { generateText, Output } from "ai";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { GoalBriefSchema } from "@/lib/goals/schema";

import { GapSchema, PlanSchema } from "./schemas";
import { draftSideQuest, type SideQuestDraft } from "./side-quest";

vi.mock("@/lib/ai/usage-events", () => ({ captureAiGeneration: async () => {} }));

const anthropic = createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const OUT = path.resolve(__dirname, "../../../skills/specialists-workspace", `side-quest-${new Date().toISOString().slice(0, 16).replace(":", "")}`);
const read = (s: string) => JSON.parse(readFileSync(path.join(__dirname, "fixtures", `marketing-ops-to-data-analyst.${s}.json`), "utf8"));
const brief = GoalBriefSchema.parse(read("brief"));
const plan = PlanSchema.parse(read("plan"));
const gap = GapSchema.parse(read("specialists").gap);

async function draft(name: string, topic: string) {
  const d = await draftSideQuest({ brief, plan, milestoneIndex: 1, gap, topic }, "eval");
  mkdirSync(OUT, { recursive: true });
  writeFileSync(path.join(OUT, `${name}.json`), JSON.stringify({ topic, d }, null, 2));
  return d;
}

async function judge(topic: string, d: SideQuestDraft, assertions: string[]) {
  const { output } = await generateText({
    model: anthropic("claude-opus-5-5"),
    instructions: "You grade side quests drafted by a learning app. For each assertion, decide strictly whether it holds, citing brief evidence.",
    prompt: `Learner: marketing ops coordinator working toward a data analyst role in B2B SaaS; on milestone 2 of a SQL-first roadmap (${plan.milestones.map((m) => m.title).join("; ")}).\nTopic they asked to explore: "${topic}"\n\nDraft:\n${JSON.stringify(d, null, 2)}\n\nAssertions:\n${assertions.map((a, i) => `${i}. ${a}`).join("\n")}`,
    output: Output.object({ schema: z.object({ results: z.array(z.object({ index: z.number(), passed: z.boolean(), evidence: z.string() })) }) }),
    abortSignal: AbortSignal.timeout(120_000),
  });
  const failed = output.results.filter((r) => !r.passed);
  expect(failed, JSON.stringify(failed, null, 2)).toEqual([]);
}

describe.concurrent("side quest drafts", () => {
  it("Python, while learning SQL: shaped to what an analyst uses, small, honest about the connection", async () => {
    const d = await draft("python", "I keep hearing analysts use Python, can I try it?");
    expect(d.sessions).toBeGreaterThanOrEqual(1);
    expect(d.sessions).toBeLessThanOrEqual(4);
    expect(["core", "related"]).toContain(d.relevance);
    await judge("I keep hearing analysts use Python, can I try it?", d, [
      "The outline is the slice of Python a data analyst would use (e.g. pandas on data like hers), not general programming",
      "The why connects it to her data analyst goal honestly, without overstating it as required",
      "It fits in the stated number of sessions; it isn't a second roadmap",
    ]);
  });

  it("a milestone already ahead: says so and keeps it to a short preview", async () => {
    const ahead = plan.milestones.slice(2).map((m) => m.title).join("; ");
    const d = await draft("ahead", "Can I get a head start on window functions?");
    expect(d.sessions).toBeLessThanOrEqual(2);
    await judge("Can I get a head start on window functions?", d, [
      `The why mentions that this is already coming up in her roadmap (milestones ahead: ${ahead})`,
      "It's scoped as a short preview rather than the full topic",
    ]);
  });

  it("an off-path interest: marked a tangent, kindly", async () => {
    const d = await draft("tangent", "I want to learn to make sourdough bread");
    expect(d.relevance).toBe("tangent");
    await judge("I want to learn to make sourdough bread", d, ["The why is kind and honest that it's not part of her career goal, without lecturing"]);
  });
});

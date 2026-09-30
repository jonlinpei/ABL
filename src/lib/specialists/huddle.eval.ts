import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { createAnthropic } from "@ai-sdk/anthropic";
import { generateText, Output } from "ai";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { GoalBriefSchema } from "@/lib/goals/schema";

import { effectiveBrief, runHuddle } from "./huddle";
import { applyMasteryToGap } from "./mastery";
import { checkPlan } from "./plan-checks";
import { GapSchema, PlanSchema, type SessionReport } from "./schemas";

vi.mock("@/lib/ai/usage-events", () => ({ captureAiGeneration: async () => {} }));

const anthropic = createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const OUT = path.resolve(__dirname, "../../../skills/specialists-workspace", `huddle-${new Date().toISOString().slice(0, 16).replace(":", "")}`);
const read = (s: string) => JSON.parse(readFileSync(path.join(__dirname, "fixtures", `marketing-ops-to-data-analyst.${s}.json`), "utf8"));

describe("replan huddle", () => {
  it("reworks Maya's plan around 2 hours a week in 30-minute sessions after a new job", async () => {
    const brief = GoalBriefSchema.parse(read("brief"));
    const plan = PlanSchema.parse(read("plan"));
    // She finished milestone 1 (SQL to level 1) in sessions.
    const sql = { skillId: "sql-querying", name: "SQL querying", level: 1, evidence: [], card: {} as never };
    const gap = applyMasteryToGap(GapSchema.parse(read("specialists").gap), [sql]);
    const report = (recap: string, done = false): SessionReport => ({
      summary: "s", recap, covered: [], evidence: [], homework: null, milestoneComplete: done, endedEarly: false,
    });
    const sessions = [
      { endedAt: new Date("2026-10-05T20:00:00Z"), report: report("You set up your practice database.") },
      { endedAt: new Date("2026-10-08T20:00:00Z"), report: report("You rebuilt your leads-by-source pivot in SQL.", true) },
    ];
    const request = { weeklyHours: 2, sessionMinutes: 30, deadline: null, note: "Started a new job. Evenings are unpredictable now, I can do shorter sessions." };

    const started = Date.now();
    const out = await runHuddle({
      brief, gap, plan, milestoneIndex: 1, sessions, mastery: [sql],
      signals: [{ kind: "missed_sessions", daysSinceLast: 24, expectedPerWeek: 4, lapsed: true }],
      request, source: "learner", reason: "The learner asked to rework their plan.", userId: "eval", today: "2026-11-01",
    });
    mkdirSync(OUT, { recursive: true });
    writeFileSync(path.join(OUT, "maya-new-job.json"), JSON.stringify({ ...out, seconds: (Date.now() - started) / 1000 }, null, 2));
    console.error(`HUDDLE ${Math.round((Date.now() - started) / 1000)}s: ${out.messages.map((m) => `${m.from}:${m.kind}`).join(" → ")}`);

    const r = out.replan;
    expect(r.weeklyHours).toBeLessThanOrEqual(2);
    expect(r.sessionMinutes).toBeLessThanOrEqual(30);
    expect(r.firstSession.minutes).toBeLessThanOrEqual(30);
    expect(checkPlan(r, gap, effectiveBrief(brief, plan, request)).filter((i) => i.severity === "must_fix")).toEqual([]);
    expect(r.milestones.map((m) => m.title).join(" | "), "doesn't repeat the finished pivot milestone").not.toMatch(/pivot/i);
    expect(r.whatChanged.length).toBeGreaterThanOrEqual(2);
    expect(r.whatChanged.length).toBeLessThanOrEqual(6);
    expect(r.changeSummary.split(/\s+/).length, "a one-line summary").toBeLessThanOrEqual(40);

    const { output } = await generateText({
      model: anthropic("claude-opus-5-5"),
      instructions: "You grade a learning app's revised plan. For each assertion, decide strictly whether it holds, citing brief evidence.",
      prompt: `Original plan:\n${JSON.stringify({ title: plan.title, weeklyHours: plan.weeklyHours, sessionMinutes: plan.sessionMinutes, milestones: plan.milestones.map((m) => ({ title: m.title, weeks: m.weeks, project: m.project })) }, null, 2)}\n\nThe learner (goal: ${brief.restatedGoal}; deadline: ${brief.deadline}) finished milestone 1, then asked: ${JSON.stringify(request)}\n\nRevised plan:\n${JSON.stringify(r, null, 2)}\n\nAssertions:\n0. The whatChanged items explain real changes in plain words to the learner, each with a reason tied to her new situation\n1. deadlineFit is honest about whether her deadline still works at 2 hours a week, and says what would help if it doesn't\n2. The revised plan keeps the original plan's portfolio projects (or clear equivalents); if it drops any, whatChanged says so plainly with the reason, and nothing else in the plan claims otherwise\n3. The first session is an easy, short restart after a break\n4. changeSummary is one plain sentence to her that fairly sums up what the new plan changes and why`,
      output: Output.object({ schema: z.object({ results: z.array(z.object({ index: z.number(), passed: z.boolean(), evidence: z.string() })) }) }),
      abortSignal: AbortSignal.timeout(180_000),
    });
    const failed = output.results.filter((x) => !x.passed);
    expect(failed, JSON.stringify(failed, null, 2)).toEqual([]);
  }, 600_000);
});

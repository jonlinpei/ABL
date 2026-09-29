import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { createAnthropic } from "@ai-sdk/anthropic";
import { generateText, Output } from "ai";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { GoalBriefSchema } from "@/lib/goals/schema";

import { coachContext, decide, type CoachDecision } from "./coach";
import { PlanSchema, type SessionReport } from "./schemas";
import type { Signal } from "./signals";

vi.mock("@/lib/ai/usage-events", () => ({ captureAiGeneration: async () => {} }));

const anthropic = createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const TODAY = "2026-11-01";
const OUT = path.resolve(__dirname, "../../../skills/specialists-workspace", `coach-${new Date().toISOString().slice(0, 16).replace(":", "")}`);
const read = (s: string) => JSON.parse(readFileSync(path.join(__dirname, "fixtures", `marketing-ops-to-data-analyst.${s}.json`), "utf8"));
const brief = GoalBriefSchema.parse(read("brief"));
const plan = PlanSchema.parse(read("plan"));

const recap = (text: string, daysAgo: number): { endedAt: Date; report: SessionReport } => ({
  endedAt: new Date(new Date(`${TODAY}T12:00:00Z`).getTime() - daysAgo * 86_400_000),
  report: { summary: "s", recap: text, covered: [], evidence: [], homework: null, milestoneComplete: false, endedEarly: false },
});

async function run(name: string, signals: Signal[], sessions: { endedAt: Date; report: SessionReport }[]) {
  const context = coachContext({ brief, plan, milestoneIndex: 1, signals, recentSessions: sessions, notes: [], allowCheckIn: true, today: TODAY });
  const decision = await decide(context, true, "eval");
  mkdirSync(OUT, { recursive: true });
  writeFileSync(path.join(OUT, `${name}.json`), JSON.stringify({ signals, decision }, null, 2));
  return decision;
}

async function judge(decision: CoachDecision, situation: string, assertions: string[]) {
  const { output } = await generateText({
    model: anthropic("claude-opus-5-5"),
    instructions: "You grade decisions from a learning app's coach. For each assertion, decide strictly whether it holds, citing brief evidence.",
    prompt: `Situation: ${situation}\n\nLearner background: tried before: ${brief.pastAttempts}. Goal: ${brief.restatedGoal}\n\nCoach decision:\n${JSON.stringify(decision, null, 2)}\n\nAssertions:\n${assertions.map((a, i) => `${i}. ${a}`).join("\n")}`,
    output: Output.object({ schema: z.object({ results: z.array(z.object({ index: z.number(), passed: z.boolean(), evidence: z.string() })) }) }),
    abortSignal: AbortSignal.timeout(180_000),
  });
  const failed = assertions.map((a, i) => ({ a, ...output.results.find((r) => r.index === i) })).filter((r) => !r.passed);
  expect(failed, JSON.stringify(failed, null, 2)).toEqual([]);
}

describe.concurrent("coach decisions", () => {
  it("postings now screen for Python, which her plan doesn't teach: tells her and suggests a rework", async () => {
    const d = await run(
      "requirements-changed",
      [{ kind: "requirements_changed", nowMustHave: ["Python for data analysis"], noLongerMustHave: ["Advanced spreadsheets"] }],
      [recap("You wrote joins across two tables.", 2)],
    );
    expect(d.message).not.toBeNull();
    expect(d.suggestReplan).toBe(true);
    await judge(d, "ABL re-checked current job postings for her target: most now ask for Python, which her plan doesn't teach, and advanced spreadsheets became optional. She's on track otherwise; her last session, two days ago (Friday), was on joins across two tables.", [
      "The message says what changed (Python is now widely asked for; spreadsheets less so) and that it comes from current job postings",
      "It frames the change calmly as keeping her plan aimed at what employers want now, not as a setback or cause for alarm",
      "It offers reworking the plan as a next step",
      "It doesn't invent facts, such as specific companies, numbers of postings or dates",
    ]);
  });

  it("a skill she hasn't started became optional: good news, no rework pushed", async () => {
    const d = await run(
      "requirements-easier",
      [{ kind: "requirements_changed", nowMustHave: [], noLongerMustHave: ["dbt for SQL transformations"] }],
      [recap("You wrote joins across two tables.", 2)],
    );
    expect(d.suggestReplan).toBe(false);
    if (d.message) {
      await judge(d, "Current job postings for her target ask for dbt less often, so it became optional. She's on track; her last session, two days ago, was on joins.", [
        "The message presents it as good news or neutral, not a problem",
        "It doesn't push her to change her plan",
      ]);
    }
  });

  it("missed 9 days, having quit at week three before: a short, warm check-in with a light option", async () => {
    const d = await run(
      "missed",
      [{ kind: "missed_sessions", daysSinceLast: 9, expectedPerWeek: 4, lapsed: false }],
      [recap("You rebuilt your leads-by-source pivot table in SQL.", 9)],
    );
    expect(d.message, "checks in").not.toBeNull();
    expect(d.message!.split(/\s+/).length, "under ~80 words").toBeLessThanOrEqual(90);
    expect(d.options.length).toBeGreaterThanOrEqual(2);
    expect(d.suggestReplan).toBe(false);
    await judge(d, "No session for 9 days; the plan expects 4 a week.", [
      "The message has no guilt, blame, drama or empty cheerleading",
      "It refers to something specific: what she last did, her goal, or her history of stopping when work got busy",
      "At least one option is a small, low-effort way to restart (for example a short session this week)",
    ]);
  });

  it("lapsed nearly three weeks with a projected finish well past her deadline: suggests a replan", async () => {
    const d = await run(
      "lapsed",
      [
        { kind: "missed_sessions", daysSinceLast: 19, expectedPerWeek: 4, lapsed: true },
        { kind: "behind_pace", sessionsPerWeek: 0.5, expectedPerWeek: 4, projectedFinish: "2029-03-01", plannedFinish: "2027-06-15" },
      ],
      [recap("You wrote joins across two tables.", 19)],
    );
    expect(d.suggestReplan).toBe(true);
    expect(d.message).not.toBeNull();
    await judge(d, "No session for 19 days; at recent pace she'd finish in March 2029 instead of June 2027, past her fall 2027 goal.", [
      "The message makes restarting feel normal and small, without guilt",
      "The message is honest that the current plan no longer fits, or offers to rework it, rather than pretending all is well",
    ]);
  });

  it("a topic that isn't sticking, otherwise on track: a specific tutor note, no message", async () => {
    const d = await run(
      "stuck",
      [{ kind: "stuck_topic", skillId: "sql-querying", name: "SQL querying: joins, aggregations, CTEs, subqueries and window functions", sessionsOnMilestone: 4, level: 1, toLevel: 2 }],
      [recap("You practised LEFT JOINs but mixed up which table keeps its rows.", 1), recap("You wrote your first INNER JOIN with help.", 3)],
    );
    expect(d.tutorNote, "leaves the tutor a note").not.toBeNull();
    expect(d.suggestReplan).toBe(false);
    await judge(d, "Four sessions on the joins milestone and SQL hasn't moved from level 1; she attends regularly.", [
      "The tutor note names a specific, different way to teach joins (for example a new example from her own marketing data, smaller steps, or checking a prerequisite), not generic advice",
      "The coach does not send the learner a message about being stuck, or if it does, it's encouraging and doesn't make her feel judged",
    ]);
  });
});

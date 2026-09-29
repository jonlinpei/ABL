import { beforeEach, describe, expect, it, vi } from "vitest";

import { sampleBrief } from "@/lib/goals/test-fixtures";

const generateStructured = vi.fn();
vi.mock("@/lib/ai/structured", () => ({ generateStructured: (...a: unknown[]) => generateStructured(...a) }));

const { effectiveBrief, masteryInput, requirementsInput, runHuddle } = await import("./huddle");
const { computeGap } = await import("./gap");
const { applyMasteryToGap } = await import("./mastery");
const { samplePlan, sampleProfile, sampleRequirements } = await import("./test-fixtures");

const gap = computeGap(sampleRequirements, sampleProfile);
const replan = { ...samplePlan, whatChanged: [{ change: "Sessions are 30 minutes", because: "Evenings are tight" }] };
const coachInput = { engagement: "Two short sessions a week.", mustRespect: ["30 minutes max"] };
const noObjection = { objection: null, severity: null };
const approve = { verdict: "approve", issues: [] };
const request = { weeklyHours: 2, sessionMinutes: 30, deadline: null, note: "New job" };

/** Replies to each model call in order, by task. */
function reply(...outputs: unknown[]) {
  generateStructured.mockReset();
  for (const o of outputs) generateStructured.mockResolvedValueOnce({ output: o });
}
const huddle = (over = {}) =>
  runHuddle({
    brief: sampleBrief, gap, plan: samplePlan, milestoneIndex: 1, sessions: [], mastery: [], signals: [],
    request, source: "learner", reason: "asked", userId: "u", today: "2026-11-01", ...over,
  });

beforeEach(() => generateStructured.mockReset());

describe("runHuddle", () => {
  it("collects inputs, proposes, takes objections and decides, logging each step", async () => {
    reply(coachInput, { ...replan, weeklyHours: 2, sessionMinutes: 30 }, approve, noObjection);
    const out = await huddle();
    expect(out.messages.map((m) => `${m.from}:${m.kind}`)).toEqual([
      "system:trigger", "mastery:input", "requirements:input", "coach:input", "planner:proposal", "planner:decision",
    ]);
    expect(out.review.verdict).toBe("approve");
    const tasks = generateStructured.mock.calls.map((c) => c[0].task);
    expect(tasks).toEqual(["coach_decide", "replan", "plan_review", "coach_decide"]);
  });

  it("plans with the learner's new constraints, and checks against them", async () => {
    // The draft keeps the old 3 hours; the learner asked for 2, so code objects and the planner revises once.
    reply(coachInput, replan, approve, noObjection, { ...replan, weeklyHours: 2, sessionMinutes: 30 });
    const out = await huddle();
    expect(generateStructured.mock.calls[1]![0].prompt).toContain("2 hours a week, sessions of 30 minutes");
    expect(out.messages.map((m) => m.kind)).toContain("revision");
    expect(out.messages.find((m) => m.kind === "objection")).toMatchObject({ from: "reviewer", severity: "must_fix" });
    expect(out.replan.weeklyHours).toBe(2);
    expect(out.review.issues).toEqual([]);
  });

  it("revises once on the coach's must-fix objection, and doesn't loop", async () => {
    const fits = { ...replan, weeklyHours: 2, sessionMinutes: 30 };
    reply(coachInput, fits, approve, { objection: "Make the first week back a single 20-minute win", severity: "must_fix" }, fits);
    const out = await huddle();
    expect(out.messages.filter((m) => m.from === "coach" && m.kind === "objection")).toHaveLength(1);
    expect(generateStructured.mock.calls[4]![0].prompt).toContain("Make the first week back a single 20-minute win");
    expect(generateStructured).toHaveBeenCalledTimes(5);
  });

  it("puts every model call through the step runner", async () => {
    reply(coachInput, { ...replan, weeklyHours: 2, sessionMinutes: 30 }, approve, noObjection);
    const names: string[] = [];
    await huddle({ run: (name: string, fn: () => Promise<unknown>) => (names.push(name), fn()) });
    expect(names).toEqual(["coach-input", "draft-replan", "review-replan", "coach-objection"]);
  });
});

describe("inputs from data", () => {
  it("effectiveBrief takes the learner's new numbers, else the current plan's", () => {
    expect(effectiveBrief(sampleBrief, samplePlan, request)).toMatchObject({ weeklyHours: 2, sessionMinutes: 30 });
    expect(effectiveBrief(sampleBrief, samplePlan, { ...request, weeklyHours: null, sessionMinutes: null })).toMatchObject({
      weeklyHours: samplePlan.weeklyHours,
      sessionMinutes: samplePlan.sessionMinutes,
    });
  });

  it("mastery reports progress, stuck skills and must-haves now met; requirements reports what's open", () => {
    const record = { skillId: "sql-querying", name: "SQL querying", level: 3, evidence: [], card: {} as never };
    const practised = applyMasteryToGap(gap, [record]);
    const m = masteryInput(practised, [record], [{ kind: "stuck_topic", skillId: "x", name: "Joins", sessionsOnMilestone: 4, level: 1, toLevel: 2 }]);
    expect(m.progressed).toEqual(["SQL querying: now 3 of 3"]);
    expect(m.alreadyMet).toEqual(["SQL querying"]);
    expect(m.stuck).toEqual(["Joins: level 1 after 4 sessions"]);
    expect(requirementsInput(practised).openMustHaves).toEqual(["Presenting findings (to 3)"]);
  });
});

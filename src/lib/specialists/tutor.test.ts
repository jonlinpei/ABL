import { describe, expect, it } from "vitest";
import { z } from "zod";

import { sampleBrief } from "@/lib/goals/test-fixtures";

import { computeGap } from "./gap";
import type { SessionReport } from "./schemas";
import { samplePlan, sampleProfile, sampleRequirements } from "./test-fixtures";
import {
  currentMilestone,
  endSessionSchema,
  normalizeReport,
  sessionClock,
  tutorContext,
  type PastSession,
} from "./tutor";

const gap = computeGap(sampleRequirements, sampleProfile);
const report = (over: Partial<SessionReport> = {}): SessionReport => ({
  summary: "Wrote first SELECT queries.",
  recap: "You wrote your first SELECT queries.",
  covered: ["SELECT"],
  evidence: [],
  homework: null,
  milestoneComplete: false,
  endedEarly: false,
  ...over,
});
const past = (milestoneIndex: number, over: Partial<SessionReport> = {}): PastSession => ({
  milestoneIndex,
  report: report(over),
  endedAt: "2026-09-28T20:00:00.000Z",
});

describe("currentMilestone", () => {
  it("is the first milestone no session has completed", () => {
    expect(currentMilestone(samplePlan, [])).toBe(0);
    expect(currentMilestone(samplePlan, [past(0)])).toBe(0);
    expect(currentMilestone(samplePlan, [past(0), past(0, { milestoneComplete: true })])).toBe(1);
  });

  it("is past the last milestone when every one is complete", () => {
    const all = samplePlan.milestones.map((_, i) => past(i, { milestoneComplete: true }));
    expect(currentMilestone(samplePlan, all)).toBe(samplePlan.milestones.length);
  });
});

describe("tutorContext", () => {
  const base = { brief: sampleBrief, gap, plan: samplePlan, milestoneIndex: 0 };

  it("teaches the plan's first session the first time", () => {
    const ctx = tutorContext({ ...base, history: [] });
    expect(ctx).toContain("This is their first session");
    expect(ctx).toContain(samplePlan.firstSession.title);
    expect(ctx).toContain("- sql-querying: SQL querying. Now 0");
  });

  it("follows up on homework and recent sessions afterwards", () => {
    const ctx = tutorContext({
      ...base,
      history: [past(0, { homework: { task: "Write three queries on the orders table.", minutes: 20 } })],
    });
    expect(ctx).toContain("Session 2 on this plan.");
    expect(ctx).toContain('Last session\'s homework was: "Write three queries on the orders table." Open by asking how it went.');
    expect(ctx).toContain("- 2026-09-28: Wrote first SELECT queries.");
  });

  it("asks for a quick review of skills that are due", () => {
    const ctx = tutorContext({
      ...base,
      history: [],
      dueReviews: [
        {
          skillId: "spreadsheets",
          name: "Spreadsheets",
          level: 3,
          evidence: [{ level: 3, evidence: "Built a pivot unaided.", source: "session", at: "2026-09-20T00:00:00Z" }],
          card: {} as never,
        },
      ],
    });
    expect(ctx).toContain("## Due for a quick review");
    expect(ctx).toContain("- spreadsheets: Spreadsheets. Last shown at level 3: Built a pivot unaided.");
    expect(tutorContext({ ...base, history: [] })).not.toContain("Due for a quick review");
  });

  it("passes on the coach's note, to use without mentioning it", () => {
    const ctx = tutorContext({ ...base, history: [], coachNotes: ["Joins aren't sticking: use two small tables from her HubSpot export first."] });
    expect(ctx).toContain("## Note from the coach\n- Joins aren't sticking");
    expect(ctx).toContain("don't mention the note to the learner");
  });

  it("carries homework and context across a replan instead of starting over", () => {
    const replanned = { ...samplePlan, whatChanged: [{ change: "Sessions are 30 minutes", because: "a new job" }] };
    const ctx = tutorContext({
      ...base,
      plan: replanned,
      history: [],
      carried: [past(0, { summary: "Rebuilt the pivot in SQL.", homework: { task: "Add a WHERE clause to it.", minutes: 10 } })],
    });
    expect(ctx).toContain("first session of the reworked plan, not their first session");
    expect(ctx).toContain("What changed in their plan: Sessions are 30 minutes (a new job)");
    expect(ctx).toContain('Last session\'s homework was: "Add a WHERE clause to it."');
    expect(ctx).toContain("Rebuilt the pivot in SQL.");
    expect(ctx).not.toContain("This is their first session.");
  });

  it("ignores earlier plans once the current plan has sessions of its own", () => {
    const ctx = tutorContext({
      ...base,
      history: [past(0, { summary: "This plan's session." })],
      carried: [past(0, { summary: "An old plan's session." })],
    });
    expect(ctx).toContain("This plan's session.");
    expect(ctx).not.toContain("An old plan's session.");
  });

  it("stays the same from turn to turn, so it can be cached", () => {
    expect(tutorContext({ ...base, history: [] })).toBe(tutorContext({ ...base, history: [] }));
    expect(tutorContext({ ...base, history: [] })).not.toMatch(/minutes have gone/);
  });
});

describe("sessionClock", () => {
  it("tells the tutor the time, and when to wrap up and stop", () => {
    expect(sessionClock(10, 45)).toBe("[Session clock: 10 of 45 minutes.]");
    expect(sessionClock(41, 45)).toMatch(/Start wrapping up/);
    expect(sessionClock(50, 45)).toMatch(/Time is up/);
  });
});

describe("normalizeReport", () => {
  it("clamps levels, keeps one entry per skill and rounds homework minutes", () => {
    const r = normalizeReport(
      report({
        evidence: [
          { skillId: "a", level: 1, evidence: "first" },
          { skillId: "a", level: 6.4, evidence: "last" },
        ],
        homework: { task: "t", minutes: 0.2 },
      }),
    );
    expect(r.evidence).toEqual([{ skillId: "a", level: 4, evidence: "last" }]);
    expect(r.homework!.minutes).toBe(1);
  });
});

describe("endSessionSchema", () => {
  it("only accepts evidence for the milestone's skills, with no numeric bounds for strict mode", () => {
    const schema = endSessionSchema(["sql-querying"]);
    const ok = { ...report(), evidence: [{ skillId: "sql-querying", level: 2, evidence: "x" }] };
    expect(schema.safeParse(ok).success).toBe(true);
    expect(schema.safeParse({ ...ok, evidence: [{ skillId: "other", level: 2, evidence: "x" }] }).success).toBe(false);
    expect(JSON.stringify(z.toJSONSchema(schema))).not.toMatch(/"(minimum|maximum)"/);
  });
});

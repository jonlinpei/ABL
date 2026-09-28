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
    expect(ctx).toContain("Session 2.");
    expect(ctx).toContain('Last session\'s homework was: "Write three queries on the orders table." Open by asking how it went.');
    expect(ctx).toContain("Session 1 (2026-09-28): Wrote first SELECT queries.");
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

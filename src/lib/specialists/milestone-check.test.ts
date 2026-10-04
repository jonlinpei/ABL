import { describe, expect, it } from "vitest";

import { sampleBrief } from "@/lib/goals/test-fixtures";

import { computeGap } from "./gap";
import { beforeAndAfter, milestoneCheckContext, milestoneToCheck } from "./milestone-check";
import type { SessionReport } from "./schemas";
import { samplePlan, sampleProfile, sampleRequirements } from "./test-fixtures";

const gap = computeGap(sampleRequirements, sampleProfile);
const report = (milestoneComplete: boolean): SessionReport => ({
  summary: "s", recap: "r", covered: [], evidence: [], homework: null, milestoneComplete, endedEarly: false,
});
const session = (milestoneIndex: number, done: boolean) => ({ milestoneIndex, report: report(done), endedAt: "2026-10-01T00:00:00Z" });

describe("milestoneToCheck", () => {
  it("offers the milestone the latest session just completed, with its skills and levels", () => {
    expect(milestoneToCheck(samplePlan, [session(0, false), session(0, true)], gap, new Set())).toEqual({
      milestoneIndex: 0,
      title: samplePlan.milestones[0]!.title,
      skills: [{ skillId: "sql-querying", name: "SQL querying", current: 0, toLevel: 2 }],
    });
  });

  it("offers nothing once handled, or when the latest session didn't finish a milestone", () => {
    expect(milestoneToCheck(samplePlan, [session(0, true)], gap, new Set([0]))).toBeNull();
    expect(milestoneToCheck(samplePlan, [session(0, true), session(1, false)], gap, new Set())).toBeNull();
    expect(milestoneToCheck(samplePlan, [], gap, new Set())).toBeNull();
  });
});

describe("milestone check context and results", () => {
  it("tells the Assessor it's a milestone check, with each skill's level before and aim", () => {
    const ctx = milestoneCheckContext(sampleBrief, samplePlan.milestones[0]!, [{ skillId: "sql-querying", name: "SQL querying", current: 0, toLevel: 2 }]);
    expect(ctx).toContain("## This is a milestone check");
    expect(ctx).toContain(`finished the milestone "${samplePlan.milestones[0]!.title}"`);
    expect(ctx).toContain("- sql-querying: SQL querying. Before this milestone: 0; the milestone aimed for 2.");
  });

  it("pairs each result with the level before and the aim", () => {
    expect(
      beforeAndAfter([{ skillId: "a", level: 1 }], [{ skillId: "a", level: 3, confidence: "high", evidence: "e" }], [{ skillId: "a", name: "A", toLevel: 2 }]),
    ).toEqual([{ skillId: "a", name: "A", before: 1, after: 3, toLevel: 2 }]);
  });
});

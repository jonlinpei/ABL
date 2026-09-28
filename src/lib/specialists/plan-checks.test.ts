import { describe, expect, it } from "vitest";

import { sampleBrief } from "@/lib/goals/test-fixtures";

import { computeGap } from "./gap";
import { checkPlan, totalWeeks } from "./plan-checks";
import type { Plan } from "./schemas";
import { samplePlan, sampleProfile, sampleRequirements } from "./test-fixtures";

// Gap: sql-querying missing (must, needs 3), stakeholder-communication partial
// (must, 2 of 3), spreadsheets met, dashboards met (nice).
const gap = computeGap(sampleRequirements, sampleProfile);
const brief = { ...sampleBrief, weeklyHours: 3, sessionMinutes: 45 };
const issues = (plan: Plan) => checkPlan(plan, gap, brief);

describe("checkPlan", () => {
  it("passes a plan that fits the week and closes every must-have", () => {
    expect(issues(samplePlan)).toEqual([]);
    expect(totalWeeks(samplePlan)).toBe(12);
  });

  it("rejects more weekly hours or longer sessions than the learner has", () => {
    expect(issues({ ...samplePlan, weeklyHours: 5 })[0]).toMatchObject({ severity: "must_fix" });
    const long = { ...samplePlan, firstSession: { ...samplePlan.firstSession, minutes: 60 } };
    expect(issues(long).map((i) => i.issue)).toContainEqual(expect.stringMatching(/longer than/));
  });

  it("rejects must-haves that are missing, too low or left out", () => {
    const noSql = {
      ...samplePlan,
      milestones: samplePlan.milestones.map((m) => ({ ...m, skills: m.skills.filter((s) => s.skillId !== "sql-querying") })),
    };
    expect(issues(noSql).map((i) => i.issue)).toContainEqual(expect.stringMatching(/SQL querying" is never taught/));

    const tooLow = {
      ...samplePlan,
      milestones: samplePlan.milestones.map((m) => ({
        ...m,
        skills: m.skills.map((s) => (s.skillId === "sql-querying" ? { ...s, toLevel: 2 } : s)),
      })),
    };
    expect(issues(tooLow).map((i) => i.issue)).toContainEqual(expect.stringMatching(/only reaches level 2/));

    const leftOut = { ...noSql, notCovered: [{ skillId: "sql-querying", reason: "no time" }] };
    expect(issues(leftOut).map((i) => i.issue)).toContainEqual(expect.stringMatching(/left out/));
  });

  it("flags teaching a skill that's already met, and unknown skill ids", () => {
    const withMet = {
      ...samplePlan,
      milestones: [
        ...samplePlan.milestones,
        { ...samplePlan.milestones[0]!, title: "Excel again", skills: [{ skillId: "spreadsheets", toLevel: 3 }, { skillId: "made-up", toLevel: 2 }] },
      ],
    };
    const found = issues(withMet);
    expect(found).toContainEqual(expect.objectContaining({ severity: "should_fix", issue: expect.stringMatching(/already at the needed level/) }));
    expect(found).toContainEqual(expect.objectContaining({ severity: "must_fix", issue: expect.stringMatching(/unknown skill "made-up"/) }));
  });
});

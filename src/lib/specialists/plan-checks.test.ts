import { describe, expect, it } from "vitest";

import { sampleBrief } from "@/lib/goals/test-fixtures";

import { computeGap } from "./gap";
import { checkPlan, checkReplanWorkload, totalWeeks } from "./plan-checks";
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

describe("checkReplanWorkload", () => {
  // samplePlan: 12 weeks at 3 h/week = 36 hours from the start.
  const at = (weeklyHours: number, weeks: number[]) => ({
    ...samplePlan,
    weeklyHours,
    milestones: weeks.map((w, i) => ({ ...samplePlan.milestones[i % samplePlan.milestones.length]!, weeks: w })),
  });

  it("accepts fewer hours a week when the timeline stretches to match", () => {
    expect(checkReplanWorkload(samplePlan, 0, at(2, [6, 7, 5]))).toEqual([]); // 18 wk × 2 = 36 h
  });

  it("rejects the same work promised in less time", () => {
    const [issue] = checkReplanWorkload(samplePlan, 0, at(2, [4, 5, 3])); // 12 wk × 2 = 24 h
    expect(issue).toMatchObject({ severity: "must_fix" });
    expect(issue!.issue).toMatch(/36 hours to 24/);
    expect(issue!.fix).toMatch(/about 18 weeks/);
  });

  it("only asks for it to be named when scope is cut in the open", () => {
    const cut = { ...at(2, [4, 5, 3]), notCovered: [{ skillId: "dashboards", reason: "Dropped to fit the new job." }] };
    expect(checkReplanWorkload(samplePlan, 0, cut)[0]).toMatchObject({ severity: "should_fix" });
  });

  it("counts only the remaining milestones", () => {
    // From milestone 2: 8 weeks × 3 = 24 h left.
    expect(checkReplanWorkload(samplePlan, 1, at(2, [6, 6]))).toEqual([]);
  });
});

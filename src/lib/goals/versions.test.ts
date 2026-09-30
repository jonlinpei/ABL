import { describe, expect, it } from "vitest";

import { samplePlan } from "@/lib/specialists/test-fixtures";

import { compareMilestones } from "./plan-diff";
import { sampleBrief } from "./test-fixtures";
import { classifyGoalChange, rebuildSummary, replanRequestFor } from "./versions";

describe("classifyGoalChange", () => {
  it("rebuilds when where they're going or starting from changes", () => {
    expect(classifyGoalChange(sampleBrief, { ...sampleBrief, target: { ...sampleBrief.target, role: "Analytics engineer" } })).toBe("rebuild");
    expect(classifyGoalChange(sampleBrief, { ...sampleBrief, current: { ...sampleBrief.current, industry: "Healthcare" } })).toBe("rebuild");
  });

  it("reworks the plan when its shape changes, and ignores spacing and case", () => {
    expect(classifyGoalChange(sampleBrief, { ...sampleBrief, weeklyHours: 2 })).toBe("replan");
    expect(classifyGoalChange(sampleBrief, { ...sampleBrief, deadline: "Spring 2028" })).toBe("replan");
    expect(classifyGoalChange(sampleBrief, { ...sampleBrief, target: { ...sampleBrief.target, role: ` ${sampleBrief.target.role.toUpperCase()} ` } })).toBe("details");
  });

  it("keeps the plan for details it doesn't depend on", () => {
    expect(classifyGoalChange(sampleBrief, { ...sampleBrief, interests: ["cycling"], motivation: "New reason" })).toBe("details");
  });
});

describe("replanRequestFor", () => {
  it("passes the new week and deadline, and notes other plan changes", () => {
    const { request, reason } = replanRequestFor(sampleBrief, { ...sampleBrief, weeklyHours: 2, priority: "speed" });
    expect(request).toEqual({ weeklyHours: 2, sessionMinutes: null, deadline: null, note: 'I updated my goal. priority: now "speed".' });
    expect(reason).toBe("The learner updated their goal (weekly hours, priority).");
  });
});

describe("rebuildSummary", () => {
  it("says what the new direction is and how the plans compare", () => {
    const after = { ...sampleBrief, target: { ...sampleBrief.target, role: "Analytics engineer" } };
    const proposed = { ...samplePlan, weeklyHours: 4, milestones: samplePlan.milestones.slice(0, 2) };
    expect(rebuildSummary(sampleBrief, after, samplePlan, proposed)).toBe(
      `Aimed at Analytics engineer, ${after.target.industry} instead of ${sampleBrief.target.role}, ${sampleBrief.target.industry}: 2 milestones over about 9 weeks at 4 h/week (now 3 over 12).`,
    );
  });
});

describe("compareMilestones", () => {
  it("marks finished milestones done, and the rest kept, dropped or new by title", () => {
    const proposed = {
      ...samplePlan,
      milestones: [{ ...samplePlan.milestones[1]!, title: "joins AND window functions!" }, { ...samplePlan.milestones[2]!, title: "Build a dashboard" }],
    };
    const c = compareMilestones(samplePlan, proposed, 1);
    expect(c.current.map((m) => m.state)).toEqual(["done", "kept", "dropped"]);
    expect(c.proposed.map((m) => m.state)).toEqual(["kept", "new"]);
    expect(c.weeksLeft).toEqual({ current: 8, proposed: 8 });
  });
});

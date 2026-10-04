import { describe, expect, it } from "vitest";

import { computeGap } from "./gap";
import { normalizeDraft, planWeeksFor, sideQuestContext } from "./side-quest";
import { sampleProfile, sampleRequirements } from "./test-fixtures";

const gap = computeGap(sampleRequirements, sampleProfile);
const draft = { title: "t", why: "w", outline: ["a", " ", "b", "c", "d", "e"], sessions: 6.4, skillId: "Python Data Cleaning!", skillName: "Python data cleaning", relevance: "related" as const };

describe("side quests", () => {
  it("keeps drafts to 1-4 sessions and 4 outline items, slugging new skills and reusing gap ones", () => {
    expect(normalizeDraft(draft, gap)).toMatchObject({ sessions: 4, outline: ["a", "b", "c", "d"], skillId: "python-data-cleaning" });
    expect(normalizeDraft({ ...draft, sessions: 0, skillId: "dashboards", skillName: "x" }, gap)).toMatchObject({ sessions: 1, skillId: "dashboards", skillName: "Dashboards" });
  });

  it("works out how far plan time moves the finish, rounded up to the half week", () => {
    expect(planWeeksFor(2, { sessionMinutes: 45, weeklyHours: 3 })).toBe(0.5);
    expect(planWeeksFor(4, { sessionMinutes: 60, weeklyHours: 2 })).toBe(2);
    expect(planWeeksFor(3, { sessionMinutes: 30, weeklyHours: 1 })).toBe(1.5);
  });

  it("briefs the tutor on the quest instead of the milestone", () => {
    const ctx = sideQuestContext({ title: "Clean data", why: "Analysts do.", outline: ["Load a CSV", "Fix types"], sessions: 2, skillId: "py", skillName: "Python" }, 2);
    expect(ctx).toContain("side-quest session 2 of 2");
    expect(ctx).toContain("Cover, over 2 sessions: Load a CSV; Fix types");
    expect(ctx).toContain("it ends the side quest, not a milestone");
  });
});

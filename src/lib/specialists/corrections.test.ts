import { describe, expect, it } from "vitest";

import { sampleBrief } from "@/lib/goals/test-fixtures";

import { correctGap, correctMastery, editBrief, planAffected } from "./corrections";
import { computeGap } from "./gap";
import type { MasteryRecord } from "./mastery";
import { samplePlan, sampleProfile, sampleRequirements } from "./test-fixtures";

const gap = computeGap(sampleRequirements, sampleProfile);

describe("editBrief", () => {
  it("applies edits, including strengths on the current position, and clears their guess flags", () => {
    const brief = { ...sampleBrief, inferred: ["motivation", "deadline"] as typeof sampleBrief.inferred };
    const edited = editBrief(brief, { motivation: "More interesting work", strengths: ["SQL-adjacent reporting"], interests: ["cycling"] });
    expect(edited).toMatchObject({ motivation: "More interesting work", interests: ["cycling"] });
    expect(edited.current.strengths).toEqual(["SQL-adjacent reporting"]);
    expect(edited.current.role).toBe(sampleBrief.current.role);
    expect(edited.inferred).toEqual(["deadline"]);
  });
});

describe("correctGap", () => {
  it("sets the learner's level as their own estimate, to confirm, and re-scores", () => {
    const corrected = correctGap(gap, "sql-querying", 3)!;
    expect(corrected.items.find((i) => i.skillId === "sql-querying")).toMatchObject({
      current: 3,
      basis: "self_reported",
      status: "met",
      shortfall: 0,
      verify: true,
    });
    expect(corrected.counts.met).toBe(gap.counts.met + 1);
  });

  it("doesn't ask to confirm a level of none, and ignores unknown skills", () => {
    expect(correctGap(gap, "spreadsheets", 0)!.items.find((i) => i.skillId === "spreadsheets")).toMatchObject({ verify: false, status: "missing" });
    expect(correctGap(gap, "made-up", 2)).toBeNull();
  });
});

describe("correctMastery", () => {
  it("sets the level and records the learner's note as evidence, keeping the review schedule", () => {
    const record = { skillId: "sql-querying", name: "SQL", level: 1, evidence: [], card: { due: "2027-01-01" } } as unknown as MasteryRecord;
    const out = correctMastery(record, 3, "I write joins daily", new Date("2026-10-01T00:00:00Z"));
    expect(out.level).toBe(3);
    expect(out.card).toBe(record.card);
    expect(out.evidence).toEqual([{ level: 3, evidence: "The learner says: I write joins daily", source: "learner", at: "2026-10-01T00:00:00.000Z" }]);
  });
});

describe("planAffected", () => {
  // Milestones: 0 and 1 take SQL to 2 then 3; 2 takes presenting to 3.
  it("is true when an upcoming milestone teaches what they now say they know", () => {
    expect(planAffected(samplePlan, 1, "sql-querying", 3)).toBe(true);
    expect(planAffected(samplePlan, 1, "sql-querying", 2)).toBe(false);
  });

  it("is true when a finished milestone assumed more than they now say they have", () => {
    expect(planAffected(samplePlan, 1, "sql-querying", 1)).toBe(true);
    expect(planAffected(samplePlan, 0, "spreadsheets", 0)).toBe(false);
  });
});

import { describe, expect, it } from "vitest";

import { computeGap } from "./gap";
import { sampleProfile, sampleRequirements } from "./test-fixtures";

describe("computeGap", () => {
  const gap = computeGap(sampleRequirements, sampleProfile);
  const item = (id: string) => gap.items.find((i) => i.skillId === id)!;

  it("scores each required skill as met, partial or missing", () => {
    expect(item("sql-querying")).toMatchObject({ status: "missing", required: 3, current: 0, shortfall: 3 });
    expect(item("spreadsheets")).toMatchObject({ status: "met", shortfall: 0 });
    expect(item("stakeholder-communication")).toMatchObject({ status: "partial", shortfall: 1 });
    expect(gap.counts).toEqual({ met: 2, partial: 1, missing: 1 });
  });

  it("puts must-haves first, biggest shortfall first", () => {
    expect(gap.items.map((i) => i.skillId)).toEqual([
      "sql-querying",
      "stakeholder-communication",
      "spreadsheets",
      "dashboards",
    ]);
  });

  it("flags claimed levels for the Assessor to verify, but not work history or zeros", () => {
    expect(item("dashboards").verify).toBe(true);
    expect(item("spreadsheets").verify).toBe(false);
    expect(item("sql-querying").verify).toBe(false);
  });

  it("treats a skill missing from the profile as level 0, inferred", () => {
    const g = computeGap(sampleRequirements, { ...sampleProfile, skills: [] });
    expect(g.items.every((i) => i.current === 0 && i.basis === "inferred")).toBe(true);
    expect(g.counts.missing).toBe(4);
  });

  it("carries credentials and proof of skill through for the planner", () => {
    expect(gap.proofOfSkill).toEqual(sampleRequirements.proofOfSkill);
    expect(gap.credentials).toEqual([]);
  });
});

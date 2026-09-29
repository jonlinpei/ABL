import { describe, expect, it } from "vitest";

import { computeGap, openMustHaveChanges, rebaseGap } from "./gap";
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

describe("rebaseGap", () => {
  const gap = computeGap(sampleRequirements, sampleProfile);
  // Refreshed: dashboards became a must-have, spreadsheets were dropped, Python is new.
  const refreshed = {
    ...sampleRequirements,
    skills: [
      ...sampleRequirements.skills
        .filter((s) => s.id !== "spreadsheets")
        .map((s) => (s.id === "dashboards" ? { ...s, importance: "must" as const, level: 3, frequency: "core" as const } : s)),
      { id: "python", name: "Python", category: "technical" as const, level: 2, importance: "must" as const, howEmployersCheck: "Take-home", howToShow: "A notebook" },
    ],
  };
  const rebased = rebaseGap(gap, refreshed);
  const item = (id: string) => rebased.items.find((i) => i.skillId === id)!;

  it("keeps the learner's levels and takes what's needed from the new requirements", () => {
    expect(item("dashboards")).toMatchObject({ importance: "must", required: 3, current: 2, basis: "self_reported", status: "partial", frequency: "core" });
    expect(item("sql-querying")).toMatchObject({ current: 0, status: "missing" });
  });

  it("starts new skills unknown, and keeps dropped ones as nice-to-haves", () => {
    expect(item("python")).toMatchObject({ current: 0, basis: "inferred", status: "missing", howToShow: "A notebook" });
    expect(item("spreadsheets")).toMatchObject({ importance: "nice", current: 3, status: "met" });
    expect(rebased.items).toHaveLength(5);
  });

  it("reports only open must-haves that changed", () => {
    // Spreadsheets was met, so dropping it isn't news; dashboards and Python are.
    expect(openMustHaveChanges(gap, rebased)).toEqual({
      added: [
        { skillId: "python", name: "Python" },
        { skillId: "dashboards", name: "Dashboards" },
      ],
      dropped: [],
    });
    const easier = rebaseGap(gap, { ...sampleRequirements, skills: sampleRequirements.skills.map((s) => ({ ...s, importance: "nice" as const })) });
    expect(openMustHaveChanges(gap, easier).dropped.map((d) => d.skillId)).toEqual(["sql-querying", "stakeholder-communication"]);
  });
});

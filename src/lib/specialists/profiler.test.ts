import { describe, expect, it } from "vitest";

import { sampleBrief } from "@/lib/goals/test-fixtures";

import { alignToRequirements, profilePrompt } from "./profiler";
import { sampleProfile, sampleRequirements } from "./test-fixtures";

describe("alignToRequirements", () => {
  it("returns exactly one entry per required skill, in requirement order", () => {
    const shuffled = { ...sampleProfile, skills: [...sampleProfile.skills].reverse() };
    const aligned = alignToRequirements(shuffled, sampleRequirements);
    expect(aligned.skills.map((s) => s.skillId)).toEqual(sampleRequirements.skills.map((s) => s.id));
  });

  it("drops unknown skills and fills skipped ones as level 0, inferred", () => {
    const aligned = alignToRequirements(
      {
        ...sampleProfile,
        skills: [{ skillId: "made-up", level: 4, basis: "work_history", evidence: "x" }],
      },
      sampleRequirements,
    );
    expect(aligned.skills).toHaveLength(sampleRequirements.skills.length);
    expect(aligned.skills.every((s) => s.level === 0 && s.basis === "inferred")).toBe(true);
  });
});

describe("profilePrompt", () => {
  it("gives the brief's evidence and every required skill id", () => {
    const p = profilePrompt(sampleBrief, sampleRequirements);
    expect(p).toContain(sampleBrief.current.work);
    expect(p).toContain(sampleBrief.startingPoint);
    for (const s of sampleRequirements.skills) expect(p).toContain(`- ${s.id}:`);
  });
});

import { describe, expect, it } from "vitest";

import { sampleBrief } from "@/lib/goals/test-fixtures";

import { requirementsPrompt, targetKey, withUniqueSkillIds } from "./requirements";
import { sampleRequirements } from "./test-fixtures";

describe("targetKey", () => {
  it("is the same for targets that differ only in case and spacing", () => {
    const a = targetKey({ ...sampleBrief.target, role: "Data  Analyst " });
    const b = targetKey({ ...sampleBrief.target, role: "data analyst" });
    expect(a).toBe(b);
    expect(a).toBe("data analyst | bay area, b2b software | software");
  });

  it("differs when the market or industry differs", () => {
    expect(targetKey(sampleBrief.target)).not.toBe(
      targetKey({ ...sampleBrief.target, industry: "Healthcare" }),
    );
  });
});

describe("withUniqueSkillIds", () => {
  it("slugs ids and drops repeats and empties", () => {
    const [first] = sampleRequirements.skills;
    const r = withUniqueSkillIds({
      ...sampleRequirements,
      skills: [
        { ...first!, id: "SQL Querying" },
        { ...first!, id: "sql-querying", name: "Duplicate" },
        { ...first!, id: "!!!" },
      ],
    });
    expect(r.skills.map((s) => [s.id, s.name])).toEqual([["sql-querying", "SQL querying"]]);
  });
});

describe("requirementsPrompt", () => {
  it("describes the target and asks for the target, not the learner", () => {
    const p = requirementsPrompt(sampleBrief);
    expect(p).toContain(sampleBrief.target.role);
    expect(p).toContain(sampleBrief.target.market);
    expect(p).toMatch(/not for this learner/);
  });
});

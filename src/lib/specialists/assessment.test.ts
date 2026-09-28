import { describe, expect, it } from "vitest";
import { z } from "zod";

import { sampleBrief } from "@/lib/goals/test-fixtures";

import {
  applyAssessment,
  assessmentAccepted,
  assessorContext,
  checkSubmission,
  MAX_SKILLS_TO_CHECK,
  selectSkillsToCheck,
  submissionSchema,
} from "./assessment";
import { computeGap } from "./gap";
import type { LearnerProfile } from "./schemas";
import { sampleProfile, sampleRequirements } from "./test-fixtures";

const gap = computeGap(sampleRequirements, sampleProfile);

describe("selectSkillsToCheck", () => {
  it("checks only claimed or guessed levels above 0", () => {
    expect(selectSkillsToCheck(gap).map((s) => s.skillId)).toEqual(["dashboards"]);
  });

  it("puts must-haves first, then the highest claims, and stops at the cap", () => {
    const skills = Array.from({ length: 8 }, (_, i) => ({
      id: `skill-${i}`,
      name: `Skill ${i}`,
      category: "technical" as const,
      level: 4,
      importance: i < 2 ? ("nice" as const) : ("must" as const),
      howEmployersCheck: "x",
    }));
    const profile: LearnerProfile = {
      summary: "",
      otherStrengths: [],
      skills: skills.map((s, i) => ({ skillId: s.id, level: (i % 3) + 1, basis: "inferred" as const, evidence: "" })),
    };
    const picked = selectSkillsToCheck(computeGap({ ...sampleRequirements, skills }, profile));
    expect(picked).toHaveLength(MAX_SKILLS_TO_CHECK);
    expect(picked.every((s) => s.importance === "must")).toBe(true);
    const levels = picked.map((s) => s.current);
    expect(levels).toEqual([...levels].sort((a, b) => b - a));
  });
});

describe("applyAssessment", () => {
  it("replaces checked levels, marks them assessed and re-scores the gap", () => {
    const assessed = applyAssessment(gap, [
      { skillId: "dashboards", level: 1, confidence: "high", evidence: "Only used HubSpot's built-in reports." },
    ]);
    const item = assessed.items.find((i) => i.skillId === "dashboards")!;
    expect(item).toMatchObject({ current: 1, basis: "assessed", status: "partial", shortfall: 1, verify: false });
    expect(assessed.counts).toEqual({ met: 1, partial: 2, missing: 1 });
    expect(selectSkillsToCheck(assessed)).toEqual([]);
  });

  it("leaves unchecked skills as the profiler estimated them", () => {
    const assessed = applyAssessment(gap, []);
    expect(assessed.items).toEqual(gap.items);
  });
});

describe("checkSubmission", () => {
  it("accepts one result per checked skill, in order, the last repeat winning", () => {
    const r = checkSubmission(
      [
        { skillId: "b", level: 3, confidence: "high", evidence: "first" },
        { skillId: "a", level: 0, confidence: "low", evidence: "stopped early" },
        { skillId: "b", level: 2, confidence: "medium", evidence: "second" },
      ],
      ["a", "b"],
    );
    expect(r.ok && r.results.map((x) => [x.skillId, x.level])).toEqual([
      ["a", 0],
      ["b", 2],
    ]);
  });

  it("clamps levels to the 0 to 4 scale", () => {
    const r = checkSubmission([{ skillId: "a", level: 7, confidence: "high", evidence: "" }], ["a"]);
    expect(r.ok && r.results[0]!.level).toBe(4);
  });

  it("rejects a submission that leaves out a checked skill, instead of saving zeros", () => {
    expect(checkSubmission([], ["a", "b"])).toEqual({ ok: false, missing: ["a", "b"] });
  });
});

describe("assessmentAccepted", () => {
  const step = (output: unknown) => ({ toolResults: [{ toolName: "submit_assessment", output }] });
  it("stops only once a submission was accepted", () => {
    expect(assessmentAccepted({ steps: [step({ status: "incomplete" })] })).toBe(false);
    expect(assessmentAccepted({ steps: [step({ status: "incomplete" }), step({ status: "saved" })] })).toBe(true);
    expect(assessmentAccepted({ steps: [{ toolResults: [] }] })).toBe(false);
  });
});

describe("assessorContext", () => {
  it("names the move and each skill with its assumed and required level", () => {
    const ctx = assessorContext(sampleBrief, selectSkillsToCheck(gap));
    expect(ctx).toContain(sampleBrief.target.role);
    expect(ctx).toContain("- dashboards: Dashboards. Estimated 2 (self reported, a guess to test); the target needs 2.");
  });
});

describe("submissionSchema", () => {
  it("has no integer min/max, which Anthropic's strict tool mode rejects", () => {
    const json = JSON.stringify(z.toJSONSchema(submissionSchema(["a"])));
    expect(json).not.toMatch(/"(minimum|maximum)"/);
  });

  it("only accepts the skills being checked", () => {
    const schema = submissionSchema(["a"]);
    const result = { level: 2, confidence: "high", evidence: "" };
    expect(schema.safeParse({ results: [{ skillId: "a", ...result }] }).success).toBe(true);
    expect(schema.safeParse({ results: [{ skillId: "b", ...result }] }).success).toBe(false);
  });
});

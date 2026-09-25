import { describe, expect, it } from "vitest";

import { GoalBriefSchema, InferableField, type GoalBrief } from "./schema";

const brief: GoalBrief = {
  subject: "Jazz piano",
  goalInTheirWords: "I want to play a few jazz standards on piano",
  restatedGoal: "Play three jazz standards from lead sheets by March.",
  motivation: "Play with friends at a jam night.",
  successLooksLike: "Comping and a simple solo on Autumn Leaves.",
  deadline: null,
  startingPoint: "Grade 5 classical, no improvisation.",
  weeklyHours: 4,
  sessionMinutes: 30,
  preferredTimes: null,
  pastAttempts: null,
  priority: "practical",
  interests: ["Bill Evans"],
  inferred: [],
};

describe("GoalBriefSchema", () => {
  it("accepts a brief on any subject, with no domain", () => {
    expect(GoalBriefSchema.safeParse(brief).success).toBe(true);
  });

  it("requires a subject", () => {
    const rest: Partial<GoalBrief> = { ...brief };
    delete rest.subject;
    expect(GoalBriefSchema.safeParse(rest).success).toBe(false);
  });

  it("requires the inferred list (strict tool input always sends it)", () => {
    const rest: Partial<GoalBrief> = { ...brief };
    delete rest.inferred;
    expect(GoalBriefSchema.safeParse(rest).success).toBe(false);
  });

  it("accepts inferred fields the card can flag", () => {
    const r = GoalBriefSchema.safeParse({ ...brief, inferred: ["deadline", "weeklyHours"] });
    expect(r.success).toBe(true);
  });

  it("rejects inferred entries that are not inferable fields", () => {
    for (const field of ["subject", "interests", "restatedGoal", "domain"]) {
      const r = GoalBriefSchema.safeParse({ ...brief, inferred: [field] });
      expect(r.success, `inferred: [${field}] should be rejected`).toBe(false);
    }
  });

  it("only lists fields that exist on the brief as inferable", () => {
    const shape = Object.keys(GoalBriefSchema.shape);
    for (const f of InferableField.options) expect(shape).toContain(f);
  });

  it("allows null for the optional-by-nature fields", () => {
    for (const field of ["deadline", "preferredTimes", "pastAttempts"] as const) {
      expect(GoalBriefSchema.safeParse({ ...brief, [field]: null }).success).toBe(true);
    }
  });
});

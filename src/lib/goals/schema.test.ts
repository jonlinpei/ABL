import { describe, expect, it } from "vitest";

import { GoalBriefSchema, InferableField, type GoalBrief } from "./schema";
import { sampleBrief as brief } from "./test-fixtures";

/** Reads a dotted path such as "current.market" from a brief. */
const at = (b: GoalBrief, path: string) =>
  path.split(".").reduce<unknown>((v, k) => (v as Record<string, unknown>)?.[k], b);

describe("GoalBriefSchema", () => {
  it("accepts a career brief", () => {
    expect(GoalBriefSchema.safeParse(brief).success).toBe(true);
  });

  it("requires a headline and both ends of the move", () => {
    for (const field of ["headline", "current", "target", "changes"] as const) {
      const rest: Partial<GoalBrief> = { ...brief };
      delete rest[field];
      expect(GoalBriefSchema.safeParse(rest).success, `${field} should be required`).toBe(false);
    }
  });

  it("describes both positions by role, work, market and industry", () => {
    for (const side of ["current", "target"] as const) {
      for (const key of ["role", "work", "market", "industry"] as const) {
        const b = { ...brief, [side]: { ...brief[side], [key]: undefined } };
        expect(GoalBriefSchema.safeParse(b).success, `${side}.${key}`).toBe(false);
      }
    }
  });

  it("accepts no changes, for someone growing in their current career", () => {
    expect(GoalBriefSchema.safeParse({ ...brief, changes: [] }).success).toBe(true);
  });

  it("rejects a change outside role, market and industry", () => {
    expect(GoalBriefSchema.safeParse({ ...brief, changes: ["salary"] }).success).toBe(false);
  });

  it("only accepts known profile sources", () => {
    expect(GoalBriefSchema.safeParse({ ...brief, profileSources: ["linkedin"] }).success).toBe(true);
    expect(GoalBriefSchema.safeParse({ ...brief, profileSources: ["twitter"] }).success).toBe(false);
  });

  it("requires the inferred list (strict tool input always sends it)", () => {
    const rest: Partial<GoalBrief> = { ...brief };
    delete rest.inferred;
    expect(GoalBriefSchema.safeParse(rest).success).toBe(false);
  });

  it("rejects inferred entries that are not inferable fields", () => {
    for (const field of ["headline", "current", "changes", "interests", "domain"]) {
      const r = GoalBriefSchema.safeParse({ ...brief, inferred: [field] });
      expect(r.success, `inferred: [${field}] should be rejected`).toBe(false);
    }
  });

  it("only lists paths that exist on the brief as inferable", () => {
    for (const path of InferableField.options) {
      expect(at(brief, path), `${path} is not on the brief`).not.toBeUndefined();
    }
  });

  it("allows null for the optional-by-nature fields", () => {
    for (const field of ["deadline", "preferredTimes", "pastAttempts"] as const) {
      expect(GoalBriefSchema.safeParse({ ...brief, [field]: null }).success).toBe(true);
    }
  });
});

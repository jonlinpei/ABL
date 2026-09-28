import { z } from "zod";

/**
 * Typed artifacts the specialists after discovery read and write
 * (docs/architecture.md, "Agent architecture"). Kept free of app imports so
 * eval scripts can load them directly.
 */

/**
 * Skill level on one scale shared by requirements and profiles:
 * 0 none, 1 aware of it, 2 can do it with help, 3 can do it independently,
 * 4 can lead or teach it.
 */
export const SkillLevel = z.number().int().min(0).max(4);

export const SkillCategory = z.enum(["technical", "tool", "domain", "professional"]);

export const RequiredSkill = z.object({
  id: z
    .string()
    .describe('Stable lowercase slug for the skill, e.g. "sql-querying" or "storyboarding".'),
  name: z.string().describe('Plain name, e.g. "SQL querying".'),
  category: SkillCategory,
  level: z
    .number()
    .int()
    .min(1)
    .max(4)
    .describe("Level needed to be hired: 1 aware, 2 with help, 3 independently, 4 lead or teach."),
  importance: z
    .enum(["must", "nice"])
    .describe('"must" if most employers screen for it, "nice" if it helps but is often waived.'),
  howEmployersCheck: z
    .string()
    .describe("How hiring managers check it, e.g. a take-home SQL test or a portfolio piece."),
});
export type RequiredSkill = z.infer<typeof RequiredSkill>;

/** What a target role, market and industry demand. Shared by learners with the same target. */
export const TargetRequirementsSchema = z.object({
  summary: z.string().describe("Two or three sentences on what this role is and what gets people hired."),
  skills: z.array(RequiredSkill).describe("8 to 15 skills, most important first."),
  credentials: z
    .array(
      z.object({
        name: z.string(),
        status: z.enum(["required", "common", "optional"]),
        note: z.string().describe("When it matters, in one sentence."),
      }),
    )
    .describe("Licenses, certifications or degrees. Empty if none matter."),
  proofOfSkill: z
    .array(z.string())
    .describe("What candidates show to prove they can do the job, e.g. a portfolio of three projects."),
  caveats: z
    .array(z.string())
    .describe("Where this varies a lot by employer or place, or may be out of date."),
});
export type TargetRequirements = z.infer<typeof TargetRequirementsSchema>;

export const SkillBasis = z.enum(["work_history", "self_reported", "inferred"]);

/** The learner's current level on each required skill, with where that estimate comes from. */
export const LearnerProfileSchema = z.object({
  summary: z.string().describe("Two sentences on what the learner brings to the target."),
  skills: z
    .array(
      z.object({
        skillId: z.string().describe("The id of a required skill."),
        level: SkillLevel,
        basis: SkillBasis.describe(
          "work_history: shown by what they did in a role. self_reported: they said so. inferred: an educated guess.",
        ),
        evidence: z.string().describe("The specific fact behind the level, in one sentence."),
      }),
    )
    .describe("One entry per required skill, in the same order."),
  otherStrengths: z
    .array(z.string())
    .describe("Strengths that carry over but aren't in the requirements list."),
});
export type LearnerProfile = z.infer<typeof LearnerProfileSchema>;

export const GapStatus = z.enum(["met", "partial", "missing"]);

/** Requirements minus profile, per skill. Computed, not generated. */
export const GapSchema = z.object({
  items: z.array(
    z.object({
      skillId: z.string(),
      name: z.string(),
      category: SkillCategory,
      importance: z.enum(["must", "nice"]),
      required: z.number(),
      current: z.number(),
      shortfall: z.number(),
      status: GapStatus,
      basis: SkillBasis,
      /** The Assessor should confirm this level before the plan relies on it. */
      verify: z.boolean(),
    }),
  ),
  credentials: TargetRequirementsSchema.shape.credentials,
  proofOfSkill: z.array(z.string()),
  counts: z.object({ met: z.number(), partial: z.number(), missing: z.number() }),
});
export type Gap = z.infer<typeof GapSchema>;

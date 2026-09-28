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

/** Where a level comes from. The profiler sets the first three; the Assessor sets "assessed". */
export const SkillBasis = z.enum(["work_history", "self_reported", "inferred", "assessed"]);
const ProfileBasis = SkillBasis.exclude(["assessed"]);

/** The learner's current level on each required skill, with where that estimate comes from. */
export const LearnerProfileSchema = z.object({
  summary: z.string().describe("Two sentences on what the learner brings to the target."),
  skills: z
    .array(
      z.object({
        skillId: z.string().describe("The id of a required skill."),
        level: SkillLevel,
        basis: ProfileBasis.describe(
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

/** One skill the Assessor checked, and what the learner showed. */
export const AssessedSkill = z.object({
  skillId: z.string(),
  level: SkillLevel.describe("The level their answers showed, on the same 0 to 4 scale."),
  confidence: z
    .enum(["high", "medium", "low"])
    .describe("How sure you are: low if they skipped or the answer was too short to judge."),
  evidence: z.string().describe("What in their answer supports the level, in one sentence."),
});
export type AssessedSkill = z.infer<typeof AssessedSkill>;

/** A learning plan built from the assessed gap: how to get there. */
export const PlanSchema = z.object({
  title: z.string(),
  summary: z.string().describe("Two or three sentences on the path and why it fits this learner."),
  weeklyHours: z.number().describe("Planned hours a week. Must not exceed the learner's."),
  sessionMinutes: z.number().describe("Planned session length. Must not exceed the learner's."),
  milestones: z
    .array(
      z.object({
        title: z.string(),
        weeks: z.number().describe("Weeks this milestone takes at the planned weekly hours."),
        whyItMatters: z.string().describe("One sentence tying it to the learner's goal."),
        skills: z
          .array(
            z.object({
              skillId: z.string().describe("A skill id from the gap."),
              toLevel: z.number().describe("The level this milestone brings the skill to, 1 to 4."),
            }),
          )
          .describe("The gap skills this milestone closes."),
        topics: z.array(z.string()).describe("What they'll learn, in plain words."),
        project: z
          .string()
          .nullable()
          .describe("Something they build that employers will see, or null."),
        visibleWin: z.string().describe("A small, concrete thing they can do at the end."),
      }),
    )
    .describe("3 to 8 milestones, in order."),
  firstSession: z.object({
    title: z.string(),
    minutes: z.number().describe("Must not exceed the learner's session length."),
    whatYouWillDo: z.string(),
    outcome: z.string(),
  }),
  notCovered: z
    .array(z.object({ skillId: z.string(), reason: z.string() }))
    .describe("Gap skills the plan deliberately leaves out, and why."),
  deadlineFit: z
    .string()
    .describe("Whether the plan reaches the goal by the deadline, honestly, in one or two sentences."),
  assumptions: z.array(z.string()).describe("Assumptions to confirm with the learner."),
});
export type Plan = z.infer<typeof PlanSchema>;

/** A reviewer's verdict on a plan. */
export const PlanReviewSchema = z.object({
  verdict: z.enum(["approve", "revise"]),
  issues: z
    .array(
      z.object({
        severity: z.enum(["must_fix", "should_fix"]),
        issue: z.string(),
        fix: z.string().describe("What the planner should change."),
      }),
    )
    .describe("Empty when approving."),
});
export type PlanReview = z.infer<typeof PlanReviewSchema>;

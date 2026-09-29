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
  /** Set from job postings (see `groundInPostings`); absent on requirements built without them. */
  howToShow: z.string().optional(),
  frequency: z.enum(["core", "common", "sometimes"]).optional(),
  /** Share of the researched postings that ask for it, 0 to 1. */
  postingShare: z.number().optional(),
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
  /** The postings the requirements were grounded in, and when. Absent if none were found. */
  sources: z.array(z.object({ title: z.string(), company: z.string(), url: z.string() })).optional(),
  groundedAt: z.string().optional(),
});
export type TargetRequirements = z.infer<typeof TargetRequirementsSchema>;

/** One job posting the researcher found, with the requirements it lists. */
export const PostingSchema = z.object({
  title: z.string(),
  company: z.string(),
  url: z.string().describe("The posting's own page, not a search results or listings page."),
  location: z.string(),
  requirements: z.array(
    z.object({
      text: z.string().describe("The requirement as the posting words it, lightly trimmed."),
      required: z.boolean().describe("false if the posting calls it preferred, a plus or nice to have."),
    }),
  ),
});
export type Posting = z.infer<typeof PostingSchema>;

export const PostingResearchSchema = z.object({
  postings: z.array(PostingSchema).describe("8 to 12 distinct, current postings."),
  notes: z.string().describe("What limited the search, e.g. few postings at this level in this market. Empty if nothing did."),
});
export type PostingResearch = z.infer<typeof PostingResearchSchema>;

/**
 * What the requirements analyst writes. Code then counts `seenIn` against
 * the postings to set each skill's frequency and importance.
 */
export const RequirementsDraftSchema = TargetRequirementsSchema.omit({ sources: true, groundedAt: true }).extend({
  skills: z
    .array(
      RequiredSkill.omit({ howToShow: true, frequency: true, postingShare: true }).extend({
        howToShow: z
          .string()
          .describe("Work a learner can build that shows this skill to an employer, e.g. a SQL analysis of a public dataset, published with its queries."),
        seenIn: z
          .array(z.number())
          .describe("Numbers of the postings that ask for this skill, from the numbered list. Empty if none do or there are no postings."),
      }),
    )
    .describe("8 to 15 skills, most important first."),
});
export type RequirementsDraft = z.infer<typeof RequirementsDraftSchema>;

/**
 * Where a level comes from. The profiler sets the first three, the Assessor
 * sets "assessed", and the mastery keeper sets "practiced" from sessions.
 */
export const SkillBasis = z.enum(["work_history", "self_reported", "inferred", "assessed", "practiced"]);
const ProfileBasis = SkillBasis.exclude(["assessed", "practiced"]);

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
      /** From grounded requirements: how often postings ask, and work that shows the skill. */
      frequency: RequiredSkill.shape.frequency,
      howToShow: z.string().optional(),
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
        projectShows: z
          .array(z.string())
          .describe("Skill ids from the gap that the project shows an employer. Empty when project is null."),
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

/** What the tutor records when a session ends. */
export const SessionReport = z.object({
  summary: z
    .string()
    .describe("Two or three sentences for your own next session: what you covered, how it went, where to pick up."),
  recap: z
    .string()
    .describe('One or two sentences to the learner, in the second person, on what they can now do, e.g. "You wrote your first GROUP BY and rebuilt your leads-by-source pivot."'),
  covered: z.array(z.string()).describe("Topics taught, in plain words."),
  evidence: z
    .array(
      z.object({
        skillId: z.string(),
        level: z.number().describe("The level their work in this session showed, a whole number from 0 to 4."),
        evidence: z.string().describe("What they did that shows it, in one sentence."),
      }),
    )
    .describe("Only skills they actually practised this session."),
  homework: z
    .object({
      task: z.string().describe("A small, concrete task that fits in one session or less."),
      minutes: z.number().describe("About how long it takes."),
    })
    .nullable(),
  milestoneComplete: z
    .boolean()
    .describe("True only when they've achieved the current milestone's visible win."),
  endedEarly: z.boolean().describe("True if the learner stopped before the session's goal."),
});
export type SessionReport = z.infer<typeof SessionReport>;

/** A replan: the revised plan for the remaining work, and what changed and why. */
export const ReplanSchema = PlanSchema.extend({
  whatChanged: z
    .array(z.object({ change: z.string(), because: z.string() }))
    .describe("Each change from the current plan, and the reason, in plain words to the learner."),
});
export type Replan = z.infer<typeof ReplanSchema>;

/** What the learner asked for when they asked to rework their plan. All optional. */
export const ReplanRequestSchema = z.object({
  weeklyHours: z.number().positive().max(40).nullable(),
  sessionMinutes: z.number().int().min(10).max(180).nullable(),
  deadline: z.string().max(200).nullable(),
  note: z.string().max(1000).nullable().describe("What changed, in their words."),
});
export type ReplanRequest = z.infer<typeof ReplanRequestSchema>;

/** The coach's input to a huddle, and its one objection to the proposal. */
export const CoachInputSchema = z.object({
  engagement: z.string().describe("How the learner has actually been engaging, in two sentences."),
  mustRespect: z.array(z.string()).describe("What the new plan must respect to be one they'll keep."),
});
export const CoachObjectionSchema = z.object({
  objection: z.string().nullable().describe("The one change the plan needs to be sustainable for them, or null if none."),
  severity: z.enum(["must_fix", "should_fix"]).nullable(),
});

/** One typed, logged message in a huddle. */
export type HuddleMessage =
  | { from: "system"; kind: "trigger"; source: "learner" | "coach"; request: ReplanRequest; reason: string }
  | { from: "mastery"; kind: "input"; progressed: string[]; stuck: string[]; alreadyMet: string[] }
  | { from: "requirements"; kind: "input"; openMustHaves: string[] }
  | { from: "coach"; kind: "input"; engagement: string; mustRespect: string[] }
  | { from: "planner"; kind: "proposal" | "revision"; title: string; weeks: number; weeklyHours: number }
  | { from: "reviewer" | "coach"; kind: "objection"; severity: "must_fix" | "should_fix"; issue: string }
  | { from: "planner"; kind: "decision"; whatChanged: Replan["whatChanged"]; openIssues: number };

/** The coach option that opens the replan form. The app recognises it by this exact text. */
export const REWORK_OPTION = "Rework my plan";

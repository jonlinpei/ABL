import { z } from "zod";

/** The three ways a career can change (docs/content.md, "Goal discovery"). */
export const CareerDimension = z.enum(["role", "market", "industry"]);
export type CareerDimension = z.infer<typeof CareerDimension>;

/** Where someone works, described so it carries across companies. */
const CareerPosition = z.object({
  role: z.string().describe('The title, as they would say it, e.g. "Marketing operations coordinator".'),
  work: z
    .string()
    .describe(
      "What the role actually involves: responsibilities and the job done. This carries across companies better than a title.",
    ),
  market: z
    .string()
    .describe(
      'Where and for whom: geography, customer segment or niche, e.g. "Bay Area, mid-market B2B SaaS".',
    ),
  industry: z.string().describe('Industry or sector, e.g. "Public K-12 education".'),
});

/** Brief fields the tutor may fill in by inference; the card flags them. */
export const InferableField = z.enum([
  "current.role",
  "current.work",
  "current.market",
  "current.industry",
  "current.experience",
  "target.role",
  "target.work",
  "target.market",
  "target.industry",
  "motivation",
  "successLooksLike",
  "deadline",
  "startingPoint",
  "weeklyHours",
  "sessionMinutes",
  "preferredTimes",
  "pastAttempts",
  "priority",
]);
export type InferableField = z.infer<typeof InferableField>;

/**
 * The career brief: the output of goal discovery, confirmed by the learner
 * before any assessment or plan. Current (where they are) and target (where
 * they want to go) are described by role, market and industry; the roadmap
 * step later works out how to get from one to the other.
 */
export const GoalBriefSchema = z.object({
  headline: z
    .string()
    .describe('The move in a few words, e.g. "Marketing ops to data analyst".'),
  current: CareerPosition.extend({
    experience: z
      .string()
      .describe('Years and level, e.g. "6 years, individual contributor, led one team project".'),
    strengths: z
      .array(z.string())
      .describe("Transferable skills and experience that will help in the target role."),
  }),
  target: CareerPosition,
  changes: z
    .array(CareerDimension)
    .describe(
      "Which of role, market and industry differ between current and target. Empty when they are growing in the career they have.",
    ),
  profileSources: z
    .array(z.enum(["resume", "linkedin", "conversation"]))
    .describe("Where the picture of their current work came from."),
  goalInTheirWords: z.string().describe("The learner's goal, close to how they said it."),
  restatedGoal: z
    .string()
    .describe("The goal restated as a specific, checkable outcome, in one sentence."),
  motivation: z.string().describe("Why they want this."),
  successLooksLike: z.string().describe("What success looks like to them, concretely."),
  deadline: z
    .string()
    .nullable()
    .describe("Target date or key date (job search, notice period, review), or null if none."),
  startingPoint: z
    .string()
    .describe(
      "What they already know or have done toward the target, such as courses, side projects or overlap in their current job.",
    ),
  weeklyHours: z.number().describe("Hours per week they can realistically commit."),
  sessionMinutes: z.number().describe("Preferred length of one learning session, in minutes."),
  preferredTimes: z
    .string()
    .nullable()
    .describe("When they prefer to learn (e.g. weekday mornings), or null if not stated."),
  pastAttempts: z
    .string()
    .nullable()
    .describe("What they tried before and why it stopped, or null if nothing."),
  priority: z
    .enum(["speed", "depth", "practical"])
    .describe("Whether they care most about speed, depth or practical results."),
  interests: z
    .array(z.string())
    .describe("Interests and context useful for analogies and examples."),
  inferred: z
    .array(InferableField)
    .describe("Fields filled in from inference rather than the learner's own words, for them to check."),
});
export type GoalBrief = z.infer<typeof GoalBriefSchema>;

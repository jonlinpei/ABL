import { z } from "zod";

/** Brief fields the tutor may fill in by inference; the card flags them. */
export const InferableField = z.enum([
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
 * The goal brief: the output of goal discovery, confirmed by the learner
 * before any assessment or plan (docs/content.md, "Goal discovery").
 */
export const GoalBriefSchema = z.object({
  subject: z
    .string()
    .describe('A short name for what they are learning, 2 to 5 words, e.g. "Jazz piano".'),
  goalInTheirWords: z.string().describe("The learner's goal, close to how they said it."),
  restatedGoal: z
    .string()
    .describe("The goal restated as a specific, checkable outcome, in one sentence."),
  motivation: z.string().describe("Why they want this."),
  successLooksLike: z.string().describe("What success looks like to them, concretely."),
  deadline: z
    .string()
    .nullable()
    .describe("Target date or key date (exam date, review, job search), or null if none."),
  startingPoint: z.string().describe("What they already know or have done, as they described it."),
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
    .describe("Interests and work context useful for analogies and examples."),
  inferred: z
    .array(InferableField)
    .describe("Fields filled in from inference rather than the learner's own words, for them to check."),
});
export type GoalBrief = z.infer<typeof GoalBriefSchema>;

/** A first roadmap built from a confirmed goal brief (PRD F1, story 4). */
export const RoadmapSchema = z.object({
  title: z.string(),
  summary: z.string().describe("Two or three sentences on the path and why it fits this learner."),
  estimatedWeeks: z.number(),
  weeklyHours: z.number().describe("Must not exceed the learner's weeklyHours."),
  skippedAsKnown: z
    .array(z.string())
    .describe("Topics skipped because the learner's starting point already covers them."),
  milestones: z
    .array(
      z.object({
        title: z.string(),
        weeks: z.number().describe("Weeks this milestone takes."),
        whyItMatters: z.string().describe("One sentence connecting it to the learner's goal."),
        topics: z.array(z.string()),
        visibleWin: z
          .string()
          .describe("A small, concrete thing the learner can do at the end of it."),
      }),
    )
    .describe("3 to 6 milestones, in order."),
  firstSession: z.object({
    title: z.string(),
    minutes: z.number().describe("Must not exceed the learner's sessionMinutes."),
    whatYouWillDo: z.string(),
    outcome: z.string(),
  }),
  assumptions: z
    .array(z.string())
    .describe("Assumptions made where the brief was unclear, to confirm with the learner."),
});
export type Roadmap = z.infer<typeof RoadmapSchema>;

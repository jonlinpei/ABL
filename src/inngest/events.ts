import { eventType } from "inngest";
import { z } from "zod";

/**
 * Events on the learner record that start specialist work. Each mirrors a
 * `learner_events` row; the row is the record, the event is the trigger.
 */
export const briefConfirmed = eventType("learner/brief.confirmed", {
  schema: z.object({
    userId: z.string(),
    briefId: z.string(),
    version: z.number(),
  }),
});

export const assessmentDone = eventType("learner/assessment.done", {
  schema: z.object({
    userId: z.string(),
    briefId: z.string(),
  }),
});

export const sessionCompleted = eventType("learner/session.completed", {
  schema: z.object({
    userId: z.string(),
    sessionId: z.string(),
  }),
});

/** Ask the coach to look at one learner's signals. */
export const coachCheck = eventType("learner/coach.check", {
  schema: z.object({ userId: z.string() }),
});

/** A huddle was opened; run it. */
export const replanRequested = eventType("learner/replan.requested", {
  schema: z.object({ userId: z.string(), huddleId: z.string() }),
});

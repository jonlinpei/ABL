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
    goalId: z.string(),
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
    goalId: z.string(),
  }),
});

/** Ask the coach to look at the signals on one of a learner's goals. */
export const coachCheck = eventType("learner/coach.check", {
  schema: z.object({ userId: z.string(), goalId: z.string() }),
});

/** A learner's chosen reminder time has come: run their coach, then email them. */
export const reminderDue = eventType("learner/reminder.due", {
  schema: z.object({ userId: z.string(), localDate: z.string() }),
});

/** The learner deleted their data; running and waiting work for them stops. */
export const learnerDataDeleted = eventType("learner/data.deleted", {
  schema: z.object({ userId: z.string() }),
});

/** Rebuild one cached target's requirements from current postings. */
export const requirementsRefreshRequested = eventType("requirements/refresh.requested", {
  schema: z.object({ requirementsId: z.string() }),
});

/** A huddle was opened; run it. */
export const replanRequested = eventType("learner/replan.requested", {
  schema: z.object({ userId: z.string(), huddleId: z.string() }),
});

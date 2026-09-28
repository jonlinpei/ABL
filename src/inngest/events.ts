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

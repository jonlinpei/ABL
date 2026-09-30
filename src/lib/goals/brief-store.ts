import { and, eq, sql } from "drizzle-orm";

import { getDb, schema } from "@/db";

import type { GoalBrief } from "./schema";

/**
 * Save a confirmed brief and log `brief_confirmed`, which starts the
 * specialists that follow discovery. With a `goalId` (which the caller has
 * checked is the learner's) it's that goal's next version; without one it
 * starts a new goal. One batch, so the goal, brief and event land together or
 * not at all.
 */
export async function saveConfirmedBrief(
  userId: string,
  brief: GoalBrief,
  goalId?: string,
): Promise<{ id: string; version: number; goalId: string }> {
  const db = getDb();
  const id = crypto.randomUUID();
  const goal = goalId ?? crypto.randomUUID();
  const { careerBriefs, goals, learnerEvents, users } = schema;

  const [, , inserted] = await db.batch([
    db.insert(users).values({ id: userId }).onConflictDoNothing(),
    goalId
      ? // Changing a goal brings it back to the front.
        db.update(goals).set({ lastOpenedAt: new Date() }).where(and(eq(goals.id, goal), eq(goals.userId, userId)))
      : db.insert(goals).values({ id: goal, userId }),
    db
      .insert(careerBriefs)
      .values({
        id,
        userId,
        goalId: goal,
        // Next version of this goal. The unique (goal, version) index rejects
        // the rare double-submit instead of saving two of the same version.
        version: sql`(select coalesce(max(${careerBriefs.version}), 0) + 1 from ${careerBriefs} where ${careerBriefs.goalId} = ${goal})`,
        brief,
      })
      .returning({ id: careerBriefs.id, version: careerBriefs.version }),
    db.insert(learnerEvents).values({
      userId,
      type: "brief_confirmed",
      payload: { briefId: id, goalId: goal },
    }),
  ]);
  return { ...inserted[0]!, goalId: goal };
}

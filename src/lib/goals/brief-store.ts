import { sql } from "drizzle-orm";

import { getDb, schema } from "@/db";

import type { GoalBrief } from "./schema";

/**
 * Save a confirmed brief as the learner's next version and log
 * `brief_confirmed`, which starts the specialists that follow discovery.
 * One batch, so the brief and its event land together or not at all.
 */
export async function saveConfirmedBrief(
  userId: string,
  brief: GoalBrief,
): Promise<{ id: string; version: number }> {
  const db = getDb();
  const id = crypto.randomUUID();
  const { careerBriefs, learnerEvents, users } = schema;

  const [, inserted] = await db.batch([
    db.insert(users).values({ id: userId }).onConflictDoNothing(),
    db
      .insert(careerBriefs)
      .values({
        id,
        userId,
        // Next version for this learner. The unique (user, version) index
        // rejects the rare double-submit instead of saving two version 1s.
        version: sql`(select coalesce(max(${careerBriefs.version}), 0) + 1 from ${careerBriefs} where ${careerBriefs.userId} = ${userId})`,
        brief,
      })
      .returning({ id: careerBriefs.id, version: careerBriefs.version }),
    db.insert(learnerEvents).values({
      userId,
      type: "brief_confirmed",
      payload: { briefId: id },
    }),
  ]);
  return inserted[0]!;
}

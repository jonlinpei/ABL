import { eq } from "drizzle-orm";

import { getDb, schema } from "@/db";

import type { Gap, LearnerProfile, TargetRequirements } from "./schemas";

const { targetRequirements, learnerProfiles, gaps, learnerEvents } = schema;

/** Cached requirements for a target, if another learner already needed them. */
export async function findRequirements(targetKey: string) {
  const [row] = await getDb()
    .select({ id: targetRequirements.id, requirements: targetRequirements.requirements })
    .from(targetRequirements)
    .where(eq(targetRequirements.targetKey, targetKey));
  return row;
}

/**
 * Cache requirements for a target and return the row id. If another learner
 * cached the same target first, theirs wins and is returned.
 */
export async function saveRequirements(targetKey: string, requirements: TargetRequirements) {
  const [inserted] = await getDb()
    .insert(targetRequirements)
    .values({ targetKey, requirements })
    .onConflictDoNothing({ target: targetRequirements.targetKey })
    .returning({ id: targetRequirements.id, requirements: targetRequirements.requirements });
  return inserted ?? (await findRequirements(targetKey))!;
}

/** Save the profile for a brief. A retried step returns the row already saved. */
export async function saveProfile(
  userId: string,
  briefId: string,
  requirementsId: string,
  profile: LearnerProfile,
): Promise<{ id: string }> {
  const db = getDb();
  const [inserted] = await db
    .insert(learnerProfiles)
    .values({ userId, briefId, requirementsId, profile })
    .onConflictDoNothing({ target: learnerProfiles.briefId })
    .returning({ id: learnerProfiles.id });
  if (inserted) return inserted;
  const [existing] = await db
    .select({ id: learnerProfiles.id })
    .from(learnerProfiles)
    .where(eq(learnerProfiles.briefId, briefId));
  return existing!;
}

/** Save the gap for a brief and log `gap_ready`, together. Safe to retry. */
export async function saveGap(userId: string, briefId: string, profileId: string, gap: Gap) {
  const db = getDb();
  const [existing] = await db.select({ id: gaps.id }).from(gaps).where(eq(gaps.briefId, briefId));
  if (existing) return existing;
  const id = crypto.randomUUID();
  await db.batch([
    db.insert(gaps).values({ id, userId, briefId, profileId, gap }),
    db.insert(learnerEvents).values({
      userId,
      type: "gap_ready",
      payload: { briefId, gapId: id, ...gap.counts },
    }),
  ]);
  return { id };
}

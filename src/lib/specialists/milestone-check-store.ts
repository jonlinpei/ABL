import { and, eq, isNull } from "drizzle-orm";

import { getDb, schema } from "@/db";

import type { AssessedSkill, Gap } from "./schemas";
import { checkMasteryWrites } from "./store";

const { learnerEvents, milestoneChecks } = schema;

/** A plan's milestone checks, taken or skipped. */
export async function loadMilestoneChecks(planId: string) {
  return getDb().select().from(milestoneChecks).where(eq(milestoneChecks.planId, planId));
}

/**
 * Save a milestone check: the results, their levels as mastery evidence
 * (spread to every live goal with those skills), and an event. Checking the
 * same milestone twice is a no-op.
 */
export async function saveMilestoneCheck(
  userId: string,
  planId: string,
  milestoneIndex: number,
  before: { skillId: string; level: number }[],
  results: AssessedSkill[],
  gap: Gap,
): Promise<{ saved: boolean }> {
  const db = getDb();
  const now = new Date();
  const [existing] = await db
    .select({ id: milestoneChecks.id })
    .from(milestoneChecks)
    .where(and(eq(milestoneChecks.planId, planId), eq(milestoneChecks.milestoneIndex, milestoneIndex)));
  if (existing) return { saved: false };
  const writes = await checkMasteryWrites(userId, results, gap, null, now);
  await db.batch([
    db.insert(milestoneChecks).values({ userId, planId, milestoneIndex, before, results, completedAt: now }),
    db.insert(learnerEvents).values({ userId, type: "assessment_done", payload: { planId, milestoneIndex, kind: "milestone_check", skills: results.length } }),
    ...writes,
  ]);
  return { saved: true };
}

/** "Not now": the check isn't offered again for this milestone. */
export async function skipMilestoneCheck(userId: string, planId: string, milestoneIndex: number) {
  await getDb()
    .insert(milestoneChecks)
    .values({ userId, planId, milestoneIndex, skippedAt: new Date() })
    .onConflictDoNothing({ target: [milestoneChecks.planId, milestoneChecks.milestoneIndex] });
}

/** The newest completed check on a plan, for its before-and-after. */
export async function latestCompletedCheck(planId: string) {
  const rows = await getDb()
    .select()
    .from(milestoneChecks)
    .where(and(eq(milestoneChecks.planId, planId), isNull(milestoneChecks.skippedAt)));
  return rows.filter((r) => r.completedAt).sort((a, b) => b.completedAt!.getTime() - a.completedAt!.getTime())[0];
}

import { and, desc, eq, gt, inArray, isNull, max, ne } from "drizzle-orm";

import { getDb, schema } from "@/db";
import type { Plan, PlanReview, ReplanRequest } from "@/lib/specialists/schemas";

import { rebuildSummary } from "./versions";

const { careerBriefs, gaps, huddles, learnerEvents, plans } = schema;

/** The goal's current active plan, with its brief. Undefined before the goal's first plan. */
export async function currentPlanOfGoal(goalId: string) {
  const [row] = await getDb()
    .select({ plan: plans, brief: careerBriefs })
    .from(plans)
    .innerJoin(careerBriefs, eq(careerBriefs.id, plans.briefId))
    .where(and(eq(careerBriefs.goalId, goalId), eq(plans.status, "active")))
    .orderBy(desc(plans.createdAt))
    .limit(1);
  return row;
}

/**
 * A new version replaces anything still open from an earlier one: an open
 * rework or proposal on the current plan is declined, and older pending
 * versions (newer than the current plan's brief, but not this one) are
 * declined too. The current plan stays until the learner accepts the new one.
 */
export async function closeOpenUpdates(userId: string, goalId: string, current: { planId: string; briefVersion: number }, keepBriefId: string) {
  const db = getDb();
  const now = new Date();
  const open = await db
    .select({ id: huddles.id, proposedPlanId: huddles.proposedPlanId })
    .from(huddles)
    .where(and(eq(huddles.fromPlanId, current.planId), inArray(huddles.status, ["running", "proposed"])));
  const writes = [
    ...open.map((h) => db.update(huddles).set({ status: "declined", decidedAt: now }).where(eq(huddles.id, h.id))),
    ...open.flatMap((h) => (h.proposedPlanId ? [db.update(plans).set({ status: "declined" }).where(eq(plans.id, h.proposedPlanId))] : [])),
    db
      .update(careerBriefs)
      .set({ declinedAt: now })
      .where(
        and(
          eq(careerBriefs.goalId, goalId),
          eq(careerBriefs.userId, userId),
          gt(careerBriefs.version, current.briefVersion),
          ne(careerBriefs.id, keepBriefId),
          isNull(careerBriefs.declinedAt),
        ),
      ),
  ] as const;
  await db.batch(writes as unknown as Parameters<typeof db.batch>[0]);
}

/** Give a new version the current version's gap: same target, so same skills and levels. */
export async function carryGap(userId: string, fromBriefId: string, toBriefId: string) {
  const db = getDb();
  const [from] = await db.select().from(gaps).where(eq(gaps.briefId, fromBriefId));
  if (!from) return;
  await db
    .insert(gaps)
    .values({ userId, briefId: toBriefId, profileId: from.profileId, gap: from.gap, assessedAt: from.assessedAt })
    .onConflictDoNothing({ target: gaps.briefId });
}

/** A details-only change: the current plan carries on under the new version of the brief. */
export async function adoptBrief(userId: string, planId: string, toBriefId: string) {
  const db = getDb();
  const [{ latest }] = await db.select({ latest: max(plans.version) }).from(plans).where(eq(plans.briefId, toBriefId));
  await db
    .update(plans)
    .set({ briefId: toBriefId, version: (latest ?? 0) + 1 })
    .where(and(eq(plans.id, planId), eq(plans.userId, userId)));
}

/**
 * Save a rebuilt version's plan as a proposal next to the current plan, for
 * the learner to compare and choose. Returns null (and saves nothing) when
 * this version isn't the goal's pending one any more, e.g. because a newer
 * version was confirmed while it was being built. Saving twice returns the
 * proposal already saved.
 */
export async function saveVersionProposal(
  userId: string,
  briefId: string,
  plan: Plan,
  review: PlanReview,
): Promise<{ id: string } | null> {
  const db = getDb();
  const [brief] = await db.select().from(careerBriefs).where(eq(careerBriefs.id, briefId));
  if (!brief || brief.declinedAt) return null;
  const current = await currentPlanOfGoal(brief.goalId);
  if (!current) return null;
  const [already] = await db.select({ planId: huddles.proposedPlanId }).from(huddles).where(eq(huddles.toBriefId, briefId)).limit(1);
  if (already?.planId) return { id: already.planId };

  const request: ReplanRequest = { weeklyHours: null, sessionMinutes: null, deadline: null, note: null };
  const proposal = { ...plan, whatChanged: [], changeSummary: rebuildSummary(current.brief.brief, brief.brief, current.plan.plan, plan) };
  const planId = crypto.randomUUID();
  const now = new Date();
  // Anything else open on the current plan gives way to this version.
  const open = await db
    .select({ id: huddles.id, proposedPlanId: huddles.proposedPlanId })
    .from(huddles)
    .where(and(eq(huddles.fromPlanId, current.plan.id), inArray(huddles.status, ["running", "proposed"])));
  await db.batch([
    ...open.map((h) => db.update(huddles).set({ status: "declined", decidedAt: now }).where(eq(huddles.id, h.id))),
    db.insert(plans).values({ id: planId, userId, briefId, version: 1, plan: proposal, review, status: "proposed" }),
    db.insert(huddles).values({
      userId,
      fromPlanId: current.plan.id,
      toBriefId: briefId,
      proposedPlanId: planId,
      status: "proposed",
      request,
      messages: [{ from: "system", kind: "trigger", source: "learner", request, reason: "The learner changed their goal." }],
    }),
    db.insert(learnerEvents).values({
      userId,
      type: "plan_proposed",
      payload: { planId, fromPlanId: current.plan.id, toBriefId: briefId, kind: "goal_version" },
    }),
  ] as unknown as Parameters<typeof db.batch>[0]);
  return { id: planId };
}

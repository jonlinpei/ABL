import { and, desc, eq, inArray, max } from "drizzle-orm";

import { getDb, schema } from "@/db";

import type { HuddleMessage, PlanReview, Replan, ReplanRequest } from "./schemas";

const { huddles, learnerEvents, plans } = schema;

/**
 * Open a huddle on the learner's active plan, or return the one already
 * open (the partial unique index allows one running or proposed per plan).
 */
export async function startHuddle(
  userId: string,
  fromPlanId: string,
  request: ReplanRequest,
  source: "learner" | "coach",
  reason: string,
): Promise<{ id: string; created: boolean }> {
  const db = getDb();
  const [created] = await db
    .insert(huddles)
    .values({ userId, fromPlanId, request, messages: [{ from: "system", kind: "trigger", source, request, reason }] })
    .onConflictDoNothing()
    .returning({ id: huddles.id });
  if (created) {
    await db.insert(learnerEvents).values({ userId, type: "replan_requested", payload: { huddleId: created.id, fromPlanId, source } });
    return { id: created.id, created: true };
  }
  const [open] = await db
    .select({ id: huddles.id })
    .from(huddles)
    .where(and(eq(huddles.fromPlanId, fromPlanId), inArray(huddles.status, ["running", "proposed"])));
  return { id: open!.id, created: false };
}

export async function loadHuddle(huddleId: string) {
  const [row] = await getDb().select().from(huddles).where(eq(huddles.id, huddleId));
  return row;
}

/** The learner's newest open huddle, with its proposed plan once there is one. */
export async function openHuddle(userId: string) {
  const db = getDb();
  const [row] = await db
    .select()
    .from(huddles)
    .where(and(eq(huddles.userId, userId), inArray(huddles.status, ["running", "proposed"])))
    .orderBy(desc(huddles.createdAt))
    .limit(1);
  if (!row) return undefined;
  const [proposed] = row.proposedPlanId
    ? await db.select().from(plans).where(eq(plans.id, row.proposedPlanId))
    : [];
  return { huddle: row, proposed };
}

/**
 * Save the huddle's result as the next plan version, "proposed" until the
 * learner accepts it, and log `plan_proposed`. A retried step finds the
 * proposal already saved.
 */
export async function saveProposal(
  huddleId: string,
  replan: Replan,
  review: PlanReview,
  messages: HuddleMessage[],
): Promise<{ planId: string }> {
  const db = getDb();
  const huddle = await loadHuddle(huddleId);
  if (!huddle) throw new Error(`No huddle ${huddleId}`);
  if (huddle.proposedPlanId) return { planId: huddle.proposedPlanId };
  const [from] = await db.select().from(plans).where(eq(plans.id, huddle.fromPlanId));
  const [{ latest }] = await db.select({ latest: max(plans.version) }).from(plans).where(eq(plans.briefId, from!.briefId));
  const planId = crypto.randomUUID();
  await db.batch([
    db.insert(plans).values({
      id: planId,
      userId: huddle.userId,
      briefId: from!.briefId,
      version: (latest ?? 0) + 1,
      plan: replan,
      review,
      status: "proposed",
    }),
    db.update(huddles).set({ status: "proposed", proposedPlanId: planId, messages }).where(eq(huddles.id, huddleId)),
    db.insert(learnerEvents).values({
      userId: huddle.userId,
      type: "plan_proposed",
      payload: { huddleId, planId, fromPlanId: huddle.fromPlanId, changes: replan.whatChanged.length },
    }),
  ]);
  return { planId };
}

/** Mark a huddle that couldn't produce a plan, so the learner isn't left waiting. */
export async function failHuddle(huddleId: string) {
  await getDb().update(huddles).set({ status: "failed", decidedAt: new Date() }).where(eq(huddles.id, huddleId));
}

/**
 * The learner accepts the proposed plan (it becomes active and the old one
 * is superseded) or keeps their current plan (the proposal is declined).
 */
export async function decideHuddle(userId: string, huddleId: string, accept: boolean): Promise<{ decided: boolean }> {
  const db = getDb();
  const huddle = await loadHuddle(huddleId);
  if (!huddle || huddle.userId !== userId || huddle.status !== "proposed" || !huddle.proposedPlanId) {
    return { decided: false };
  }
  const now = new Date();
  const decision = accept
    ? [
        db.update(plans).set({ status: "superseded" }).where(eq(plans.id, huddle.fromPlanId)),
        db.update(plans).set({ status: "active" }).where(eq(plans.id, huddle.proposedPlanId)),
      ]
    : [db.update(plans).set({ status: "declined" }).where(eq(plans.id, huddle.proposedPlanId))];
  await db.batch([
    db.update(huddles).set({ status: accept ? "accepted" : "declined", decidedAt: now }).where(eq(huddles.id, huddleId)),
    ...decision,
    db.insert(learnerEvents).values({
      userId,
      type: accept ? "plan_accepted" : "plan_declined",
      payload: { huddleId, planId: huddle.proposedPlanId, fromPlanId: huddle.fromPlanId },
    }),
  ]);
  return { decided: true };
}

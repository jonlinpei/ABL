import { and, desc, eq, inArray, isNull, max } from "drizzle-orm";

import { getDb, schema } from "@/db";

import type { HuddleMessage, PlanReview, Replan, ReplanRequest } from "./schemas";

const { careerBriefs, huddles, learnerEvents, plans, sessions } = schema;

/**
 * Open a huddle on the learner's active plan, or return the one already
 * open (the partial unique index allows one running or proposed per plan).
 * With `toBriefId`, it reworks the plan toward a new version of the goal's
 * brief, and the proposal belongs to that version.
 */
export async function startHuddle(
  userId: string,
  fromPlanId: string,
  request: ReplanRequest,
  source: "learner" | "coach",
  reason: string,
  toBriefId: string | null = null,
): Promise<{ id: string; created: boolean }> {
  const db = getDb();
  const [created] = await db
    .insert(huddles)
    .values({ userId, fromPlanId, toBriefId, request, messages: [{ from: "system", kind: "trigger", source, request, reason }] })
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

/** The open huddle on this plan, with its proposed plan once there is one. */
export async function openHuddle(userId: string, planId: string) {
  const db = getDb();
  const [row] = await db
    .select()
    .from(huddles)
    .where(and(eq(huddles.userId, userId), eq(huddles.fromPlanId, planId), inArray(huddles.status, ["running", "proposed"])))
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
  // A rework toward a new version of the brief is that version's plan.
  const briefId = huddle.toBriefId ?? from!.briefId;
  const [{ latest }] = await db.select({ latest: max(plans.version) }).from(plans).where(eq(plans.briefId, briefId));
  const planId = crypto.randomUUID();
  await db.batch([
    db.insert(plans).values({
      id: planId,
      userId: huddle.userId,
      briefId,
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

/**
 * Mark a huddle that couldn't produce a plan, so the learner isn't left
 * waiting. A failed rework toward a new version declines that version too,
 * so the goal carries on from its current one.
 */
export async function failHuddle(huddleId: string) {
  const db = getDb();
  const now = new Date();
  const huddle = await loadHuddle(huddleId);
  await db.update(huddles).set({ status: "failed", decidedAt: now }).where(eq(huddles.id, huddleId));
  if (huddle?.toBriefId) await db.update(careerBriefs).set({ declinedAt: now }).where(eq(careerBriefs.id, huddle.toBriefId));
}

/**
 * The learner accepts the proposed plan (it becomes active and the old one
 * is superseded) or keeps their current plan (the proposal is declined).
 */
export async function decideHuddle(
  userId: string,
  huddleId: string,
  accept: boolean,
): Promise<{ decided: true } | { decided: false; reason: "not_open" | "session_active" }> {
  const db = getDb();
  const huddle = await loadHuddle(huddleId);
  if (!huddle || huddle.userId !== userId || huddle.status !== "proposed" || !huddle.proposedPlanId) {
    return { decided: false, reason: "not_open" };
  }
  // Switching plans mid-session would strand the session on the old plan.
  if (accept) {
    const [active] = await db
      .select({ id: sessions.id })
      .from(sessions)
      .where(and(eq(sessions.planId, huddle.fromPlanId), isNull(sessions.endedAt)))
      .limit(1);
    if (active) return { decided: false, reason: "session_active" };
  }
  const now = new Date();
  const decision = accept
    ? [
        db.update(plans).set({ status: "superseded" }).where(eq(plans.id, huddle.fromPlanId)),
        db.update(plans).set({ status: "active" }).where(eq(plans.id, huddle.proposedPlanId)),
      ]
    : [
        db.update(plans).set({ status: "declined" }).where(eq(plans.id, huddle.proposedPlanId)),
        // Keeping the current plan over a new version of the goal keeps the current version too.
        ...(huddle.toBriefId ? [db.update(careerBriefs).set({ declinedAt: now }).where(eq(careerBriefs.id, huddle.toBriefId))] : []),
      ];
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

import { and, desc, eq, inArray, isNotNull, lt, ne } from "drizzle-orm";

import { getDb, schema } from "@/db";
import type { GoalRow, GoalStatus } from "@/db/schema";
import { currentMilestone } from "@/lib/specialists/tutor";

import { applyGoalAction, purgeAt, purgeCutoff, type GoalAction } from "./lifecycle";

const { careerBriefs, goals, learnerEvents, plans, sessions } = schema;

/** A learner's goal, or undefined if it isn't theirs. Removed goals are included; callers decide. */
export async function loadGoal(userId: string, goalId: string): Promise<GoalRow | undefined> {
  const [row] = await getDb()
    .select()
    .from(goals)
    .where(and(eq(goals.id, goalId), eq(goals.userId, userId)));
  return row;
}

/** The active goal the learner opened most recently: where they land, and where a request without a goal goes. */
export async function currentGoal(userId: string): Promise<GoalRow | undefined> {
  const [row] = await getDb()
    .select()
    .from(goals)
    .where(and(eq(goals.userId, userId), eq(goals.status, "active")))
    .orderBy(desc(goals.lastOpenedAt))
    .limit(1);
  return row;
}

/**
 * The goal a request is about: the one it names, if it's the learner's and
 * not removed, or their current goal when it names none.
 */
export async function resolveGoal(userId: string, goalId: string | null | undefined): Promise<GoalRow | undefined> {
  if (!goalId) return currentGoal(userId);
  const goal = await loadGoal(userId, goalId);
  return goal && goal.status !== "removed" ? goal : undefined;
}

/** The learner opened this goal: it's the one they come back to. */
export async function touchGoal(userId: string, goalId: string) {
  await getDb()
    .update(goals)
    .set({ lastOpenedAt: new Date() })
    .where(and(eq(goals.id, goalId), eq(goals.userId, userId), ne(goals.status, "removed")));
}

export interface GoalSummary {
  id: string;
  status: GoalStatus;
  /** The target role, from the goal's newest brief. */
  title: string;
  industry: string;
  planTitle: string | null;
  /** Milestones done and total, once there's a plan. */
  progress: { done: number; total: number } | null;
  lastSessionAt: string | null;
  lastOpenedAt: string;
  completedAt: string | null;
  /** When a removed goal will be purged. */
  purgeAt: string | null;
}

/** Every goal the learner has, newest-opened first, with enough to show a card for each. */
export async function listGoals(userId: string): Promise<GoalSummary[]> {
  const db = getDb();
  const rows = await db.select().from(goals).where(eq(goals.userId, userId)).orderBy(desc(goals.lastOpenedAt));
  if (rows.length === 0) return [];
  const ids = rows.map((g) => g.id);

  // Newest brief per goal.
  const briefs = await db
    .selectDistinctOn([careerBriefs.goalId], { id: careerBriefs.id, goalId: careerBriefs.goalId, brief: careerBriefs.brief })
    .from(careerBriefs)
    .where(inArray(careerBriefs.goalId, ids))
    .orderBy(careerBriefs.goalId, desc(careerBriefs.version));
  const briefIds = briefs.map((b) => b.id);

  // Newest active plan per brief, and its ended sessions.
  const activePlans = briefIds.length
    ? await db
        .selectDistinctOn([plans.briefId], { id: plans.id, briefId: plans.briefId, plan: plans.plan })
        .from(plans)
        .where(and(inArray(plans.briefId, briefIds), eq(plans.status, "active")))
        .orderBy(plans.briefId, desc(plans.version))
    : [];
  const ended = activePlans.length
    ? await db
        .select({ planId: sessions.planId, milestoneIndex: sessions.milestoneIndex, report: sessions.report, endedAt: sessions.endedAt })
        .from(sessions)
        .where(and(inArray(sessions.planId, activePlans.map((p) => p.id)), isNotNull(sessions.endedAt)))
        .orderBy(sessions.endedAt)
    : [];

  const briefByGoal = new Map(briefs.map((b) => [b.goalId, b]));
  const planByBrief = new Map(activePlans.map((p) => [p.briefId, p]));
  return rows.map((g) => {
    const brief = briefByGoal.get(g.id);
    const plan = brief && planByBrief.get(brief.id);
    const history = plan
      ? ended
          .filter((s) => s.planId === plan.id && s.report)
          .map((s) => ({ milestoneIndex: s.milestoneIndex, report: s.report!, endedAt: s.endedAt!.toISOString() }))
      : [];
    return {
      id: g.id,
      status: g.status,
      title: brief?.brief.target.role ?? "New goal",
      industry: brief?.brief.target.industry ?? "",
      planTitle: plan?.plan.title ?? null,
      progress: plan ? { done: currentMilestone(plan.plan, history), total: plan.plan.milestones.length } : null,
      lastSessionAt: history.at(-1)?.endedAt ?? null,
      lastOpenedAt: g.lastOpenedAt.toISOString(),
      completedAt: g.completedAt?.toISOString() ?? null,
      purgeAt: g.removedAt ? purgeAt(g.removedAt).toISOString() : null,
    };
  });
}

/**
 * Pause, resume, complete, reopen, remove or restore a goal, and log it.
 * Returns the updated goal, or null if the goal isn't theirs or the action
 * doesn't apply to it.
 */
export async function setGoalStatus(userId: string, goalId: string, action: GoalAction, now = new Date()) {
  const goal = await loadGoal(userId, goalId);
  const next = goal && applyGoalAction(goal, action, now);
  if (!goal || !next) return null;
  const db = getDb();
  const [updated] = await db
    .update(goals)
    .set({ ...next, ...(action === "restore" || action === "resume" || action === "reopen" ? { lastOpenedAt: now } : {}) })
    // Only from the status it was read in, so two tabs can't both apply an action.
    .where(and(eq(goals.id, goalId), eq(goals.status, goal.status)))
    .returning();
  if (updated) {
    await db.insert(learnerEvents).values({ userId, type: "goal_status_changed", payload: { goalId, action, from: goal.status, to: next.status } });
  }
  return updated ?? null;
}

/**
 * Delete a removed goal now, with its briefs, plans, sessions and everything
 * built for it. The learner's skills (`skill_mastery`) and glossary stay.
 */
export async function purgeGoal(userId: string, goalId: string): Promise<{ purged: boolean }> {
  const db = getDb();
  const [deleted] = await db
    .delete(goals)
    .where(and(eq(goals.id, goalId), eq(goals.userId, userId), eq(goals.status, "removed")))
    .returning({ id: goals.id });
  if (deleted) await db.insert(learnerEvents).values({ userId, type: "goal_purged", payload: { goalId, early: true } });
  return { purged: !!deleted };
}

/** Purge every goal removed more than 30 days ago. Returns how many. */
export async function purgeExpiredGoals(now = new Date()): Promise<number> {
  const db = getDb();
  const deleted = await db
    .delete(goals)
    .where(and(eq(goals.status, "removed"), lt(goals.removedAt, purgeCutoff(now))))
    .returning({ id: goals.id, userId: goals.userId });
  if (deleted.length > 0) {
    await db
      .insert(learnerEvents)
      .values(deleted.map((g) => ({ userId: g.userId, type: "goal_purged" as const, payload: { goalId: g.id, early: false } })));
  }
  return deleted.length;
}

/** Every active goal with an active plan, for the daily coach check. */
export async function activeGoalPlans(): Promise<{ userId: string; goalId: string }[]> {
  return getDb()
    .selectDistinct({ userId: goals.userId, goalId: goals.id })
    .from(goals)
    .innerJoin(careerBriefs, eq(careerBriefs.goalId, goals.id))
    .innerJoin(plans, and(eq(plans.briefId, careerBriefs.id), eq(plans.status, "active")))
    .where(eq(goals.status, "active"));
}

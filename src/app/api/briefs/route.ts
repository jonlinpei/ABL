import { auth } from "@clerk/nextjs/server";

import { isDatabaseConfigured } from "@/db";
import { inngest } from "@/inngest/client";
import { briefConfirmed, replanRequested } from "@/inngest/events";
import { saveConfirmedBrief } from "@/lib/goals/brief-store";
import { goalForRequest } from "@/lib/goals/request-goal";
import { GoalBriefSchema, type GoalBrief } from "@/lib/goals/schema";
import { adoptBrief, carryGap, closeOpenUpdates, currentPlanOfGoal } from "@/lib/goals/version-store";
import { classifyGoalChange, replanRequestFor, type GoalChange } from "@/lib/goals/versions";
import { startHuddle } from "@/lib/specialists/huddle-store";

export interface SaveBriefResponse {
  id: string;
  version: number;
  goalId: string;
  /** For a change to a goal with a plan: what the change needs. Null for a new goal or one still being set up. */
  change: GoalChange | null;
}

/**
 * Save the brief the learner just confirmed: a new goal, or with `goalId`,
 * the next version of that goal. A goal with a plan keeps it until the
 * learner accepts the new version's plan (see `startVersion`).
 */
export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return new Response("Unauthorized", { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = GoalBriefSchema.safeParse(body?.brief);
  if (!parsed.success) {
    return Response.json({ error: "Invalid career brief", issues: parsed.error.issues }, { status: 400 });
  }
  if (!isDatabaseConfigured()) {
    return Response.json(
      { error: "No database is configured, so the brief wasn't saved. Set DATABASE_URL in .env.local." },
      { status: 503 },
    );
  }

  let goalId: string | undefined;
  if (body?.goalId != null) {
    const resolved = await goalForRequest(userId, body.goalId);
    if ("error" in resolved) return resolved.error;
    goalId = resolved.goal.id;
  }

  try {
    const current = goalId ? await currentPlanOfGoal(goalId) : undefined;
    const saved = await saveConfirmedBrief(userId, parsed.data, goalId);
    if (!current) {
      await startLifecycle(userId, saved);
      return Response.json({ ...saved, change: null } satisfies SaveBriefResponse);
    }
    const change = await startVersion(userId, saved, parsed.data, current);
    return Response.json({ ...saved, change } satisfies SaveBriefResponse);
  } catch (err) {
    console.error("[briefs] save failed", err);
    return Response.json({ error: "Couldn't save your brief. Please try again." }, { status: 500 });
  }
}

/**
 * A new version of a goal that already has a plan. What it changed decides
 * what happens, and in every case the current plan stays the learner's until
 * they choose:
 * - `rebuild` runs the full lifecycle, which ends in a proposal to compare;
 * - `replan` carries the gap over and opens a rework of the current plan
 *   toward the new version, also ending in a proposal;
 * - `details` carries the gap over and moves the current plan to the new
 *   version, with nothing to decide.
 */
async function startVersion(
  userId: string,
  saved: { id: string; version: number; goalId: string },
  brief: GoalBrief,
  current: NonNullable<Awaited<ReturnType<typeof currentPlanOfGoal>>>,
): Promise<GoalChange> {
  const change = classifyGoalChange(current.brief.brief, brief);
  if (change === "details") {
    // Nothing the plan depends on: it carries on under the new version, and a
    // rework the learner has open stays open.
    await carryGap(userId, current.brief.id, saved.id);
    await adoptBrief(userId, current.plan.id, saved.id);
    return change;
  }
  // A new plan is coming: it replaces anything still open from before.
  await closeOpenUpdates(userId, saved.goalId, { planId: current.plan.id, briefVersion: current.brief.version }, saved.id);
  if (change === "rebuild") {
    await startLifecycle(userId, saved);
    return change;
  }
  await carryGap(userId, current.brief.id, saved.id);
  const { request, reason } = replanRequestFor(current.brief.brief, brief);
  const { id, created } = await startHuddle(userId, current.plan.id, request, "learner", reason, saved.id);
  if (created) {
    try {
      await inngest.send(replanRequested.create({ userId, huddleId: id }));
    } catch (err) {
      console.error("[briefs] couldn't start the rework", err);
    }
  }
  return change;
}

/**
 * Start the specialists that follow discovery. The saved brief and its
 * `learner_events` row are the record, so if the job runner is unreachable the
 * learner's confirmation still stands; the event can be re-sent from the log.
 */
async function startLifecycle(userId: string, saved: Omit<SaveBriefResponse, "change">) {
  try {
    await inngest.send(briefConfirmed.create({ userId, briefId: saved.id, version: saved.version, goalId: saved.goalId }));
  } catch (err) {
    console.error("[briefs] couldn't start the learner lifecycle", err);
  }
}

import { auth } from "@clerk/nextjs/server";

import { isDatabaseConfigured } from "@/db";
import { selectSkillsToCheck } from "@/lib/specialists/assessment";
import { openCheckIn } from "@/lib/specialists/coach-store";
import { openHuddle } from "@/lib/specialists/huddle-store";
import type { Gap, Plan, Replan, SessionReport } from "@/lib/specialists/schemas";
import type { GoalStatus } from "@/db/schema";
import { currentGoal } from "@/lib/goals/goal-store";
import { goalForRequest, goalIdParam } from "@/lib/goals/request-goal";
import { countEndedSessions, loadEarlierSessions, loadGoalState, loadSessions } from "@/lib/specialists/store";
import { currentMilestone } from "@/lib/specialists/tutor";

export type LearnerStatus = GoalStage & {
  /** The goal this status is for; null only before the learner has any goal. */
  goal: { id: string; status: GoalStatus; completedAt: string | null } | null;
};

type GoalStage =
  | { stage: "no_brief" }
  | { stage: "building_gap" }
  | { stage: "ready_to_check"; skills: { skillId: string; name: string }[] }
  | { stage: "planning"; gap: Gap; assessed: boolean }
  | { stage: "plan_ready"; gap: Gap; assessed: boolean; plan: Plan; progress: PlanProgress };

export interface PlanProgress {
  /** The milestone being worked on; equal to the milestone count when the plan is done. */
  milestoneIndex: number;
  sessionsDone: number;
  activeSessionId: string | null;
  lastReport: SessionReport | null;
  /** The coach's newest unanswered check-in, if any. */
  checkIn: { id: string; message: string; options: string[] } | null;
  /**
   * A new plan in progress, or waiting for the learner's decision: a rework
   * of this plan, or the plan for an updated version of the goal.
   */
  replan:
    | { huddleId: string; kind: ProposalKind; status: "running" }
    | { huddleId: string; kind: ProposalKind; status: "proposed"; proposal: Replan }
    | null;
  /**
   * An updated version of the goal being set up before there's a plan to
   * compare: its skills picture is being built, or it needs a short skills check.
   */
  update: { status: "building" } | { status: "check"; skills: { skillId: string; name: string }[] } | null;
}

export type ProposalKind = "rework" | "update";

/** Where the learner is on a goal (`?goalId=`, or their current goal), for the app to poll. */
export async function GET(req: Request) {
  const { userId } = await auth();
  if (!userId) return new Response("Unauthorized", { status: 401 });
  if (!isDatabaseConfigured()) return Response.json({ error: "No database is configured." }, { status: 503 });

  const requested = goalIdParam(req);
  let goal;
  if (requested) {
    const resolved = await goalForRequest(userId, requested);
    if ("error" in resolved) return resolved.error;
    goal = resolved.goal;
  } else {
    goal = await currentGoal(userId);
    if (!goal) return Response.json({ stage: "no_brief", goal: null } satisfies LearnerStatus);
  }
  const state = await loadGoalState(userId, goal.id);
  let status: GoalStage;
  if (!state) status = { stage: "no_brief" };
  else if (!state.gap) status = { stage: "building_gap" };
  else {
    const skills = selectSkillsToCheck(state.gap.gap);
    const assessed = !!state.gap.assessedAt;
    if (!assessed && skills.length > 0) {
      status = { stage: "ready_to_check", skills: skills.map((s) => ({ skillId: s.skillId, name: s.name })) };
    } else if (!state.plan) {
      status = { stage: "planning", gap: state.gap.gap, assessed };
    } else {
      const pending = state.pending;
      const pendingSkills = pending?.gap && !pending.gap.assessedAt ? selectSkillsToCheck(pending.gap.gap) : [];
      const [rows, note, open, sessionsDone] = await Promise.all([
        loadSessions(state.plan.id),
        openCheckIn(userId, state.plan.id),
        openHuddle(userId, state.plan.id),
        countEndedSessions(userId, goal.id),
      ]);
      const history = rows
        .filter((r) => r.endedAt && r.report)
        .map((r) => ({ milestoneIndex: r.milestoneIndex, report: r.report!, endedAt: r.endedAt!.toISOString() }));
      status = {
        stage: "plan_ready",
        gap: state.gap.gap,
        assessed,
        plan: state.plan.plan,
        progress: {
          milestoneIndex: currentMilestone(state.plan.plan, history),
          // Counted across plan versions, so a reworked plan doesn't read as a fresh start.
          sessionsDone,
          activeSessionId: rows.find((r) => !r.endedAt)?.id ?? null,
          lastReport:
            history.at(-1)?.report ??
            (await loadEarlierSessions(userId, goal.id, state.plan.id, 1)).at(-1)?.report ??
            null,
          checkIn: note?.message ? { id: note.id, message: note.message, options: note.options } : null,
          replan: !open
            ? null
            : open.huddle.status === "proposed" && open.proposed
              ? { huddleId: open.huddle.id, kind: open.huddle.toBriefId ? "update" : "rework", status: "proposed", proposal: open.proposed.plan as Replan }
              : { huddleId: open.huddle.id, kind: open.huddle.toBriefId ? "update" : "rework", status: "running" },
          // Until the update's plan is ready (then it's the proposal above).
          update:
            !pending || open
              ? null
              : pendingSkills.length > 0
                ? { status: "check", skills: pendingSkills.map((s) => ({ skillId: s.skillId, name: s.name })) }
                : { status: "building" },
        },
      };
    }
  }
  return Response.json({
    ...status,
    goal: { id: goal.id, status: goal.status, completedAt: goal.completedAt?.toISOString() ?? null },
  } satisfies LearnerStatus);
}

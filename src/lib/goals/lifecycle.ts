import type { GoalStatus } from "@/db/schema";

/** How long a removed goal can be restored before it's purged. */
export const REMOVED_GOAL_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

export const GOAL_ACTIONS = ["pause", "resume", "complete", "reopen", "remove", "restore"] as const;
export type GoalAction = (typeof GOAL_ACTIONS)[number];

export interface GoalState {
  status: GoalStatus;
  statusBefore: Exclude<GoalStatus, "removed"> | null;
  completedAt: Date | null;
  removedAt: Date | null;
}

/**
 * The goal after a learner's action, or null when the action doesn't apply
 * (resuming a goal that isn't paused, say). Removing remembers the status
 * before, so restoring puts the goal back where it was.
 */
export function applyGoalAction(goal: GoalState, action: GoalAction, now: Date): GoalState | null {
  switch (action) {
    case "pause":
      return goal.status === "active" ? { ...goal, status: "paused" } : null;
    case "resume":
      return goal.status === "paused" ? { ...goal, status: "active" } : null;
    case "complete":
      return goal.status === "active" || goal.status === "paused"
        ? { ...goal, status: "completed", completedAt: now }
        : null;
    case "reopen":
      return goal.status === "completed" ? { ...goal, status: "active", completedAt: null } : null;
    case "remove":
      return goal.status === "removed"
        ? null
        : { ...goal, status: "removed", statusBefore: goal.status, removedAt: now };
    case "restore":
      return goal.status === "removed"
        ? { ...goal, status: goal.statusBefore ?? "active", statusBefore: null, removedAt: null }
        : null;
  }
}

/** When a removed goal is purged. */
export function purgeAt(removedAt: Date): Date {
  return new Date(removedAt.getTime() + REMOVED_GOAL_DAYS * DAY_MS);
}

/** Removed goals whose restore window has closed are removed before this. */
export function purgeCutoff(now: Date): Date {
  return new Date(now.getTime() - REMOVED_GOAL_DAYS * DAY_MS);
}

/** Whole days left before a removed goal is purged, at least 0. */
export function daysUntilPurge(removedAt: Date, now: Date): number {
  return Math.max(0, Math.ceil((purgeAt(removedAt).getTime() - now.getTime()) / DAY_MS));
}

/** Goals the learner is working on get sessions, replans and a coach; paused and completed ones wait. */
export function isLearnable(status: GoalStatus): boolean {
  return status === "active";
}

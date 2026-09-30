import { describe, expect, it } from "vitest";

import type { GoalStatus } from "@/db/schema";

import {
  applyGoalAction,
  daysUntilPurge,
  GOAL_ACTIONS,
  isLearnable,
  purgeAt,
  purgeCutoff,
  REMOVED_GOAL_DAYS,
  type GoalAction,
  type GoalState,
} from "./lifecycle";

const DAY = 24 * 60 * 60 * 1000;
const now = new Date("2026-09-29T12:00:00.000Z");
const earlier = new Date("2026-09-01T12:00:00.000Z");
const state = (status: GoalStatus, over: Partial<GoalState> = {}): GoalState => ({
  status,
  statusBefore: null,
  completedAt: status === "completed" ? earlier : null,
  removedAt: status === "removed" ? earlier : null,
  ...(status === "removed" ? { statusBefore: "active" as const } : {}),
  ...over,
});

// The status each action leads to from each status, or null where it doesn't apply.
const expected: Record<GoalAction, Record<GoalStatus, GoalStatus | null>> = {
  pause: { active: "paused", paused: null, completed: null, removed: null },
  resume: { active: null, paused: "active", completed: null, removed: null },
  complete: { active: "completed", paused: "completed", completed: null, removed: null },
  reopen: { active: null, paused: null, completed: "active", removed: null },
  remove: { active: "removed", paused: "removed", completed: "removed", removed: null },
  restore: { active: null, paused: null, completed: null, removed: "active" },
};

describe("applyGoalAction", () => {
  it("covers every action", () => {
    expect(Object.keys(expected).sort()).toEqual([...GOAL_ACTIONS].sort());
  });

  for (const action of GOAL_ACTIONS) {
    for (const [from, to] of Object.entries(expected[action]) as [GoalStatus, GoalStatus | null][]) {
      it(`${action} from ${from} ${to ? `gives ${to}` : "doesn't apply"}`, () => {
        const next = applyGoalAction(state(from), action, now);
        if (to === null) expect(next).toBeNull();
        else expect(next?.status).toBe(to);
      });
    }
  }

  it("complete sets completedAt; reopen clears it", () => {
    const completed = applyGoalAction(state("active"), "complete", now)!;
    expect(completed).toMatchObject({ status: "completed", completedAt: now });
    expect(applyGoalAction(state("paused"), "complete", now)!.completedAt).toBe(now);
    const reopened = applyGoalAction(completed, "reopen", now)!;
    expect(reopened).toMatchObject({ status: "active", completedAt: null });
  });

  it("remove remembers the status before and when it was removed", () => {
    expect(applyGoalAction(state("paused"), "remove", now)).toEqual({
      status: "removed",
      statusBefore: "paused",
      completedAt: null,
      removedAt: now,
    });
  });

  it("restore returns the goal to the status it had before removal", () => {
    const removed = applyGoalAction(state("paused"), "remove", now)!;
    expect(applyGoalAction(removed, "restore", now)).toEqual({
      status: "paused",
      statusBefore: null,
      completedAt: null,
      removedAt: null,
    });

    const completed = applyGoalAction(state("active"), "complete", earlier)!;
    const restoredCompleted = applyGoalAction(applyGoalAction(completed, "remove", now)!, "restore", now)!;
    expect(restoredCompleted).toMatchObject({ status: "completed", completedAt: earlier, statusBefore: null, removedAt: null });
  });

  it("restore falls back to active when the status before is unknown", () => {
    expect(applyGoalAction(state("removed", { statusBefore: null }), "restore", now)?.status).toBe("active");
  });

  it("doesn't change the goal it's given", () => {
    const goal = state("active");
    applyGoalAction(goal, "remove", now);
    expect(goal).toEqual(state("active"));
  });
});

describe("purge window", () => {
  it("is 30 days", () => {
    expect(REMOVED_GOAL_DAYS).toBe(30);
    expect(purgeAt(earlier).getTime() - earlier.getTime()).toBe(30 * DAY);
    expect(now.getTime() - purgeCutoff(now).getTime()).toBe(30 * DAY);
  });

  it("purges a goal removed just over 30 days ago, and keeps one removed exactly 30 days ago", () => {
    const cutoff = purgeCutoff(now);
    const justOver = new Date(now.getTime() - 30 * DAY - 1);
    const exactly = new Date(now.getTime() - 30 * DAY);
    const justUnder = new Date(now.getTime() - 30 * DAY + 1);
    // purgeExpiredGoals deletes where removedAt < cutoff.
    expect(justOver < cutoff).toBe(true);
    expect(exactly < cutoff).toBe(false);
    expect(justUnder < cutoff).toBe(false);
  });

  it("counts whole days left, rounding up, never below 0", () => {
    expect(daysUntilPurge(now, now)).toBe(30);
    expect(daysUntilPurge(new Date(now.getTime() - 1), now)).toBe(30);
    expect(daysUntilPurge(new Date(now.getTime() - DAY), now)).toBe(29);
    expect(daysUntilPurge(new Date(now.getTime() - 29 * DAY - 1), now)).toBe(1);
    expect(daysUntilPurge(new Date(now.getTime() - 30 * DAY + 1), now)).toBe(1);
    expect(daysUntilPurge(new Date(now.getTime() - 30 * DAY), now)).toBe(0);
    expect(daysUntilPurge(new Date(now.getTime() - 45 * DAY), now)).toBe(0);
  });
});

describe("isLearnable", () => {
  it("is only true for active goals", () => {
    expect(isLearnable("active")).toBe(true);
    expect(isLearnable("paused")).toBe(false);
    expect(isLearnable("completed")).toBe(false);
    expect(isLearnable("removed")).toBe(false);
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { GoalRow } from "@/db/schema";
import { computeGap } from "@/lib/specialists/gap";
import { samplePlan, sampleProfile, sampleRequirements } from "@/lib/specialists/test-fixtures";

const auth = vi.fn();
const loadGoalState = vi.fn();
const currentGoal = vi.fn();
const resolveGoal = vi.fn();
vi.mock("@clerk/nextjs/server", () => ({ auth: () => auth() }));
vi.mock("@/db", () => ({ isDatabaseConfigured: () => true }));
// The real goalForRequest runs over a mocked goal store.
vi.mock("@/lib/goals/goal-store", () => ({
  currentGoal: (...a: unknown[]) => currentGoal(...a),
  resolveGoal: (...a: unknown[]) => resolveGoal(...a),
}));
vi.mock("@/lib/specialists/store", () => ({
  loadGoalState: (...a: unknown[]) => loadGoalState(...a),
  loadSessions: async () => [],
  loadEarlierSessions: async () => [],
  countEndedSessions: async () => 0,
}));
vi.mock("@/lib/specialists/coach-store", () => ({ openCheckIn: async () => undefined }));
vi.mock("@/lib/specialists/huddle-store", () => ({ openHuddle: async () => undefined }));

const { GET } = await import("./route");
const gap = computeGap(sampleRequirements, sampleProfile);

const GOAL_ID = "8b1c2f7e-3d4a-4e5f-9a6b-7c8d9e0f1a2b";
const OTHER_ID = "1f2e3d4c-5b6a-4978-8a9b-0c1d2e3f4a5b";
const goal = (over: Partial<GoalRow> = {}): GoalRow => ({
  id: GOAL_ID,
  userId: "user_1",
  status: "active",
  statusBefore: null,
  createdAt: new Date("2026-09-01"),
  lastOpenedAt: new Date("2026-09-28"),
  completedAt: null,
  removedAt: null,
  ...over,
});
const get = (goalId?: string) =>
  GET(new Request(`http://localhost/api/learner/status${goalId ? `?goalId=${goalId}` : ""}`));

beforeEach(() => {
  auth.mockReset().mockResolvedValue({ userId: "user_1" });
  loadGoalState.mockReset();
  currentGoal.mockReset().mockResolvedValue(goal());
  resolveGoal.mockReset();
});

describe("GET /api/learner/status", () => {
  it("walks through the stages after discovery", async () => {
    const g = { id: GOAL_ID, status: "active", completedAt: null };
    loadGoalState.mockResolvedValueOnce(undefined);
    expect(await (await get()).json()).toEqual({ stage: "no_brief", goal: g });

    loadGoalState.mockResolvedValueOnce({ brief: {}, gap: undefined });
    expect(await (await get()).json()).toEqual({ stage: "building_gap", goal: g });

    loadGoalState.mockResolvedValueOnce({ brief: {}, gap: { gap, assessedAt: null } });
    expect(await (await get()).json()).toEqual({
      stage: "ready_to_check",
      skills: [{ skillId: "dashboards", name: "Dashboards" }],
      goal: g,
    });

    loadGoalState.mockResolvedValueOnce({ brief: {}, gap: { gap, assessedAt: "2026-09-28" } });
    expect(await (await get()).json()).toMatchObject({ stage: "planning", assessed: true });

    loadGoalState.mockResolvedValueOnce({
      brief: {},
      gap: { gap, assessedAt: "2026-09-28" },
      plan: { id: "plan_1", plan: samplePlan },
    });
    expect(await (await get()).json()).toMatchObject({
      stage: "plan_ready",
      plan: { title: samplePlan.title },
      progress: { milestoneIndex: 0, sessionsDone: 0, activeSessionId: null, lastReport: null, checkIn: null, replan: null },
    });
    expect(loadGoalState).toHaveBeenCalledWith("user_1", GOAL_ID);
  });

  it("falls back to the current goal when no goalId is given", async () => {
    loadGoalState.mockResolvedValueOnce({ brief: {}, gap: undefined });
    const res = await get();
    expect(await res.json()).toMatchObject({ stage: "building_gap", goal: { id: GOAL_ID } });
    expect(currentGoal).toHaveBeenCalledWith("user_1");
    expect(resolveGoal).not.toHaveBeenCalled();
  });

  it("is no_brief with no goal before the learner has any", async () => {
    currentGoal.mockResolvedValueOnce(undefined);
    expect(await (await get()).json()).toEqual({ stage: "no_brief", goal: null });
    expect(loadGoalState).not.toHaveBeenCalled();
  });

  it("reports on the goal it names, including a paused or completed one", async () => {
    const completedAt = new Date("2026-09-20T00:00:00.000Z");
    resolveGoal.mockResolvedValueOnce(goal({ id: OTHER_ID, status: "completed", completedAt }));
    loadGoalState.mockResolvedValueOnce({ brief: {}, gap: undefined });
    expect(await (await get(OTHER_ID)).json()).toEqual({
      stage: "building_gap",
      goal: { id: OTHER_ID, status: "completed", completedAt: completedAt.toISOString() },
    });
    expect(resolveGoal).toHaveBeenCalledWith("user_1", OTHER_ID);
    expect(loadGoalState).toHaveBeenCalledWith("user_1", OTHER_ID);
  });

  it("is 404 for a goal that isn't the learner's, or a malformed id", async () => {
    resolveGoal.mockResolvedValueOnce(undefined);
    expect((await get(OTHER_ID)).status).toBe(404);
    expect((await get("not-a-uuid")).status).toBe(404);
    expect(resolveGoal).toHaveBeenCalledTimes(1);
    expect(loadGoalState).not.toHaveBeenCalled();
  });

  it("requires sign-in", async () => {
    auth.mockResolvedValueOnce({ userId: null });
    expect((await get()).status).toBe(401);
  });
});

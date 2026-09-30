import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.fn();
const loadGoal = vi.fn();
const touchGoal = vi.fn();
const setGoalStatus = vi.fn();
const purgeGoal = vi.fn();
vi.mock("@clerk/nextjs/server", () => ({ auth: () => auth() }));
vi.mock("@/db", () => ({ isDatabaseConfigured: () => true }));
vi.mock("@/lib/goals/goal-store", () => ({
  loadGoal: (...a: unknown[]) => loadGoal(...a),
  touchGoal: (...a: unknown[]) => touchGoal(...a),
  setGoalStatus: (...a: unknown[]) => setGoalStatus(...a),
  purgeGoal: (...a: unknown[]) => purgeGoal(...a),
}));

const { DELETE, POST } = await import("./route");

const GOAL_ID = "8b1c2f7e-3d4a-4e5f-9a6b-7c8d9e0f1a2b";
const ctx = (goalId = GOAL_ID) => ({ params: Promise.resolve({ goalId }) });
const post = (body: unknown, goalId?: string) =>
  POST(new Request("http://t", { method: "POST", body: JSON.stringify(body) }), ctx(goalId));
const del = (goalId?: string) => DELETE(new Request("http://t", { method: "DELETE" }), ctx(goalId));

beforeEach(() => {
  for (const m of [loadGoal, touchGoal, setGoalStatus, purgeGoal]) m.mockReset();
  auth.mockReset().mockResolvedValue({ userId: "user_1" });
  loadGoal.mockResolvedValue({ id: GOAL_ID, status: "active" });
});

describe("POST /api/goals/[goalId]", () => {
  it("is 401 signed out", async () => {
    auth.mockResolvedValueOnce({ userId: null });
    expect((await post({ action: "pause" })).status).toBe(401);
    expect(setGoalStatus).not.toHaveBeenCalled();
  });

  it("is 404 for a malformed id", async () => {
    expect((await post({ action: "pause" }, "not-a-uuid")).status).toBe(404);
    expect(setGoalStatus).not.toHaveBeenCalled();
  });

  it("is 400 for an unknown action", async () => {
    expect((await post({ action: "archive" })).status).toBe(400);
  });

  it("opens a goal by touching it", async () => {
    const res = await post({ action: "open" });
    expect(await res.json()).toEqual({ ok: true });
    expect(loadGoal).toHaveBeenCalledWith("user_1", GOAL_ID);
    expect(touchGoal).toHaveBeenCalledWith("user_1", GOAL_ID);
    expect(setGoalStatus).not.toHaveBeenCalled();
  });

  it("won't open a removed goal or one that isn't theirs", async () => {
    loadGoal.mockResolvedValueOnce({ id: GOAL_ID, status: "removed" });
    expect((await post({ action: "open" })).status).toBe(404);
    loadGoal.mockResolvedValueOnce(undefined);
    expect((await post({ action: "open" })).status).toBe(404);
    expect(touchGoal).not.toHaveBeenCalled();
  });

  it("applies a status action and returns the new status", async () => {
    setGoalStatus.mockResolvedValueOnce({ id: GOAL_ID, status: "paused" });
    const res = await post({ action: "pause" });
    expect(await res.json()).toEqual({ ok: true, status: "paused" });
    expect(setGoalStatus).toHaveBeenCalledWith("user_1", GOAL_ID, "pause");
  });

  it("is 409 when the action doesn't apply", async () => {
    setGoalStatus.mockResolvedValueOnce(null);
    expect((await post({ action: "resume" })).status).toBe(409);
  });
});

describe("DELETE /api/goals/[goalId]", () => {
  it("is 401 signed out and 404 for a malformed id", async () => {
    auth.mockResolvedValueOnce({ userId: null });
    expect((await del()).status).toBe(401);
    expect((await del("nope")).status).toBe(404);
    expect(purgeGoal).not.toHaveBeenCalled();
  });

  it("is 409 unless the goal was already removed", async () => {
    purgeGoal.mockResolvedValueOnce({ purged: false });
    expect((await del()).status).toBe(409);
    expect(purgeGoal).toHaveBeenCalledWith("user_1", GOAL_ID);
  });

  it("purges a removed goal", async () => {
    purgeGoal.mockResolvedValueOnce({ purged: true });
    const res = await del();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ deleted: true });
  });
});

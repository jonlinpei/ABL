import { beforeEach, describe, expect, it, vi } from "vitest";

import { sampleBrief } from "@/lib/goals/test-fixtures";

const auth = vi.fn();
const saveConfirmedBrief = vi.fn();
const send = vi.fn();
const resolveGoal = vi.fn();
let dbConfigured = true;

vi.mock("@clerk/nextjs/server", () => ({ auth: () => auth() }));
vi.mock("@/db", () => ({ isDatabaseConfigured: () => dbConfigured }));
vi.mock("@/inngest/client", () => ({ inngest: { send: (...args: unknown[]) => send(...args) } }));
vi.mock("@/lib/goals/brief-store", () => ({
  saveConfirmedBrief: (...args: unknown[]) => saveConfirmedBrief(...args),
}));

const currentPlanOfGoal = vi.fn();
const closeOpenUpdates = vi.fn();
const carryGap = vi.fn();
const adoptBrief = vi.fn();
const startHuddle = vi.fn();
vi.mock("@/lib/goals/version-store", () => ({
  currentPlanOfGoal: (...a: unknown[]) => currentPlanOfGoal(...a),
  closeOpenUpdates: (...a: unknown[]) => closeOpenUpdates(...a),
  carryGap: (...a: unknown[]) => carryGap(...a),
  adoptBrief: (...a: unknown[]) => adoptBrief(...a),
}));
vi.mock("@/lib/specialists/huddle-store", () => ({ startHuddle: (...a: unknown[]) => startHuddle(...a) }));

// The real goalForRequest runs over a mocked goal store.
vi.mock("@/lib/goals/goal-store", () => ({ resolveGoal: (...args: unknown[]) => resolveGoal(...args) }));

const { POST } = await import("./route");
const GOAL_ID = "8b1c2f7e-3d4a-4e5f-9a6b-7c8d9e0f1a2b";

const request = (body: unknown) =>
  new Request("http://test/api/briefs", { method: "POST", body: JSON.stringify(body) });

beforeEach(() => {
  auth.mockReset().mockResolvedValue({ userId: "user_1" });
  saveConfirmedBrief.mockReset().mockResolvedValue({ id: "b1", version: 2, goalId: GOAL_ID });
  resolveGoal.mockReset().mockResolvedValue({ id: GOAL_ID, status: "active" });
  send.mockReset().mockResolvedValue({ ids: ["evt_1"] });
  dbConfigured = true;
  for (const m of [currentPlanOfGoal, closeOpenUpdates, carryGap, adoptBrief, startHuddle]) m.mockReset();
  currentPlanOfGoal.mockResolvedValue(undefined);
  startHuddle.mockResolvedValue({ id: "h1", created: true });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("POST /api/briefs", () => {
  it("saves a confirmed brief for the signed-in learner and returns its version", async () => {
    const res = await POST(request({ brief: sampleBrief }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: "b1", version: 2, goalId: GOAL_ID, change: null });
    expect(saveConfirmedBrief).toHaveBeenCalledWith("user_1", sampleBrief, undefined);
    expect(resolveGoal).not.toHaveBeenCalled();
  });

  it("saves the next version of a named goal the learner owns, even a paused one", async () => {
    resolveGoal.mockResolvedValueOnce({ id: GOAL_ID, status: "paused" });
    expect((await POST(request({ brief: sampleBrief, goalId: GOAL_ID }))).status).toBe(200);
    expect(resolveGoal).toHaveBeenCalledWith("user_1", GOAL_ID);
    expect(saveConfirmedBrief).toHaveBeenCalledWith("user_1", sampleBrief, GOAL_ID);
  });

  it("is 404 for a goal that isn't the learner's, without saving", async () => {
    resolveGoal.mockResolvedValueOnce(undefined);
    expect((await POST(request({ brief: sampleBrief, goalId: GOAL_ID }))).status).toBe(404);
    expect((await POST(request({ brief: sampleBrief, goalId: "nope" }))).status).toBe(404);
    expect(saveConfirmedBrief).not.toHaveBeenCalled();
  });

  it("starts the learner lifecycle with the saved brief", async () => {
    await POST(request({ brief: sampleBrief }));
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]![0]).toMatchObject({
      name: "learner/brief.confirmed",
      data: { userId: "user_1", briefId: "b1", version: 2, goalId: GOAL_ID },
    });
  });

  it("keeps the confirmation when the job runner is unreachable", async () => {
    send.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    const res = await POST(request({ brief: sampleBrief }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: "b1", version: 2, goalId: GOAL_ID, change: null });
  });

  it("rejects unauthenticated requests and invalid briefs without saving", async () => {
    auth.mockResolvedValueOnce({ userId: null });
    expect((await POST(request({ brief: sampleBrief }))).status).toBe(401);
    expect((await POST(request({ brief: { ...sampleBrief, changes: ["salary"] } }))).status).toBe(400);
    expect((await POST(request("not json at all"))).status).toBe(400);
    expect(saveConfirmedBrief).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it("says plainly when no database is configured", async () => {
    dbConfigured = false;
    const res = await POST(request({ brief: sampleBrief }));
    expect(res.status).toBe(503);
    expect((await res.json()).error).toMatch(/DATABASE_URL/);
    expect(saveConfirmedBrief).not.toHaveBeenCalled();
  });

  it("returns a friendly error when the save fails", async () => {
    saveConfirmedBrief.mockRejectedValueOnce(new Error("connection reset"));
    const res = await POST(request({ brief: sampleBrief }));
    expect(res.status).toBe(500);
    expect((await res.json()).error).not.toMatch(/connection reset/);
  });

  describe("a new version of a goal with a plan", () => {
    const current = { plan: { id: "p1" }, brief: { id: "b0", version: 1, brief: sampleBrief } };
    const save = (brief: typeof sampleBrief) => POST(request({ brief, goalId: GOAL_ID }));
    beforeEach(() => currentPlanOfGoal.mockResolvedValue(current));

    it("a new direction rebuilds, closing anything open, and keeps the current plan", async () => {
      const res = await save({ ...sampleBrief, target: { ...sampleBrief.target, role: "Analytics engineer" } });
      expect((await res.json()).change).toBe("rebuild");
      expect(closeOpenUpdates).toHaveBeenCalledWith("user_1", GOAL_ID, { planId: "p1", briefVersion: 1 }, "b1");
      expect(send.mock.calls[0]![0]).toMatchObject({ name: "learner/brief.confirmed" });
      expect(carryGap).not.toHaveBeenCalled();
      expect(adoptBrief).not.toHaveBeenCalled();
    });

    it("a new week reworks the current plan toward the new version", async () => {
      const res = await save({ ...sampleBrief, weeklyHours: 2 });
      expect((await res.json()).change).toBe("replan");
      expect(carryGap).toHaveBeenCalledWith("user_1", "b0", "b1");
      const [, planId, request, source, reason, toBriefId] = startHuddle.mock.calls[0]!;
      expect([planId, source, toBriefId]).toEqual(["p1", "learner", "b1"]);
      expect(request).toMatchObject({ weeklyHours: 2, sessionMinutes: null, deadline: null });
      expect(reason).toMatch(/weekly hours/);
      expect(send.mock.calls[0]![0]).toMatchObject({ name: "learner/replan.requested", data: { huddleId: "h1" } });
    });

    it("details only move the plan to the new version, leaving open reworks alone", async () => {
      const res = await save({ ...sampleBrief, interests: ["cycling"] });
      expect((await res.json()).change).toBe("details");
      expect(adoptBrief).toHaveBeenCalledWith("user_1", "p1", "b1");
      expect(closeOpenUpdates).not.toHaveBeenCalled();
      expect(send).not.toHaveBeenCalled();
    });
  });
});

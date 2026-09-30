import { beforeEach, describe, expect, it, vi } from "vitest";

import { sampleBrief } from "@/lib/goals/test-fixtures";
import { computeGap } from "@/lib/specialists/gap";
import { samplePlan, sampleProfile, sampleRequirements } from "@/lib/specialists/test-fixtures";

const auth = vi.fn();
const loadLearnerRecord = vi.fn();
const saveBriefDetails = vi.fn();
const saveSkillCorrection = vi.fn();
const deleteLearner = vi.fn();
const loadMastery = vi.fn();
const loadSessionState = vi.fn();
const send = vi.fn();
const resolveGoal = vi.fn();
vi.mock("@clerk/nextjs/server", () => ({ auth: () => auth() }));
vi.mock("@/db", () => ({ isDatabaseConfigured: () => true }));
vi.mock("@/inngest/client", () => ({ inngest: { send: (...a: unknown[]) => send(...a) } }));
vi.mock("@/lib/specialists/learner-record-store", () => ({
  loadLearnerRecord: (...a: unknown[]) => loadLearnerRecord(...a),
  saveBriefDetails: (...a: unknown[]) => saveBriefDetails(...a),
  saveSkillCorrection: (...a: unknown[]) => saveSkillCorrection(...a),
  deleteLearner: (...a: unknown[]) => deleteLearner(...a),
}));
vi.mock("@/lib/specialists/mastery-store", () => ({ loadMastery: (...a: unknown[]) => loadMastery(...a) }));
// The real goalForRequest runs over a mocked goal store.
vi.mock("@/lib/goals/goal-store", () => ({ resolveGoal: (...a: unknown[]) => resolveGoal(...a) }));
vi.mock("@/lib/specialists/session-state", () => ({ loadSessionState: (...a: unknown[]) => loadSessionState(...a) }));

const { DELETE, GET } = await import("./route");
const { PATCH } = await import("./brief/route");
const { POST: CORRECT } = await import("./skill/route");

const GOAL_ID = "8b1c2f7e-3d4a-4e5f-9a6b-7c8d9e0f1a2b";
const OTHER_ID = "1f2e3d4c-5b6a-4978-8a9b-0c1d2e3f4a5b";
const get = (goalId?: string) => GET(new Request(`http://t/api/learner${goalId ? `?goalId=${goalId}` : ""}`));
const gap = computeGap(sampleRequirements, sampleProfile);
const record = {
  briefId: "b1", brief: sampleBrief, profile: sampleProfile, gap, assessedAt: null, assessment: [], hasPlan: true,
  week: { weeklyHours: 3, sessionMinutes: 45 }, corrections: [],
};
const json = (method: string, body: unknown) => new Request("http://t", { method, body: JSON.stringify(body) });

beforeEach(() => {
  for (const m of [loadLearnerRecord, saveBriefDetails, saveSkillCorrection, deleteLearner, loadMastery, loadSessionState, send, resolveGoal]) m.mockReset();
  resolveGoal.mockResolvedValue({ id: GOAL_ID, status: "active" });
  auth.mockResolvedValue({ userId: "user_1" });
  loadLearnerRecord.mockResolvedValue(record);
  loadMastery.mockResolvedValue([]);
  loadSessionState.mockResolvedValue({ plan: { plan: samplePlan }, milestoneIndex: 1 });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("GET /api/learner", () => {
  it("returns the record with mastery evidence, without review schedules", async () => {
    loadMastery.mockResolvedValueOnce([{ skillId: "sql-querying", name: "SQL", level: 2, evidence: [], card: { due: "x" } }]);
    const body = await (await get()).json();
    expect(body).toMatchObject({ briefId: "b1", mastery: [{ skillId: "sql-querying", level: 2 }] });
    expect(body.mastery[0]).not.toHaveProperty("card");
  });

  it("falls back to the current goal, or loads the named one", async () => {
    await get();
    expect(resolveGoal).toHaveBeenLastCalledWith("user_1", null);
    expect(loadLearnerRecord).toHaveBeenLastCalledWith("user_1", GOAL_ID);
    resolveGoal.mockResolvedValueOnce({ id: OTHER_ID, status: "paused" });
    expect((await get(OTHER_ID)).status).toBe(200);
    expect(resolveGoal).toHaveBeenLastCalledWith("user_1", OTHER_ID);
    expect(loadLearnerRecord).toHaveBeenLastCalledWith("user_1", OTHER_ID);
  });

  it("is 404 before any goal, for a goal that isn't theirs, and 401 signed out", async () => {
    loadLearnerRecord.mockResolvedValueOnce(undefined);
    expect((await get()).status).toBe(404);
    resolveGoal.mockResolvedValueOnce(undefined);
    expect((await get()).status).toBe(404);
    resolveGoal.mockResolvedValueOnce(undefined);
    expect((await get(OTHER_ID)).status).toBe(404);
    expect((await get("not-a-uuid")).status).toBe(404);
    auth.mockResolvedValueOnce({ userId: null });
    expect((await get()).status).toBe(401);
  });
});

describe("DELETE /api/learner", () => {
  it("needs the confirmation, cancels background work, then deletes", async () => {
    expect((await DELETE(json("DELETE", {}))).status).toBe(400);
    expect(deleteLearner).not.toHaveBeenCalled();
    expect((await DELETE(json("DELETE", { confirm: "delete" }))).status).toBe(200);
    expect(send.mock.calls[0]![0]).toMatchObject({ name: "learner/data.deleted", data: { userId: "user_1" } });
    expect(deleteLearner).toHaveBeenCalledWith("user_1");
    expect(send.mock.invocationCallOrder[0]).toBeLessThan(deleteLearner.mock.invocationCallOrder[0]!);
  });

  it("still deletes if cancelling fails", async () => {
    send.mockRejectedValueOnce(new Error("down"));
    expect((await DELETE(json("DELETE", { confirm: "delete" }))).status).toBe(200);
    expect(deleteLearner).toHaveBeenCalled();
  });
});

describe("PATCH /api/learner/brief", () => {
  it("saves allowed details and names the fields changed", async () => {
    const res = await PATCH(json("PATCH", { details: { interests: ["cycling"], strengths: ["reporting"] } }));
    expect(res.status).toBe(200);
    const [, briefId, brief, fields] = saveBriefDetails.mock.calls[0]!;
    expect(briefId).toBe("b1");
    expect(brief.interests).toEqual(["cycling"]);
    expect(brief.current.strengths).toEqual(["reporting"]);
    expect(fields).toEqual(["interests", "strengths"]);
    expect(loadLearnerRecord).toHaveBeenCalledWith("user_1", GOAL_ID);
  });

  it("edits the named goal's brief, and is 404 for a goal that isn't theirs", async () => {
    resolveGoal.mockResolvedValueOnce({ id: OTHER_ID, status: "completed" });
    expect((await PATCH(json("PATCH", { details: { interests: ["x"] }, goalId: OTHER_ID }))).status).toBe(200);
    expect(loadLearnerRecord).toHaveBeenCalledWith("user_1", OTHER_ID);
    resolveGoal.mockResolvedValueOnce(undefined);
    expect((await PATCH(json("PATCH", { details: { interests: ["x"] }, goalId: OTHER_ID }))).status).toBe(404);
    expect(saveBriefDetails).toHaveBeenCalledTimes(1);
  });

  it("rejects the goal itself, the week, and empty edits", async () => {
    for (const details of [{ target: sampleBrief.target }, { weeklyHours: 10 }, { deadline: "2030" }, {}]) {
      expect((await PATCH(json("PATCH", { details }))).status, JSON.stringify(details)).toBe(400);
    }
    expect(saveBriefDetails).not.toHaveBeenCalled();
  });
});

describe("POST /api/learner/skill", () => {
  it("saves the corrected gap and mastery, and says when the plan no longer fits", async () => {
    loadMastery.mockResolvedValueOnce([{ skillId: "sql-querying", name: "SQL", level: 1, evidence: [], card: {} }]);
    const res = await CORRECT(json("POST", { skillId: "sql-querying", level: 3, note: "I use it daily" }));
    expect(await res.json()).toEqual({ planAffected: true });
    const [, briefId, savedGap, mastery, change] = saveSkillCorrection.mock.calls[0]!;
    expect(briefId).toBe("b1");
    expect(savedGap.items.find((i: { skillId: string }) => i.skillId === "sql-querying")).toMatchObject({ current: 3, basis: "self_reported" });
    expect(mastery).toMatchObject({ level: 3, evidence: [{ source: "learner" }] });
    expect(change).toEqual({ skillId: "sql-querying", from: 0, to: 3, note: "I use it daily" });
    expect(loadLearnerRecord).toHaveBeenCalledWith("user_1", GOAL_ID);
    expect(loadSessionState).toHaveBeenCalledWith("user_1", GOAL_ID);
  });

  it("is 404 for a goal that isn't theirs, without saving", async () => {
    resolveGoal.mockResolvedValueOnce(undefined);
    expect((await CORRECT(json("POST", { skillId: "sql-querying", level: 3, goalId: OTHER_ID }))).status).toBe(404);
    expect(saveSkillCorrection).not.toHaveBeenCalled();
  });

  it("skips the mastery write without a record, and the plan check without a plan", async () => {
    loadLearnerRecord.mockResolvedValueOnce({ ...record, hasPlan: false });
    expect(await (await CORRECT(json("POST", { skillId: "dashboards", level: 1 }))).json()).toEqual({ planAffected: false });
    expect(saveSkillCorrection.mock.calls[0]![3]).toBeNull();
    expect(loadSessionState).not.toHaveBeenCalled();
  });

  it("rejects unknown skills and out-of-range levels", async () => {
    expect((await CORRECT(json("POST", { skillId: "made-up", level: 2 }))).status).toBe(409);
    expect((await CORRECT(json("POST", { skillId: "sql-querying", level: 5 }))).status).toBe(400);
    expect(saveSkillCorrection).not.toHaveBeenCalled();
  });
});

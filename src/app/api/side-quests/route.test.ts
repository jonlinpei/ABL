import { beforeEach, describe, expect, it, vi } from "vitest";

import { sampleBrief } from "@/lib/goals/test-fixtures";
import { computeGap } from "@/lib/specialists/gap";
import { samplePlan, sampleProfile, sampleRequirements } from "@/lib/specialists/test-fixtures";

const auth = vi.fn();
const loadSessionState = vi.fn();
const draftSideQuest = vi.fn();
const proposeSideQuest = vi.fn();
const startSideQuest = vi.fn();
const dropSideQuest = vi.fn();
vi.mock("@clerk/nextjs/server", () => ({ auth: () => auth() }));
vi.mock("@/db", () => ({ isDatabaseConfigured: () => true }));
vi.mock("@/lib/goals/request-goal", () => ({ goalForRequest: async () => ({ goal: { id: "g1", status: "active" } }) }));
vi.mock("@/lib/specialists/session-state", () => ({ loadSessionState: (...a: unknown[]) => loadSessionState(...a) }));
vi.mock("@/lib/specialists/side-quest", async (orig) => ({
  ...(await orig<typeof import("@/lib/specialists/side-quest")>()),
  draftSideQuest: (...a: unknown[]) => draftSideQuest(...a),
}));
vi.mock("@/lib/specialists/side-quest-store", () => ({
  proposeSideQuest: (...a: unknown[]) => proposeSideQuest(...a),
  startSideQuest: (...a: unknown[]) => startSideQuest(...a),
  dropSideQuest: (...a: unknown[]) => dropSideQuest(...a),
}));

const { POST } = await import("./route");
const { POST: ACT } = await import("./[questId]/route");
const QID = "3f1c2b8e-4a5d-4c6e-9f7a-1b2c3d4e5f60";
const req = (body: unknown) => new Request("http://t", { method: "POST", body: JSON.stringify(body) });
const ctx = (questId: string) => ({ params: Promise.resolve({ questId }) });
const draft = { title: "Clean data with pandas", why: "w", outline: ["a", "b"], sessions: 3, skillId: "python-data-cleaning", skillName: "Python data cleaning", relevance: "related" };

beforeEach(() => {
  for (const m of [loadSessionState, draftSideQuest, proposeSideQuest, startSideQuest, dropSideQuest]) m.mockReset();
  auth.mockResolvedValue({ userId: "user_1" });
  loadSessionState.mockResolvedValue({ brief: { brief: sampleBrief }, plan: { plan: samplePlan }, milestoneIndex: 1, gap: computeGap(sampleRequirements, sampleProfile) });
  draftSideQuest.mockResolvedValue(draft);
  proposeSideQuest.mockResolvedValue({ id: QID });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("POST /api/side-quests", () => {
  it("drafts a quest for the topic and proposes it with what it costs in plan time", async () => {
    expect(await (await POST(req({ topic: "Python for analysis" }))).json()).toEqual({ id: QID });
    expect(draftSideQuest.mock.calls[0]![0]).toMatchObject({ topic: "Python for analysis", milestoneIndex: 1 });
    // 3 sessions x 45 min over 3 h/week = 0.75 weeks, rounded up to the half week.
    expect(proposeSideQuest).toHaveBeenCalledWith("user_1", "g1", "Python for analysis", draft, 1);
  });

  it("refuses an empty topic, and a second quest while one is under way", async () => {
    expect((await POST(req({ topic: " " }))).status).toBe(400);
    proposeSideQuest.mockResolvedValueOnce(null);
    expect((await POST(req({ topic: "Python" }))).status).toBe(409);
  });
});

describe("POST /api/side-quests/[questId]", () => {
  it("starts on plan time or extra time, or drops", async () => {
    startSideQuest.mockResolvedValueOnce({ id: QID });
    expect((await ACT(req({ action: "start", mode: "extra" }), ctx(QID))).status).toBe(200);
    expect(startSideQuest).toHaveBeenCalledWith("user_1", QID, "extra");
    dropSideQuest.mockResolvedValueOnce(false);
    expect((await ACT(req({ action: "drop" }), ctx(QID))).status).toBe(409);
    expect((await ACT(req({ action: "start", mode: "sometime" }), ctx(QID))).status).toBe(400);
    expect((await ACT(req({ action: "drop" }), ctx("nope"))).status).toBe(404);
  });
});

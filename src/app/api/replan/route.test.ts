import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.fn();
const loadLatestBriefAndGap = vi.fn();
const startHuddle = vi.fn();
const decideHuddle = vi.fn();
const send = vi.fn();
vi.mock("@clerk/nextjs/server", () => ({ auth: () => auth() }));
vi.mock("@/db", () => ({ isDatabaseConfigured: () => true }));
vi.mock("@/inngest/client", () => ({ inngest: { send: (...a: unknown[]) => send(...a) } }));
vi.mock("@/lib/specialists/store", () => ({ loadLatestBriefAndGap: (...a: unknown[]) => loadLatestBriefAndGap(...a) }));
vi.mock("@/lib/specialists/huddle-store", () => ({
  startHuddle: (...a: unknown[]) => startHuddle(...a),
  decideHuddle: (...a: unknown[]) => decideHuddle(...a),
}));

const { POST } = await import("./route");
const { POST: DECIDE } = await import("./decide/route");
const H = "7b0c0f0e-9a1d-4b6e-8a2f-3c4d5e6f7a8b";
const req = (url: string, body: unknown) => new Request(url, { method: "POST", body: JSON.stringify(body) });
const request = { weeklyHours: 2, sessionMinutes: 30, deadline: null, note: "New job" };

beforeEach(() => {
  auth.mockReset().mockResolvedValue({ userId: "user_1" });
  loadLatestBriefAndGap.mockReset().mockResolvedValue({ plan: { id: "p1" } });
  startHuddle.mockReset().mockResolvedValue({ id: H, created: true });
  decideHuddle.mockReset().mockResolvedValue({ decided: true });
  send.mockReset().mockResolvedValue({ ids: ["e"] });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("POST /api/replan", () => {
  it("opens a huddle on the active plan and starts it", async () => {
    const res = await POST(req("http://t/api/replan", { request }));
    expect(await res.json()).toEqual({ huddleId: H, created: true });
    expect(startHuddle).toHaveBeenCalledWith("user_1", "p1", request, "learner", expect.any(String));
    expect(send.mock.calls[0]![0]).toMatchObject({ name: "learner/replan.requested", data: { userId: "user_1", huddleId: H } });
  });

  it("returns the huddle already open without starting another", async () => {
    startHuddle.mockResolvedValueOnce({ id: H, created: false });
    expect(await (await POST(req("http://t/api/replan", { request }))).json()).toEqual({ huddleId: H, created: false });
    expect(send).not.toHaveBeenCalled();
  });

  it("rejects bad input and learners without a plan", async () => {
    expect((await POST(req("http://t/api/replan", { request: { ...request, weeklyHours: -1 } }))).status).toBe(400);
    loadLatestBriefAndGap.mockResolvedValueOnce({ plan: undefined });
    expect((await POST(req("http://t/api/replan", { request }))).status).toBe(409);
  });
});

describe("POST /api/replan/decide", () => {
  it("accepts or declines the learner's own proposal", async () => {
    expect((await DECIDE(req("http://t", { huddleId: H, accept: true }))).status).toBe(200);
    expect(decideHuddle).toHaveBeenCalledWith("user_1", H, true);
    decideHuddle.mockResolvedValueOnce({ decided: false });
    expect((await DECIDE(req("http://t", { huddleId: H, accept: false }))).status).toBe(409);
  });
});

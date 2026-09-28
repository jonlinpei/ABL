import { beforeEach, describe, expect, it, vi } from "vitest";

import { sampleBrief } from "@/lib/goals/test-fixtures";

const auth = vi.fn();
const saveConfirmedBrief = vi.fn();
const send = vi.fn();
let dbConfigured = true;

vi.mock("@clerk/nextjs/server", () => ({ auth: () => auth() }));
vi.mock("@/db", () => ({ isDatabaseConfigured: () => dbConfigured }));
vi.mock("@/inngest/client", () => ({ inngest: { send: (...args: unknown[]) => send(...args) } }));
vi.mock("@/lib/goals/brief-store", () => ({
  saveConfirmedBrief: (...args: unknown[]) => saveConfirmedBrief(...args),
}));

const { POST } = await import("./route");

const request = (body: unknown) =>
  new Request("http://test/api/briefs", { method: "POST", body: JSON.stringify(body) });

beforeEach(() => {
  auth.mockReset().mockResolvedValue({ userId: "user_1" });
  saveConfirmedBrief.mockReset().mockResolvedValue({ id: "b1", version: 2 });
  send.mockReset().mockResolvedValue({ ids: ["evt_1"] });
  dbConfigured = true;
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("POST /api/briefs", () => {
  it("saves a confirmed brief for the signed-in learner and returns its version", async () => {
    const res = await POST(request({ brief: sampleBrief }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: "b1", version: 2 });
    expect(saveConfirmedBrief).toHaveBeenCalledWith("user_1", sampleBrief);
  });

  it("starts the learner lifecycle with the saved brief", async () => {
    await POST(request({ brief: sampleBrief }));
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]![0]).toMatchObject({
      name: "learner/brief.confirmed",
      data: { userId: "user_1", briefId: "b1", version: 2 },
    });
  });

  it("keeps the confirmation when the job runner is unreachable", async () => {
    send.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    const res = await POST(request({ brief: sampleBrief }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: "b1", version: 2 });
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
});

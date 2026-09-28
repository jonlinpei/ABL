import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.fn();
const respondToCheckIn = vi.fn();
vi.mock("@clerk/nextjs/server", () => ({ auth: () => auth() }));
vi.mock("@/db", () => ({ isDatabaseConfigured: () => true }));
vi.mock("@/lib/specialists/coach-store", () => ({
  respondToCheckIn: (...a: unknown[]) => respondToCheckIn(...a),
}));

const { POST } = await import("./route");
const NOTE = "7b0c0f0e-9a1d-4b6e-8a2f-3c4d5e6f7a8b";
const request = (body: unknown) =>
  new Request("http://test/api/coach/respond", { method: "POST", body: JSON.stringify(body) });

beforeEach(() => {
  auth.mockReset().mockResolvedValue({ userId: "user_1" });
  respondToCheckIn.mockReset().mockResolvedValue({ updated: true });
});

describe("POST /api/coach/respond", () => {
  it("records the tapped option, or a dismissal, for the signed-in learner", async () => {
    expect((await POST(request({ noteId: NOTE, choice: "Do a 20-minute session this week" }))).status).toBe(200);
    expect(respondToCheckIn).toHaveBeenCalledWith("user_1", NOTE, "Do a 20-minute session this week");
    await POST(request({ noteId: NOTE, choice: null }));
    expect(respondToCheckIn).toHaveBeenLastCalledWith("user_1", NOTE, null);
  });

  it("rejects bad input, unauthenticated requests and notes that aren't open", async () => {
    expect((await POST(request({ noteId: "nope", choice: null }))).status).toBe(400);
    auth.mockResolvedValueOnce({ userId: null });
    expect((await POST(request({ noteId: NOTE, choice: null }))).status).toBe(401);
    respondToCheckIn.mockResolvedValueOnce({ updated: false });
    expect((await POST(request({ noteId: NOTE, choice: null }))).status).toBe(409);
  });
});

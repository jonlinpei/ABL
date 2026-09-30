import { beforeEach, describe, expect, it, vi } from "vitest";

import { sampleBrief } from "@/lib/goals/test-fixtures";
import { computeGap } from "@/lib/specialists/gap";
import { sampleProfile, sampleRequirements } from "@/lib/specialists/test-fixtures";

const auth = vi.fn();
const loadGoalState = vi.fn();
const saveAssessment = vi.fn();
const goalForRequest = vi.fn();
const send = vi.fn();
type Tool = { execute: (input: unknown) => Promise<unknown> };
let streamTextOptions: { instructions: string; tools: Record<string, Tool> } | undefined;

vi.mock("@clerk/nextjs/server", () => ({ auth: () => auth() }));
vi.mock("next/server", () => ({ after: () => {} }));
vi.mock("@/db", () => ({ isDatabaseConfigured: () => true }));
vi.mock("@/inngest/client", () => ({ inngest: { send: (...a: unknown[]) => send(...a) } }));
vi.mock("@/lib/goals/request-goal", () => ({ goalForRequest: (...a: unknown[]) => goalForRequest(...a) }));
vi.mock("@/lib/specialists/store", () => ({
  loadGoalState: (...a: unknown[]) => loadGoalState(...a),
  saveAssessment: (...a: unknown[]) => saveAssessment(...a),
}));
vi.mock("@/lib/ai/providers", () => ({
  configuredProviders: () => ["anthropic"],
  toLanguageModel: () => ({}),
}));
vi.mock("ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("ai")>()),
  convertToModelMessages: async () => [],
  streamText: (options: typeof streamTextOptions) => {
    streamTextOptions = options;
    return { stream: {} };
  },
  toUIMessageStream: () => ({}),
  createUIMessageStreamResponse: () => new Response("stream"),
}));

const { POST } = await import("./route");

const gap = computeGap(sampleRequirements, sampleProfile);
const state = (overrides: Record<string, unknown> = {}) => ({
  brief: { id: "brief_1", brief: sampleBrief },
  gap: { gap, assessedAt: null, ...overrides },
});
const GOAL_ID = "8b1c2f7e-3d4a-4e5f-9a6b-7c8d9e0f1a2b";
const request = (body: Record<string, unknown> = {}) =>
  new Request("http://test/api/assess", { method: "POST", body: JSON.stringify({ messages: [], ...body }) });
const dashboards = { skillId: "dashboards", level: 1, confidence: "high", evidence: "Built-in reports only." };

beforeEach(() => {
  auth.mockReset().mockResolvedValue({ userId: "user_1" });
  loadGoalState.mockReset().mockResolvedValue(state());
  goalForRequest.mockReset().mockResolvedValue({ goal: { id: GOAL_ID, status: "active" } });
  saveAssessment.mockReset().mockResolvedValue({ saved: true });
  send.mockReset().mockResolvedValue({ ids: ["e1"] });
  streamTextOptions = undefined;
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("POST /api/assess", () => {
  it("runs the Assessor on the skills the gap flags", async () => {
    expect((await POST(request())).status).toBe(200);
    expect(streamTextOptions!.instructions).toContain("# Skills check");
    expect(streamTextOptions!.instructions).toContain("- dashboards: Dashboards.");
    expect(streamTextOptions!.instructions).not.toContain("- sql-querying:");
  });

  it("checks a pending updated version while the current plan stays, and refuses when there's nothing to check", async () => {
    const pending = { brief: { id: "brief_2", brief: sampleBrief }, gap: { gap, assessedAt: null } };
    loadGoalState.mockResolvedValueOnce({ ...state({ assessedAt: "2026-09-01" }), plan: { id: "p1" }, pending });
    expect((await POST(request())).status).toBe(200);
    expect(streamTextOptions!.instructions).toContain("- dashboards: Dashboards.");
    loadGoalState.mockResolvedValueOnce({ ...state({ assessedAt: "2026-09-01" }), plan: { id: "p1" }, pending: null });
    expect((await POST(request())).status).toBe(409);
  });

  it("checks the goal it names, as a learning request", async () => {
    await POST(request({ goalId: GOAL_ID }));
    expect(goalForRequest).toHaveBeenCalledWith("user_1", GOAL_ID, { learning: true });
    expect(loadGoalState).toHaveBeenCalledWith("user_1", GOAL_ID);
  });

  it("passes on the goal's error (a paused goal, say) without running the Assessor", async () => {
    goalForRequest.mockResolvedValueOnce({ error: Response.json({ error: "Resume this goal first." }, { status: 409 }) });
    expect((await POST(request({ goalId: GOAL_ID }))).status).toBe(409);
    expect(loadGoalState).not.toHaveBeenCalled();
    expect(streamTextOptions).toBeUndefined();
  });

  it("refuses when the gap isn't ready, is already assessed, or has nothing to check", async () => {
    loadGoalState.mockResolvedValueOnce({ brief: {}, gap: undefined });
    expect((await POST(request())).status).toBe(409);
    loadGoalState.mockResolvedValueOnce(state({ assessedAt: new Date() }));
    expect((await POST(request())).status).toBe(409);
    const nothing = computeGap(sampleRequirements, {
      ...sampleProfile,
      skills: sampleProfile.skills.map((s) => ({ ...s, basis: "work_history" as const })),
    });
    loadGoalState.mockResolvedValueOnce(state({ gap: nothing }));
    expect((await POST(request())).status).toBe(409);
    expect(streamTextOptions).toBeUndefined();
  });

  it("saves submitted results into the gap and resumes the lifecycle", async () => {
    await POST(request());
    const out = await streamTextOptions!.tools.submit_assessment!.execute({ results: [dashboards] });
    const [userId, briefId, results, assessedGap] = saveAssessment.mock.calls[0]!;
    expect([userId, briefId]).toEqual(["user_1", "brief_1"]);
    expect(results).toHaveLength(1);
    expect(assessedGap.items.find((i: { skillId: string }) => i.skillId === "dashboards")).toMatchObject({
      current: 1,
      basis: "assessed",
    });
    expect(send.mock.calls[0]![0]).toMatchObject({
      name: "learner/assessment.done",
      data: { userId: "user_1", briefId: "brief_1" },
    });
    expect(out).toMatchObject({ status: "saved" });
  });

  it("rejects a submission missing checked skills, without saving", async () => {
    await POST(request());
    const out = await streamTextOptions!.tools.submit_assessment!.execute({ results: [] });
    expect(out).toMatchObject({ status: "incomplete", missing: ["dashboards"] });
    expect(saveAssessment).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it("doesn't resume the lifecycle twice when the check was already saved", async () => {
    saveAssessment.mockResolvedValueOnce({ saved: false });
    await POST(request());
    const out = await streamTextOptions!.tools.submit_assessment!.execute({ results: [dashboards] });
    expect(send).not.toHaveBeenCalled();
    expect(out).toMatchObject({ status: "already_saved" });
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

import { sampleBrief } from "@/lib/goals/test-fixtures";
import { computeGap } from "@/lib/specialists/gap";
import { sampleProfile, sampleRequirements } from "@/lib/specialists/test-fixtures";

const auth = vi.fn();
const loadLatestBriefAndGap = vi.fn();
const saveAssessment = vi.fn();
const send = vi.fn();
type Tool = { execute: (input: unknown) => Promise<unknown> };
let streamTextOptions: { instructions: string; tools: Record<string, Tool> } | undefined;

vi.mock("@clerk/nextjs/server", () => ({ auth: () => auth() }));
vi.mock("next/server", () => ({ after: () => {} }));
vi.mock("@/db", () => ({ isDatabaseConfigured: () => true }));
vi.mock("@/inngest/client", () => ({ inngest: { send: (...a: unknown[]) => send(...a) } }));
vi.mock("@/lib/specialists/store", () => ({
  loadLatestBriefAndGap: (...a: unknown[]) => loadLatestBriefAndGap(...a),
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
const request = () =>
  new Request("http://test/api/assess", { method: "POST", body: JSON.stringify({ messages: [] }) });
const dashboards = { skillId: "dashboards", level: 1, confidence: "high", evidence: "Built-in reports only." };

beforeEach(() => {
  auth.mockReset().mockResolvedValue({ userId: "user_1" });
  loadLatestBriefAndGap.mockReset().mockResolvedValue(state());
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

  it("refuses when the gap isn't ready, is already assessed, or has nothing to check", async () => {
    loadLatestBriefAndGap.mockResolvedValueOnce({ brief: {}, gap: undefined });
    expect((await POST(request())).status).toBe(409);
    loadLatestBriefAndGap.mockResolvedValueOnce(state({ assessedAt: new Date() }));
    expect((await POST(request())).status).toBe(409);
    const nothing = computeGap(sampleRequirements, {
      ...sampleProfile,
      skills: sampleProfile.skills.map((s) => ({ ...s, basis: "work_history" as const })),
    });
    loadLatestBriefAndGap.mockResolvedValueOnce(state({ gap: nothing }));
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

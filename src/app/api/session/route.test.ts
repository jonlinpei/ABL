import { beforeEach, describe, expect, it, vi } from "vitest";

import { sampleBrief } from "@/lib/goals/test-fixtures";
import { computeGap } from "@/lib/specialists/gap";
import { samplePlan, sampleProfile, sampleRequirements } from "@/lib/specialists/test-fixtures";

const auth = vi.fn();
const loadSessionState = vi.fn();
const endSession = vi.fn();
const saveSessionMessages = vi.fn();
const startSession = vi.fn();
type Tool = { execute: (input: unknown) => Promise<unknown> };
type ModelMessage = { role: string; content: unknown; providerOptions?: unknown };
let streamTextOptions: { instructions: string; messages: ModelMessage[]; tools: Record<string, Tool> } | undefined;
let uiStreamOptions: { onEnd: (e: { messages: unknown[] }) => Promise<void> } | undefined;

vi.mock("@clerk/nextjs/server", () => ({ auth: () => auth() }));
vi.mock("next/server", () => ({ after: () => {} }));
vi.mock("@/db", () => ({ isDatabaseConfigured: () => true }));
vi.mock("@/lib/specialists/session-state", () => ({ loadSessionState: (...a: unknown[]) => loadSessionState(...a) }));
vi.mock("@/lib/specialists/store", () => ({
  endSession: (...a: unknown[]) => endSession(...a),
  saveSessionMessages: (...a: unknown[]) => saveSessionMessages(...a),
  startSession: (...a: unknown[]) => startSession(...a),
}));
vi.mock("@/lib/ai/providers", () => ({ configuredProviders: () => ["anthropic"], toLanguageModel: () => ({}) }));
vi.mock("ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("ai")>()),
  convertToModelMessages: async () => [
    { role: "user", content: "I'm ready to start." },
    { role: "assistant", content: "Let's begin." },
    { role: "user", content: [{ type: "text", text: "SELECT * FROM leads" }] },
  ],
  streamText: (options: typeof streamTextOptions) => {
    streamTextOptions = options;
    return { stream: {} };
  },
  toUIMessageStream: (options: typeof uiStreamOptions) => {
    uiStreamOptions = options;
    return {};
  },
  createUIMessageStreamResponse: () => new Response("stream"),
}));

const { POST } = await import("./route");
const { POST: START } = await import("./start/route");

const gap = computeGap(sampleRequirements, sampleProfile);
const active = { id: "s1", milestoneIndex: 0, startedAt: new Date(Date.now() - 12 * 60_000), messages: [] };
const state = (over: Record<string, unknown> = {}) => ({
  brief: { id: "b1", brief: sampleBrief },
  gap,
  plan: { id: "p1", plan: samplePlan },
  history: [],
  active,
  milestoneIndex: 0,
  ...over,
});
const turn = (id = "s1") =>
  new Request("http://test/api/session", { method: "POST", body: JSON.stringify({ id, messages: [] }) });
const report = {
  summary: "s",
  recap: "You wrote a GROUP BY.",
  covered: [],
  evidence: [{ skillId: "sql-querying", level: 2, evidence: "Wrote a GROUP BY with a hint." }],
  homework: { task: "Three queries", minutes: 20 },
  milestoneComplete: false,
  endedEarly: false,
};

beforeEach(() => {
  auth.mockReset().mockResolvedValue({ userId: "user_1" });
  loadSessionState.mockReset().mockResolvedValue(state());
  endSession.mockReset().mockResolvedValue({ ended: true });
  saveSessionMessages.mockReset().mockResolvedValue(undefined);
  startSession.mockReset().mockResolvedValue({ ...active, id: "s2" });
  streamTextOptions = undefined;
  uiStreamOptions = undefined;
});

describe("POST /api/session", () => {
  it("teaches the current milestone with a cache-friendly prompt and the clock on the newest message", async () => {
    expect((await POST(turn())).status).toBe(200);
    expect(streamTextOptions!.instructions).toContain("# Tutor");
    expect(streamTextOptions!.instructions).not.toContain("Session clock");
    const last = streamTextOptions!.messages.at(-1)!;
    expect(JSON.stringify(last.content)).toMatch(/Session clock: 12 of 45 minutes/);
    expect(last.providerOptions).toEqual({ anthropic: { cacheControl: { type: "ephemeral" } } });
    expect(JSON.stringify(streamTextOptions!.messages[0]!.content)).not.toMatch(/Session clock/);
  });

  it("refuses a turn for a session that isn't the learner's active one", async () => {
    expect((await POST(turn("someone-elses"))).status).toBe(409);
    loadSessionState.mockResolvedValueOnce(state({ active: undefined }));
    expect((await POST(turn())).status).toBe(409);
    expect(streamTextOptions).toBeUndefined();
  });

  it("saves the transcript after each turn, and the report when the tutor ends the session", async () => {
    await POST(turn());
    await uiStreamOptions!.onEnd({ messages: [{ id: "m1" }] });
    expect(saveSessionMessages).toHaveBeenCalledWith("s1", "user_1", [{ id: "m1" }]);

    const out = await streamTextOptions!.tools.end_session!.execute(report);
    expect(endSession).toHaveBeenCalledWith("s1", "user_1", expect.objectContaining({ summary: "s" }));
    expect(out).toEqual({ status: "ended", milestoneComplete: false });
  });
});

describe("POST /api/session/start", () => {
  it("resumes the active session with its transcript", async () => {
    loadSessionState.mockResolvedValueOnce(state({ active: { ...active, messages: [{ id: "m1" }] } }));
    const res = await (await START()).json();
    expect(res).toMatchObject({ id: "s1", sessionNumber: 1, messages: [{ id: "m1" }] });
    expect(startSession).not.toHaveBeenCalled();
  });

  it("starts a session on the current milestone when none is active", async () => {
    loadSessionState.mockResolvedValueOnce(state({ active: undefined, milestoneIndex: 1 }));
    startSession.mockResolvedValueOnce({ ...active, id: "s2", milestoneIndex: 1 });
    const res = await (await START()).json();
    expect(startSession).toHaveBeenCalledWith("user_1", "p1", 1);
    expect(res).toMatchObject({ id: "s2", milestoneTitle: samplePlan.milestones[1]!.title });
  });

  it("refuses when there's no plan yet or every milestone is done", async () => {
    loadSessionState.mockResolvedValueOnce(undefined);
    expect((await START()).status).toBe(409);
    loadSessionState.mockResolvedValueOnce(state({ active: undefined, milestoneIndex: samplePlan.milestones.length }));
    expect((await START()).status).toBe(409);
  });
});

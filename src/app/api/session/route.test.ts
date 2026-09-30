import { beforeEach, describe, expect, it, vi } from "vitest";

import { sampleBrief } from "@/lib/goals/test-fixtures";
import { computeGap } from "@/lib/specialists/gap";
import { samplePlan, sampleProfile, sampleRequirements } from "@/lib/specialists/test-fixtures";

const auth = vi.fn();
const loadSessionState = vi.fn();
const endSession = vi.fn();
const saveSessionMessages = vi.fn();
const startSession = vi.fn();
const send = vi.fn();
const goalOfSession = vi.fn();
const resolveGoal = vi.fn();
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
  goalOfSession: (...a: unknown[]) => goalOfSession(...a),
}));
// The real goalForRequest runs over a mocked goal store.
vi.mock("@/lib/goals/goal-store", () => ({ resolveGoal: (...a: unknown[]) => resolveGoal(...a) }));
const loadGlossary = vi.fn();
vi.mock("@/lib/specialists/glossary-store", () => ({ loadGlossary: (...a: unknown[]) => loadGlossary(...a) }));
const loadSessionSidekicks = vi.fn();
vi.mock("@/lib/specialists/sidekick-store", () => ({ loadSessionSidekicks: (...a: unknown[]) => loadSessionSidekicks(...a) }));
vi.mock("@/inngest/client", () => ({ inngest: { send: (...a: unknown[]) => send(...a) } }));
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

const GOAL_ID = "8b1c2f7e-3d4a-4e5f-9a6b-7c8d9e0f1a2b";
const OTHER_ID = "1f2e3d4c-5b6a-4978-8a9b-0c1d2e3f4a5b";
const start = (body: Record<string, unknown> = {}) =>
  START(new Request("http://test/api/session/start", { method: "POST", body: JSON.stringify(body) }));
const gap = computeGap(sampleRequirements, sampleProfile);
const active = { id: "s1", milestoneIndex: 0, startedAt: new Date(Date.now() - 12 * 60_000), messages: [] };
const state = (over: Record<string, unknown> = {}) => ({
  brief: { id: "b1", brief: sampleBrief },
  gap,
  plan: { id: "p1", plan: samplePlan },
  history: [],
  active,
  milestoneIndex: 0,
  dueReviews: [],
  coachNotes: [],
  carried: [],
  sessionsDone: 0,
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
  loadSessionSidekicks.mockReset().mockResolvedValue([]);
  loadGlossary.mockReset().mockResolvedValue([]);
  auth.mockReset().mockResolvedValue({ userId: "user_1" });
  loadSessionState.mockReset().mockResolvedValue(state());
  endSession.mockReset().mockResolvedValue({ ended: true });
  saveSessionMessages.mockReset().mockResolvedValue(undefined);
  startSession.mockReset().mockResolvedValue({ ...active, id: "s2" });
  send.mockReset().mockResolvedValue({ ids: ["e1"] });
  goalOfSession.mockReset().mockImplementation(async (_userId: string, sessionId: string) => (sessionId === "s1" ? GOAL_ID : undefined));
  resolveGoal.mockReset().mockResolvedValue({ id: GOAL_ID, status: "active" });
  streamTextOptions = undefined;
  uiStreamOptions = undefined;
});

describe("POST /api/session", () => {
  it("teaches the current milestone with a cache-friendly prompt and the clock on the newest message", async () => {
    expect((await POST(turn())).status).toBe(200);
    expect(goalOfSession).toHaveBeenCalledWith("user_1", "s1");
    expect(loadSessionState).toHaveBeenCalledWith("user_1", GOAL_ID);
    expect(streamTextOptions!.instructions).toContain("# Tutor");
    expect(streamTextOptions!.instructions).not.toContain("Session clock");
    const last = streamTextOptions!.messages.at(-1)!;
    expect(JSON.stringify(last.content)).toMatch(/Session clock: 12 of 45 minutes/);
    expect(last.providerOptions).toEqual({ anthropic: { cacheControl: { type: "ephemeral" } } });
    expect(JSON.stringify(streamTextOptions!.messages[0]!.content)).not.toMatch(/Session clock/);
  });

  it("tells the tutor about this session's side questions on the newest message only", async () => {
    loadSessionSidekicks.mockResolvedValueOnce([
      { summary: "Asked what a LEFT JOIN is; got it via VLOOKUP.", struggled: true, messages: [] },
      { summary: null, struggled: null, messages: [{ role: "user", parts: [{ type: "text", text: "what's a CTE?" }] }] },
    ]);
    await POST(turn());
    const last = JSON.stringify(streamTextOptions!.messages.at(-1)!.content);
    expect(last).toContain("Asked what a LEFT JOIN is; got it via VLOOKUP. (they struggled with it)");
    expect(last).toContain('Asked: \\"what\'s a CTE?\\" (still open)');
    expect(streamTextOptions!.instructions).not.toContain("got it via VLOOKUP");
  });

  it("gives the tutor the glossary's fields and this milestone's shaky terms, with other senses", async () => {
    const sense = (over: Record<string, unknown>) => ({
      id: "t1", headword: "pivot", headKey: "pivot", domain: "data analysis", definition: "d", skillId: "sql-querying",
      briefId: null, source: "sidekick", timesSeen: 1, struggled: true, known: false, ...over,
    });
    loadGlossary.mockResolvedValueOnce([sense({}), sense({ id: "t2", domain: "spreadsheets", definition: "a pivot table", skillId: null, struggled: false })]);
    await POST(turn());
    const last = JSON.stringify(streamTextOptions!.messages.at(-1)!.content);
    expect(last).toContain("fields in use: data analysis, spreadsheets");
    expect(last).toContain("pivot (data analysis) is still shaky. They also know it from spreadsheets");
  });

  it("refuses a turn for a session that isn't the learner's active one", async () => {
    expect((await POST(turn("someone-elses"))).status).toBe(409);
    expect(loadSessionState).not.toHaveBeenCalled();
    loadSessionState.mockResolvedValueOnce(state({ active: undefined }));
    expect((await POST(turn())).status).toBe(409);
    expect(streamTextOptions).toBeUndefined();
  });

  it("stops taking turns once the session's goal is paused, completed or removed", async () => {
    resolveGoal.mockResolvedValueOnce({ id: GOAL_ID, status: "completed" });
    expect((await POST(turn())).status).toBe(409);
    resolveGoal.mockResolvedValueOnce(undefined);
    expect((await POST(turn())).status).toBe(404);
    expect(loadSessionState).not.toHaveBeenCalled();
  });

  it("saves the transcript after each turn, and the report when the tutor ends the session", async () => {
    await POST(turn());
    await uiStreamOptions!.onEnd({ messages: [{ id: "m1" }] });
    expect(saveSessionMessages).toHaveBeenCalledWith("s1", "user_1", [{ id: "m1" }]);

    const out = await streamTextOptions!.tools.end_session!.execute(report);
    expect(endSession).toHaveBeenCalledWith("s1", "user_1", expect.objectContaining({ summary: "s" }));
    expect(out).toEqual({ status: "ended", milestoneComplete: false });
    expect(send.mock.calls[0]![0]).toMatchObject({
      name: "learner/session.completed",
      data: { userId: "user_1", sessionId: "s1", goalId: GOAL_ID },
    });
  });

  it("doesn't start a second mastery update when the session was already ended", async () => {
    endSession.mockResolvedValueOnce({ ended: false });
    await POST(turn());
    await streamTextOptions!.tools.end_session!.execute(report);
    expect(send).not.toHaveBeenCalled();
  });
});

describe("POST /api/session/start", () => {
  it("resumes the active session with its transcript", async () => {
    loadSessionState.mockResolvedValueOnce(state({ active: { ...active, messages: [{ id: "m1" }] } }));
    const res = await (await start()).json();
    expect(res).toMatchObject({ id: "s1", sessionNumber: 1, messages: [{ id: "m1" }] });
    expect(startSession).not.toHaveBeenCalled();
  });

  it("falls back to the current goal when no goalId is given", async () => {
    await start();
    expect(resolveGoal).toHaveBeenCalledWith("user_1", null);
    expect(loadSessionState).toHaveBeenCalledWith("user_1", GOAL_ID);
  });

  it("starts on the goal it names", async () => {
    resolveGoal.mockResolvedValueOnce({ id: OTHER_ID, status: "active" });
    expect((await start({ goalId: OTHER_ID })).status).toBe(200);
    expect(resolveGoal).toHaveBeenCalledWith("user_1", OTHER_ID);
    expect(loadSessionState).toHaveBeenCalledWith("user_1", OTHER_ID);
  });

  it("is 404 for a goal that isn't the learner's, or a malformed id", async () => {
    resolveGoal.mockResolvedValueOnce(undefined);
    expect((await start({ goalId: OTHER_ID })).status).toBe(404);
    expect((await start({ goalId: "not-a-uuid" })).status).toBe(404);
    expect(loadSessionState).not.toHaveBeenCalled();
    expect(startSession).not.toHaveBeenCalled();
  });

  it("is 409 for a paused or completed goal", async () => {
    resolveGoal.mockResolvedValueOnce({ id: GOAL_ID, status: "paused" });
    expect((await start({ goalId: GOAL_ID })).status).toBe(409);
    resolveGoal.mockResolvedValueOnce({ id: GOAL_ID, status: "completed" });
    expect((await start({ goalId: GOAL_ID })).status).toBe(409);
    expect(loadSessionState).not.toHaveBeenCalled();
  });

  it("is 409 when the learner has no goal at all", async () => {
    resolveGoal.mockResolvedValueOnce(undefined);
    expect((await start()).status).toBe(409);
  });

  it("starts a session on the current milestone when none is active", async () => {
    loadSessionState.mockResolvedValueOnce(state({ active: undefined, milestoneIndex: 1 }));
    startSession.mockResolvedValueOnce({ ...active, id: "s2", milestoneIndex: 1 });
    const res = await (await start()).json();
    expect(startSession).toHaveBeenCalledWith("user_1", "p1", 1);
    expect(res).toMatchObject({ id: "s2", milestoneTitle: samplePlan.milestones[1]!.title });
  });

  it("refuses when there's no plan yet or every milestone is done", async () => {
    loadSessionState.mockResolvedValueOnce(undefined);
    expect((await start()).status).toBe(409);
    loadSessionState.mockResolvedValueOnce(state({ active: undefined, milestoneIndex: samplePlan.milestones.length }));
    expect((await start()).status).toBe(409);
  });
});

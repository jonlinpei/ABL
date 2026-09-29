import { beforeEach, describe, expect, it, vi } from "vitest";

import { sampleBrief } from "@/lib/goals/test-fixtures";
import { samplePlan } from "@/lib/specialists/test-fixtures";

const auth = vi.fn();
const loadSessionState = vi.fn();
const loadSidekick = vi.fn();
const saveSidekickMessages = vi.fn();
const closeSidekick = vi.fn();
const summarizeSidekick = vi.fn();
const resolveModel = vi.fn();
let streamTextOptions: { instructions: string; maxOutputTokens: number } | undefined;
let uiStreamOptions: { onEnd: (e: { messages: unknown[] }) => Promise<void> } | undefined;
let dbRow: unknown;

vi.mock("@clerk/nextjs/server", () => ({ auth: () => auth() }));
vi.mock("next/server", () => ({ after: () => {} }));
vi.mock("@/db", () => ({
  isDatabaseConfigured: () => true,
  schema: { sessions: {}, plans: {}, careerBriefs: {} },
  getDb: () => ({ select: () => ({ from: () => ({ innerJoin: () => ({ innerJoin: () => ({ where: async () => [dbRow] }) }) }) }) }),
}));
vi.mock("drizzle-orm", async (orig) => ({ ...(await orig<typeof import("drizzle-orm")>()), eq: () => ({}) }));
vi.mock("@/lib/specialists/session-state", () => ({ loadSessionState: (...a: unknown[]) => loadSessionState(...a) }));
vi.mock("@/lib/specialists/sidekick-store", () => ({
  loadSidekick: (...a: unknown[]) => loadSidekick(...a),
  saveSidekickMessages: (...a: unknown[]) => saveSidekickMessages(...a),
  closeSidekick: (...a: unknown[]) => closeSidekick(...a),
}));
vi.mock("@/lib/specialists/sidekick", async (orig) => ({
  ...(await orig<typeof import("@/lib/specialists/sidekick")>()),
  summarizeSidekick: (...a: unknown[]) => summarizeSidekick(...a),
}));
vi.mock("@/lib/ai/router", () => ({ resolveModel: (...a: unknown[]) => resolveModel(...a) }));
const recordTerms = vi.fn();
vi.mock("@/lib/specialists/glossary-store", () => ({
  loadGlossary: async () => [{ domain: "Data analysis" }],
  recordTerms: (...a: unknown[]) => recordTerms(...a),
}));
vi.mock("@/lib/ai/providers", () => ({ configuredProviders: () => ["anthropic"], toLanguageModel: () => ({}) }));
vi.mock("ai", async (orig) => ({
  ...(await orig<typeof import("ai")>()),
  convertToModelMessages: async () => [{ role: "user", content: "what's a LEFT JOIN?" }],
  streamText: (o: typeof streamTextOptions) => ((streamTextOptions = o), { stream: {} }),
  toUIMessageStream: (o: typeof uiStreamOptions) => ((uiStreamOptions = o), {}),
  createUIMessageStreamResponse: () => new Response("stream"),
}));

const { POST } = await import("./route");
const { POST: CLOSE } = await import("./close/route");

const ID = "3f1c2b8e-4a5d-4c6e-9f7a-1b2c3d4e5f60";
const lesson = [
  { role: "assistant", parts: [{ type: "text", text: "Now join leads to campaigns on campaign_id." }] },
  { role: "user", parts: [{ type: "text", text: "ok trying it" }] },
];
const active = { id: "s1", milestoneIndex: 0, messages: lesson };
const ask = (n = 1, over: Record<string, unknown> = {}) =>
  new Request("http://t", {
    method: "POST",
    body: JSON.stringify({
      id: ID,
      sessionId: "s1",
      messages: Array.from({ length: n }, (_, i) => ({ id: `m${i}`, role: "user", parts: [{ type: "text", text: "q" }] })),
      ...over,
    }),
  });
const close = () => new Request("http://t", { method: "POST", body: JSON.stringify({ id: ID }) });

beforeEach(() => {
  for (const m of [loadSessionState, loadSidekick, saveSidekickMessages, closeSidekick, summarizeSidekick, resolveModel]) m.mockReset();
  auth.mockResolvedValue({ userId: "user_1" });
  loadSessionState.mockResolvedValue({ brief: { brief: sampleBrief }, plan: { plan: samplePlan }, active });
  loadSidekick.mockResolvedValue(undefined);
  resolveModel.mockReturnValue({ primary: { model: { id: "claude-haiku-4-5", provider: "anthropic", tier: "fast" }, keySource: "platform" } });
  dbRow = { milestoneIndex: 0, plan: samplePlan, briefId: "b1", brief: sampleBrief };
  recordTerms.mockReset();
  streamTextOptions = undefined;
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("POST /api/sidekick", () => {
  it("answers on the fast sidekick task, knowing where the lesson is, and saves the chat", async () => {
    expect((await POST(ask())).status).toBe(200);
    expect(resolveModel.mock.calls[0]![0]).toBe("sidekick_answer");
    expect(streamTextOptions!.instructions).toContain("# Sidekick");
    expect(streamTextOptions!.instructions).toContain("Tutor: Now join leads to campaigns on campaign_id.");
    expect(streamTextOptions!.instructions).toContain(samplePlan.milestones[0]!.title);
    await uiStreamOptions!.onEnd({ messages: ["all"] });
    expect(saveSidekickMessages).toHaveBeenCalledWith(ID, "user_1", "s1", ["all"]);
  });

  it("only works during the learner's active session, and not on a closed sidekick", async () => {
    expect((await POST(ask(1, { sessionId: "other" }))).status).toBe(409);
    loadSidekick.mockResolvedValueOnce({ sessionId: "s1", closedAt: new Date() });
    expect((await POST(ask())).status).toBe(409);
    loadSessionState.mockResolvedValueOnce({ ...(await loadSessionState()), active: undefined });
    expect((await POST(ask())).status).toBe(409);
  });

  it("stops a side question that's grown past quick", async () => {
    expect((await POST(ask(9))).status).toBe(429);
    expect(streamTextOptions).toBeUndefined();
  });
});

describe("POST /api/sidekick/close", () => {
  it("summarizes with the session's skill ids and closes", async () => {
    loadSidekick.mockResolvedValueOnce({ id: ID, sessionId: "s1", messages: ["m"], closedAt: null });
    const summary = { summary: "Asked about LEFT JOIN", term: "LEFT JOIN", definition: "d", domain: "data analysis", skillId: "sql-querying", struggled: true };
    summarizeSidekick.mockResolvedValueOnce(summary);
    expect(await (await CLOSE(close())).json()).toEqual({ closed: true, term: "LEFT JOIN" });
    expect(summarizeSidekick.mock.calls[0]![1]).toEqual(["sql-querying"]);
    expect(summarizeSidekick.mock.calls[0]![3]).toEqual({ domains: ["Data analysis"], goal: `${sampleBrief.target.role} (${sampleBrief.target.industry})` });
    expect(closeSidekick).toHaveBeenCalledWith(ID, "user_1", summary);
    // The term goes into the glossary, under the goal the session belongs to.
    expect(recordTerms).toHaveBeenCalledWith("user_1", "b1", "sidekick", [
      { term: "LEFT JOIN", definition: "d", domain: "data analysis", skillId: "sql-querying", struggled: true },
    ]);
  });

  it("closes without a summary if summarizing fails, and is a no-op when nothing was asked or it's closed", async () => {
    loadSidekick.mockResolvedValueOnce({ id: ID, sessionId: "s1", messages: ["m"], closedAt: null });
    summarizeSidekick.mockRejectedValueOnce(new Error("down"));
    expect((await CLOSE(close())).status).toBe(200);
    expect(closeSidekick).toHaveBeenCalledWith(ID, "user_1", null);
    expect(await (await CLOSE(close())).json()).toEqual({ closed: false });
    loadSidekick.mockResolvedValueOnce({ id: ID, closedAt: new Date(), term: "CTE" });
    expect(await (await CLOSE(close())).json()).toEqual({ closed: true, term: "CTE" });
    expect(closeSidekick).toHaveBeenCalledTimes(1);
  });
});

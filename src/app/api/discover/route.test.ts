import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.fn();
const captureAiGeneration = vi.fn();
const afterCallbacks: (() => unknown)[] = [];
type StreamOptions = {
  messageMetadata: (arg: { part: { type: string; totalUsage?: unknown } }) => unknown;
  onError: (error: unknown) => string;
};
type StreamTextOptions = {
  abortSignal?: AbortSignal;
  onAbort: (event: { steps: { usage: { inputTokens?: number; outputTokens?: number } }[] }) => void;
};
let streamOptions: StreamOptions | undefined;
let streamTextOptions: StreamTextOptions | undefined;

vi.mock("@clerk/nextjs/server", () => ({ auth: () => auth() }));
vi.mock("next/server", () => ({
  after: (cb: () => unknown) => {
    afterCallbacks.push(cb);
  },
}));
// Stub the streaming pipeline so the test can drive the metadata/error hooks.
vi.mock("ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("ai")>()),
  convertToModelMessages: async () => [],
  streamText: (options: StreamTextOptions) => {
    streamTextOptions = options;
    return { stream: {} };
  },
  toUIMessageStream: (options: StreamOptions) => {
    streamOptions = options;
    return {};
  },
  createUIMessageStreamResponse: () => new Response("stream"),
}));
vi.mock("@/lib/ai/providers", () => ({
  configuredProviders: () => ["anthropic"],
  toLanguageModel: () => ({}),
}));
vi.mock("@/lib/ai/usage-events", () => ({
  ABORTED: "aborted",
  captureAiGeneration: (...args: unknown[]) => captureAiGeneration(...args),
}));

const { POST } = await import("./route");

const request = (body: Record<string, unknown> = {}) =>
  new Request("http://test/api/discover", {
    method: "POST",
    body: JSON.stringify({ messages: [], ...body }),
  });

async function runAfter() {
  for (const cb of afterCallbacks.splice(0)) await cb();
}

beforeEach(() => {
  auth.mockReset().mockResolvedValue({ userId: "user_1" });
  captureAiGeneration.mockReset().mockResolvedValue(undefined);
  afterCallbacks.length = 0;
  streamOptions = undefined;
  streamTextOptions = undefined;
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("POST /api/discover usage capture", () => {
  it("captures the finished trace once the stream has closed", async () => {
    await POST(request());
    const start = streamOptions!.messageMetadata({ part: { type: "start" } });
    const finished = streamOptions!.messageMetadata({
      part: { type: "finish", totalUsage: { inputTokens: 900, outputTokens: 120 } },
    });

    await runAfter();
    expect(captureAiGeneration).toHaveBeenCalledTimes(1);
    const [userId, trace, error] = captureAiGeneration.mock.calls[0];
    expect(userId).toBe("user_1");
    expect(error).toBeUndefined();
    expect(trace).toBe(finished);
    expect(trace).toMatchObject({ task: "goal_discover", inputTokens: 900, outputTokens: 120 });
    expect(start).toMatchObject({ task: "goal_discover" });
  });

  it("captures a stream error with latency and the error", async () => {
    await POST(request());
    const failure = new Error("overloaded");
    expect(streamOptions!.onError(failure)).toBe("overloaded");

    await runAfter();
    expect(captureAiGeneration).toHaveBeenCalledTimes(1);
    const [, trace, error] = captureAiGeneration.mock.calls[0];
    expect(error).toBe(failure);
    expect(trace.latencyMs).toEqual(expect.any(Number));
    expect(trace.inputTokens).toBeUndefined();
  });

  it("records a client abort with the usage of steps that finished", async () => {
    const req = request();
    await POST(req);
    expect(streamTextOptions!.abortSignal).toBe(req.signal);
    streamTextOptions!.onAbort({
      steps: [
        { usage: { inputTokens: 500, outputTokens: 40 } },
        { usage: { inputTokens: 600, outputTokens: 10 } },
      ],
    });

    await runAfter();
    expect(captureAiGeneration).toHaveBeenCalledTimes(1);
    const [, trace, error] = captureAiGeneration.mock.calls[0];
    expect(error).toBe("aborted");
    expect(trace).toMatchObject({ inputTokens: 1100, outputTokens: 50 });
    expect(trace.latencyMs).toEqual(expect.any(Number));
  });

  it("records an abort before any step finished, with no tokens", async () => {
    await POST(request());
    await runAfter();
    const [, trace, error] = captureAiGeneration.mock.calls[0];
    expect(error).toBe("aborted");
    expect(trace.inputTokens).toBeUndefined();
  });

  it("keeps an error that happened in a stream that still finished", async () => {
    await POST(request());
    const failure = new Error("tool failed");
    streamOptions!.onError(failure);
    const finished = streamOptions!.messageMetadata({ part: { type: "finish", totalUsage: {} } });

    await runAfter();
    const [, trace, error] = captureAiGeneration.mock.calls[0];
    expect(trace).toBe(finished);
    expect(error).toBe(failure);
  });

  it("uses the chat id as the trace id, and a fresh id when it is missing or too long", async () => {
    await POST(request({ id: "chat_abc" }));
    await POST(request({ id: "x".repeat(101) }));
    await POST(request());
    await runAfter();
    const ids = captureAiGeneration.mock.calls.map((c) => c[3]);
    expect(ids[0]).toBe("chat_abc");
    expect(ids[1]).not.toBe("x".repeat(101));
    expect(ids[1]).toMatch(/^[0-9a-f-]{36}$/);
    expect(ids[2]).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("captures nothing and skips after() for unauthenticated requests", async () => {
    auth.mockResolvedValueOnce({ userId: null });
    expect((await POST(request())).status).toBe(401);
    expect(afterCallbacks).toHaveLength(0);
  });
});

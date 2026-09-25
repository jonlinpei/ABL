import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.fn();
const captureAiGeneration = vi.fn();
const afterCallbacks: (() => unknown)[] = [];
type StreamOptions = {
  messageMetadata: (arg: { part: { type: string; totalUsage?: unknown } }) => unknown;
  onError: (error: unknown) => string;
};
let streamOptions: StreamOptions | undefined;

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
  streamText: () => ({ stream: {} }),
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
  captureAiGeneration: (...args: unknown[]) => captureAiGeneration(...args),
}));

const { POST } = await import("./route");

const request = () =>
  new Request("http://test/api/discover", {
    method: "POST",
    body: JSON.stringify({ messages: [] }),
  });

async function runAfter() {
  for (const cb of afterCallbacks.splice(0)) await cb();
}

beforeEach(() => {
  auth.mockReset().mockResolvedValue({ userId: "user_1" });
  captureAiGeneration.mockReset().mockResolvedValue(undefined);
  afterCallbacks.length = 0;
  streamOptions = undefined;
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

  it("captures nothing when the stream neither finished nor errored (e.g. aborted)", async () => {
    await POST(request());
    await runAfter();
    expect(captureAiGeneration).not.toHaveBeenCalled();
  });

  it("captures nothing and skips after() for unauthenticated requests", async () => {
    auth.mockResolvedValueOnce({ userId: null });
    expect((await POST(request())).status).toBe(401);
    expect(afterCallbacks).toHaveLength(0);
  });
});

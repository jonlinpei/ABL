import { NoObjectGeneratedError } from "ai";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { GoalBrief } from "@/lib/goals/schema";

const auth = vi.fn();
const generateText = vi.fn();
const captureAiGeneration = vi.fn();
const afterCallbacks: (() => unknown)[] = [];

vi.mock("@clerk/nextjs/server", () => ({ auth: () => auth() }));
vi.mock("next/server", () => ({
  after: (cb: () => unknown) => {
    afterCallbacks.push(cb);
  },
}));
vi.mock("ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("ai")>()),
  generateText: (...args: unknown[]) => generateText(...args),
}));
vi.mock("@/lib/ai/providers", () => ({
  configuredProviders: () => ["anthropic"],
  toLanguageModel: () => ({}),
}));
vi.mock("@/lib/ai/usage-events", () => ({
  captureAiGeneration: (...args: unknown[]) => captureAiGeneration(...args),
}));

const { POST } = await import("./route");

const brief: GoalBrief = {
  subject: "Japanese",
  goalInTheirWords: "Hold a basic conversation before my trip",
  restatedGoal: "Order food and ask directions in Japanese by June.",
  motivation: "Trip to Osaka.",
  successLooksLike: "Order a meal without English.",
  deadline: "2027-06-01",
  startingPoint: "Knows hiragana.",
  weeklyHours: 3,
  sessionMinutes: 20,
  preferredTimes: null,
  pastAttempts: null,
  priority: "practical",
  interests: [],
  inferred: ["weeklyHours"],
};

const request = (body: unknown) =>
  new Request("http://test/api/roadmap", { method: "POST", body: JSON.stringify(body) });

async function runAfter() {
  for (const cb of afterCallbacks.splice(0)) await cb();
}

beforeEach(() => {
  auth.mockReset().mockResolvedValue({ userId: "user_1" });
  generateText.mockReset();
  captureAiGeneration.mockReset().mockResolvedValue(undefined);
  afterCallbacks.length = 0;
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("POST /api/roadmap usage capture", () => {
  it("captures one successful generation for the user after responding", async () => {
    generateText.mockResolvedValueOnce({
      output: { title: "Plan" },
      totalUsage: { inputTokens: 100, outputTokens: 50 },
    });

    const res = await POST(request({ brief }));
    expect(res.status).toBe(200);
    expect(captureAiGeneration).not.toHaveBeenCalled(); // deferred to after()

    await runAfter();
    expect(captureAiGeneration).toHaveBeenCalledTimes(1);
    const [userId, trace, error] = captureAiGeneration.mock.calls[0];
    expect(userId).toBe("user_1");
    expect(error).toBeUndefined();
    expect(trace).toMatchObject({ task: "roadmap_generate", inputTokens: 100, outputTokens: 50 });
    expect(trace).toEqual((await res.json()).trace);
  });

  it("captures the failed attempt with its error, then the fallback's success", async () => {
    const failure = new Error("overloaded");
    generateText.mockRejectedValueOnce(failure).mockResolvedValueOnce({
      output: { title: "Plan" },
      totalUsage: { inputTokens: 10, outputTokens: 5 },
    });

    const res = await POST(request({ brief }));
    expect(res.status).toBe(200);
    await runAfter();

    expect(captureAiGeneration).toHaveBeenCalledTimes(2);
    const [[, failedTrace, err], [, okTrace, okErr]] = captureAiGeneration.mock.calls;
    expect(err).toBe(failure);
    expect(failedTrace.latencyMs).toEqual(expect.any(Number));
    expect(failedTrace.inputTokens).toBeUndefined();
    expect(okErr).toBeUndefined();
    expect(okTrace.failedOver).toEqual([failedTrace.model]);
    // Both attempts belong to one request, so they share a trace id.
    const [first, second] = captureAiGeneration.mock.calls.map((c) => c[3]);
    expect(first).toMatch(/^[0-9a-f-]{36}$/);
    expect(second).toBe(first);
  });

  it("records the billed usage of a response that failed schema parsing", async () => {
    generateText
      .mockRejectedValueOnce(
        new NoObjectGeneratedError({
          message: "No object generated: response did not match schema.",
          response: { id: "r1", timestamp: new Date(), modelId: "m" },
          usage: {
            inputTokens: 2000,
            outputTokens: 3000,
          } as ConstructorParameters<typeof NoObjectGeneratedError>[0]["usage"],
          finishReason: "stop",
        }),
      )
      .mockResolvedValueOnce({ output: { title: "Plan" }, totalUsage: {} });

    await POST(request({ brief }));
    await runAfter();

    const [, failedTrace, err] = captureAiGeneration.mock.calls[0];
    expect(NoObjectGeneratedError.isInstance(err)).toBe(true);
    expect(failedTrace).toMatchObject({ inputTokens: 2000, outputTokens: 3000 });
  });

  it("captures every failed attempt when all models fail", async () => {
    generateText.mockRejectedValue(new Error("down"));

    const res = await POST(request({ brief }));
    expect(res.status).toBe(502);
    await runAfter();

    expect(captureAiGeneration.mock.calls.length).toBe(generateText.mock.calls.length);
    expect(captureAiGeneration.mock.calls.every((c) => c[2] instanceof Error)).toBe(true);
  });

  it("captures nothing for unauthenticated or invalid requests", async () => {
    auth.mockResolvedValueOnce({ userId: null });
    expect((await POST(request({ brief }))).status).toBe(401);

    const noSubject: Partial<GoalBrief> = { ...brief };
    delete noSubject.subject;
    expect((await POST(request({ brief: noSubject }))).status).toBe(400);

    await runAfter();
    expect(generateText).not.toHaveBeenCalled();
    expect(captureAiGeneration).not.toHaveBeenCalled();
  });
});

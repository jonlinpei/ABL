import { APICallError } from "ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CallTrace } from "./trace";

const captureServerEvent = vi.fn();
vi.mock("@/lib/posthog-server", () => ({
  captureServerEvent: (...args: unknown[]) => captureServerEvent(...args),
}));

const { ABORTED, captureAiGeneration } = await import("./usage-events");

function trace(overrides: Partial<CallTrace> = {}): CallTrace {
  return {
    task: "goal_discover",
    model: "claude-sonnet-5",
    provider: "anthropic",
    tier: "standard",
    keySource: "platform",
    failedOver: [],
    inputTokens: 1200,
    outputTokens: 300,
    costUsd: 0.0123,
    latencyMs: 2500,
    ...overrides,
  };
}

/** Properties of the single captured event. */
function captured() {
  expect(captureServerEvent).toHaveBeenCalledTimes(1);
  const [distinctId, event, props] = captureServerEvent.mock.calls[0];
  return { distinctId, event, props: props as Record<string, unknown> };
}

beforeEach(() => {
  captureServerEvent.mockReset();
  captureServerEvent.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("captureAiGeneration", () => {
  it("maps a finished call to a $ai_generation event for the user", async () => {
    await captureAiGeneration("user_123", trace({ failedOver: ["claude-opus-5-5"] }));

    const { distinctId, event, props } = captured();
    expect(distinctId).toBe("user_123");
    expect(event).toBe("$ai_generation");
    expect(props).toMatchObject({
      $ai_span_name: "goal_discover",
      $ai_model: "claude-sonnet-5",
      $ai_provider: "anthropic",
      $ai_input_tokens: 1200,
      $ai_output_tokens: 300,
      $ai_total_cost_usd: 0.0123,
      $ai_latency: 2.5,
      $ai_is_error: false,
      $ai_error: undefined,
      task: "goal_discover",
      tier: "standard",
      key_source: "platform",
      failed_over: ["claude-opus-5-5"],
      estimated_cost_usd: 0.0123,
    });
    expect(props.$ai_trace_id).toEqual(expect.any(String));
  });

  it("reports cache tokens separately and passes its own cache-aware costs through", async () => {
    await captureAiGeneration(
      "u",
      trace({ inputTokens: 10_000, cacheReadTokens: 8_000, cacheWriteTokens: 1_000, inputCostUsd: 0.006, outputCostUsd: 0.003, costUsd: 0.009 }),
    );
    const { props } = captured();
    expect(props).toMatchObject({
      $ai_input_tokens: 1_000,
      $ai_cache_read_input_tokens: 8_000,
      $ai_cache_creation_input_tokens: 1_000,
      $ai_cache_reporting_exclusive: true,
      $ai_input_cost_usd: 0.006,
      $ai_output_cost_usd: 0.003,
      $ai_total_cost_usd: 0.009,
    });
  });

  it("uses a fresh trace id for each call", async () => {
    await captureAiGeneration("u", trace());
    await captureAiGeneration("u", trace());
    const [a, b] = captureServerEvent.mock.calls.map((c) => c[2].$ai_trace_id);
    expect(a).not.toBe(b);
  });

  it("reports BYOK calls as zero cost in every cost field", async () => {
    await captureAiGeneration("u", trace({ keySource: "byok", inputCostUsd: 0.3, outputCostUsd: 0.2, costUsd: 0.5 }));
    expect(captured().props).toMatchObject({ $ai_input_cost_usd: 0, $ai_output_cost_usd: 0, $ai_total_cost_usd: 0 });
  });

  it("reports BYOK calls as zero cost but keeps the estimate", async () => {
    await captureAiGeneration("u", trace({ keySource: "byok", costUsd: 0.5 }));
    const { props } = captured();
    expect(props.$ai_total_cost_usd).toBe(0);
    expect(props.estimated_cost_usd).toBe(0.5);
    expect(props.key_source).toBe("byok");
  });

  it("omits total cost when pricing is unknown (null) or missing", async () => {
    await captureAiGeneration("u", trace({ costUsd: null }));
    await captureAiGeneration("u", trace({ costUsd: undefined }));
    const [nullCost, missingCost] = captureServerEvent.mock.calls.map((c) => c[2]);
    expect(nullCost.$ai_total_cost_usd).toBeUndefined();
    expect(nullCost.estimated_cost_usd).toBeNull();
    expect(missingCost.$ai_total_cost_usd).toBeUndefined();
  });

  it("converts latency from ms to seconds, and leaves it out when unknown", async () => {
    await captureAiGeneration("u", trace({ latencyMs: 0 }));
    await captureAiGeneration("u", trace({ latencyMs: undefined }));
    const [zero, missing] = captureServerEvent.mock.calls.map((c) => c[2]);
    expect(zero.$ai_latency).toBe(0);
    expect(missing.$ai_latency).toBeUndefined();
  });

  it("marks failed calls with the error type, not its message", async () => {
    await captureAiGeneration(
      "u",
      trace({ inputTokens: undefined, outputTokens: undefined, costUsd: undefined }),
      new TypeError("Incorrect API key provided: sk-proj-****abcd"),
    );
    const { props } = captured();
    expect(props.$ai_is_error).toBe(true);
    expect(props.$ai_error).toBe("TypeError");
    expect(JSON.stringify(props)).not.toContain("sk-proj");
    expect(props.$ai_input_tokens).toBeUndefined();
  });

  it("adds the HTTP status for provider API errors", async () => {
    const apiError = new APICallError({
      message: "Overloaded: learner said 'my diagnosis is…'",
      url: "https://api.example.com",
      requestBodyValues: {},
      statusCode: 529,
    });
    await captureAiGeneration("u", trace(), apiError);
    const { props } = captured();
    expect(props.$ai_error).toBe("AI_APICallError 529");
    expect(JSON.stringify(props)).not.toContain("diagnosis");
  });

  it("keeps the aborted marker and describes non-Error failures by type only", async () => {
    await captureAiGeneration("u", trace(), ABORTED);
    await captureAiGeneration("u", trace(), "socket hang up");
    await captureAiGeneration("u", trace(), null);
    const [aborted, str, nul] = captureServerEvent.mock.calls.map((c) => c[2]);
    expect(aborted.$ai_error).toBe("aborted");
    expect(str.$ai_is_error).toBe(true);
    expect(str.$ai_error).toBe("non-Error (string)");
    expect(nul.$ai_is_error).toBe(true);
    expect(nul.$ai_error).toBe("non-Error (null)");
  });

  it("never throws when capture rejects, and logs instead", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    captureServerEvent.mockRejectedValueOnce(new Error("posthog down"));

    await expect(captureAiGeneration("u", trace())).resolves.toBeUndefined();
    expect(log).toHaveBeenCalledWith(
      "[ai_usage] failed to capture $ai_generation",
      expect.any(Error),
    );
  });

  it("never throws when capture throws synchronously", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    captureServerEvent.mockImplementationOnce(() => {
      throw new Error("boom");
    });
    await expect(captureAiGeneration("u", trace())).resolves.toBeUndefined();
  });
});

describe("test users", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("marks test_* ids and listed accounts as internal, and leaves learners alone", async () => {
    vi.stubEnv("POSTHOG_TEST_USER_IDS", "user_e2e, user_other");
    for (const id of ["test_lifecycle_a", "user_e2e", "user_real"]) {
      captureServerEvent.mockReset();
      await captureAiGeneration(id, trace());
      expect(captured().props.$set, id).toEqual(id === "user_real" ? undefined : { $internal_or_test_user: true });
    }
  });
});

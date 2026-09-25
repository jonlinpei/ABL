// Server-only: reports each AI call to PostHog LLM analytics as an
// `$ai_generation` event, so spend shows up per user, model and task.
import { captureServerEvent } from "@/lib/posthog-server";

import type { CallTrace } from "./trace";

/**
 * Send one finished (or failed) call. Never throws: analytics must not break
 * the request. Call it inside `after()` so it doesn't delay the response.
 */
export async function captureAiGeneration(
  userId: string,
  trace: CallTrace,
  error?: unknown,
): Promise<void> {
  try {
    await captureServerEvent(userId, "$ai_generation", {
      $ai_trace_id: crypto.randomUUID(),
      $ai_span_name: trace.task,
      $ai_model: trace.model,
      $ai_provider: trace.provider,
      $ai_input_tokens: trace.inputTokens,
      $ai_output_tokens: trace.outputTokens,
      // BYOK calls are billed to the user's key, so they cost us nothing.
      $ai_total_cost_usd: trace.keySource === "byok" ? 0 : (trace.costUsd ?? undefined),
      $ai_latency: trace.latencyMs !== undefined ? trace.latencyMs / 1000 : undefined,
      $ai_is_error: error !== undefined,
      $ai_error: error === undefined ? undefined : error instanceof Error ? error.message : String(error),
      task: trace.task,
      tier: trace.tier,
      key_source: trace.keySource,
      failed_over: trace.failedOver,
      estimated_cost_usd: trace.costUsd,
    });
  } catch (err) {
    console.error("[ai_usage] failed to capture $ai_generation", err);
  }
}

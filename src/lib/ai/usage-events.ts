// Server-only: reports each AI call to PostHog LLM analytics as an
// `$ai_generation` event, so spend shows up per user, model and task.
import { APICallError } from "ai";

import { captureServerEvent } from "@/lib/posthog-server";

import type { CallTrace } from "./trace";

/**
 * Send one finished (or failed) call. Never throws: analytics must not break
 * the request. Call it inside `after()` so it doesn't delay the response.
 * Calls that share a `traceId` (one conversation, or one request's failovers)
 * group into a single trace in PostHog.
 */
export async function captureAiGeneration(
  userId: string,
  trace: CallTrace,
  error?: unknown,
  traceId: string = crypto.randomUUID(),
): Promise<void> {
  try {
    await captureServerEvent(userId, "$ai_generation", {
      $ai_trace_id: traceId,
      $ai_span_name: trace.task,
      $ai_model: trace.model,
      $ai_provider: trace.provider,
      $ai_input_tokens: trace.inputTokens,
      $ai_output_tokens: trace.outputTokens,
      // BYOK calls are billed to the user's key, so they cost us nothing.
      $ai_total_cost_usd: trace.keySource === "byok" ? 0 : (trace.costUsd ?? undefined),
      $ai_latency: trace.latencyMs !== undefined ? trace.latencyMs / 1000 : undefined,
      $ai_is_error: error !== undefined,
      $ai_error: error === undefined ? undefined : describeError(error),
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

/** Marks a call the client cut off before it finished. */
export const ABORTED = "aborted";

/**
 * The error's type and HTTP status only. Messages can quote key fragments or
 * the learner's own words, and PostHog is a third party.
 */
export function describeError(error: unknown): string {
  if (error === ABORTED) return ABORTED;
  if (APICallError.isInstance(error)) {
    return error.statusCode === undefined ? error.name : `${error.name} ${error.statusCode}`;
  }
  if (error instanceof Error) return error.name;
  return `non-Error (${error === null ? "null" : typeof error})`;
}

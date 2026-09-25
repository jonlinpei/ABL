import type { LanguageModelUsage } from "ai";

import type { ModelSpec } from "./models";
import type { RoutedModel } from "./router";
import type { TaskType } from "./tasks";

/**
 * What the router chose for one AI call and what it cost. Sent to the client
 * so every call is visible. Later this is also the row written to `ai_usage`
 * for per-user metering (docs/business-model.md).
 */
export interface CallTrace {
  task: TaskType;
  model: string;
  provider: string;
  tier: string;
  keySource: RoutedModel["keySource"];
  /** Models tried and failed before this one, in order. */
  failedOver: string[];
  inputTokens?: number;
  outputTokens?: number;
  /** `null` when the model's pricing is unknown. */
  costUsd?: number | null;
  latencyMs?: number;
}

export function startTrace(
  task: TaskType,
  routed: RoutedModel,
  failedOver: string[] = [],
): CallTrace {
  const { model } = routed;
  return {
    task,
    model: model.id,
    provider: model.provider,
    tier: model.tier,
    keySource: routed.keySource,
    failedOver,
  };
}

export function finishTrace(
  trace: CallTrace,
  model: ModelSpec,
  usage: LanguageModelUsage | undefined,
  startedAt: number,
): CallTrace {
  return {
    ...trace,
    inputTokens: usage?.inputTokens,
    outputTokens: usage?.outputTokens,
    costUsd: estimateCostUsd(model, usage),
    latencyMs: Date.now() - startedAt,
  };
}

/** List-price estimate. Ignores cache discounts, so it slightly overstates cost. */
export function estimateCostUsd(
  model: ModelSpec,
  usage: LanguageModelUsage | undefined,
): number | null {
  if (!model.pricing || !usage) return null;
  const input = usage.inputTokens ?? 0;
  const output = usage.outputTokens ?? 0;
  return (
    (input * model.pricing.inputPerMTok + output * model.pricing.outputPerMTok) / 1_000_000
  );
}

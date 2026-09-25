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

/** The token counts a trace needs; full SDK usage objects fit too. */
export type TokenUsage = Pick<LanguageModelUsage, "inputTokens" | "outputTokens">;

/** Adds up usage across steps, e.g. the steps that finished before an abort. */
export function sumUsage(usages: TokenUsage[]): TokenUsage | undefined {
  if (usages.length === 0) return undefined;
  return {
    inputTokens: usages.reduce((n, u) => n + (u.inputTokens ?? 0), 0),
    outputTokens: usages.reduce((n, u) => n + (u.outputTokens ?? 0), 0),
  };
}

export function finishTrace(
  trace: CallTrace,
  model: ModelSpec,
  usage: TokenUsage | undefined,
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
  usage: TokenUsage | undefined,
): number | null {
  if (!model.pricing || !usage) return null;
  const input = usage.inputTokens ?? 0;
  const output = usage.outputTokens ?? 0;
  return (
    (input * model.pricing.inputPerMTok + output * model.pricing.outputPerMTok) / 1_000_000
  );
}

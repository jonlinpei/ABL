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
  /** All input tokens, cached or not. */
  inputTokens?: number;
  outputTokens?: number;
  /** Input tokens read from, and written to, the prompt cache (part of inputTokens). */
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  /** Provider web searches the call ran; each is billed on top of tokens. */
  webSearches?: number;
  /** `null` when the model's pricing is unknown. */
  costUsd?: number | null;
  /** The cost split, cache included in input. `null` when pricing is unknown. */
  inputCostUsd?: number | null;
  outputCostUsd?: number | null;
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
export type TokenUsage = Pick<LanguageModelUsage, "inputTokens" | "outputTokens"> & {
  inputTokenDetails?: Partial<Pick<LanguageModelUsage["inputTokenDetails"], "cacheReadTokens" | "cacheWriteTokens">>;
};

/** Adds up usage across steps, e.g. the steps that finished before an abort. */
export function sumUsage(usages: TokenUsage[]): TokenUsage | undefined {
  if (usages.length === 0) return undefined;
  const total = (f: (u: TokenUsage) => number | undefined) => usages.reduce((n, u) => n + (f(u) ?? 0), 0);
  return {
    inputTokens: total((u) => u.inputTokens),
    outputTokens: total((u) => u.outputTokens),
    inputTokenDetails: {
      cacheReadTokens: total((u) => u.inputTokenDetails?.cacheReadTokens),
      cacheWriteTokens: total((u) => u.inputTokenDetails?.cacheWriteTokens),
    },
  };
}

export function finishTrace(
  trace: CallTrace,
  model: ModelSpec,
  usage: TokenUsage | undefined,
  startedAt: number,
  webSearches = 0,
): CallTrace {
  const cost = estimateCost(model, usage, webSearches);
  return {
    ...trace,
    inputTokens: usage?.inputTokens,
    outputTokens: usage?.outputTokens,
    cacheReadTokens: usage?.inputTokenDetails?.cacheReadTokens,
    cacheWriteTokens: usage?.inputTokenDetails?.cacheWriteTokens,
    ...(webSearches > 0 && { webSearches }),
    costUsd: cost?.total ?? null,
    inputCostUsd: cost?.input ?? null,
    outputCostUsd: cost?.output ?? null,
    latencyMs: Date.now() - startedAt,
  };
}

/**
 * List-price estimate, with prompt-cache reads and writes at their own
 * prices, and web searches in the total. `inputTokens` includes cached tokens (the AI SDK counts them in),
 * so the uncached part is what's left after taking them out.
 */
export function estimateCost(
  model: ModelSpec,
  usage: TokenUsage | undefined,
  webSearches = 0,
): { input: number; output: number; total: number } | null {
  if (!model.pricing || !usage) return null;
  const p = model.pricing;
  const read = usage.inputTokenDetails?.cacheReadTokens ?? 0;
  const write = usage.inputTokenDetails?.cacheWriteTokens ?? 0;
  const uncached = Math.max(0, (usage.inputTokens ?? 0) - read - write);
  const input =
    (uncached * p.inputPerMTok + read * (p.cacheReadPerMTok ?? p.inputPerMTok) + write * (p.cacheWritePerMTok ?? p.inputPerMTok)) /
    1_000_000;
  const output = ((usage.outputTokens ?? 0) * p.outputPerMTok) / 1_000_000;
  const searches = webSearches * (p.webSearchPerRequest ?? 0);
  return { input, output, total: input + output + searches };
}

/** Total cost only. */
export function estimateCostUsd(model: ModelSpec, usage: TokenUsage | undefined): number | null {
  return estimateCost(model, usage)?.total ?? null;
}

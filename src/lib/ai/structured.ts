import { generateText, NoObjectGeneratedError, Output } from "ai";
import type { z } from "zod";

import { configuredProviders, toLanguageModel } from "./providers";
import { resolveModel } from "./router";
import type { TaskType } from "./tasks";
import { finishTrace, startTrace, type CallTrace } from "./trace";
import { captureAiGeneration } from "./usage-events";

export class AllModelsFailedError extends Error {
  constructor(
    readonly task: TaskType,
    readonly failedOver: string[],
  ) {
    super(`Every eligible model failed for ${task}: ${failedOver.join(", ")}`);
    this.name = "AllModelsFailedError";
  }
}

/**
 * One structured-output call, routed by task: tries the primary model, then
 * each fallback, and reports every attempt to PostHog. For background work;
 * request handlers can pass `capture` to defer reporting with `after()`.
 */
export async function generateStructured<T>({
  task,
  userId,
  instructions,
  prompt,
  schema,
  traceId = crypto.randomUUID(),
  capture = (fn) => fn(),
}: {
  task: TaskType;
  userId: string;
  instructions: string;
  prompt: string;
  schema: z.ZodType<T>;
  traceId?: string;
  capture?: (report: () => Promise<void>) => unknown;
}): Promise<{ output: T; trace: CallTrace }> {
  const { primary, fallbacks } = resolveModel(task, { allowedProviders: configuredProviders() });
  const failedOver: string[] = [];

  for (const routed of [primary, ...fallbacks]) {
    const trace = startTrace(task, routed, [...failedOver]);
    const startedAt = Date.now();
    try {
      const result = await generateText({
        model: toLanguageModel(routed),
        instructions,
        prompt,
        output: Output.object({ schema }),
      });
      const finished = finishTrace(trace, routed.model, result.totalUsage, startedAt);
      await capture(() => captureAiGeneration(userId, finished, undefined, traceId));
      return { output: result.output as T, trace: finished };
    } catch (err) {
      console.error(`[${task}] ${routed.model.id} failed`, err);
      // A response that fails schema parsing was still generated and billed.
      const usage = NoObjectGeneratedError.isInstance(err) ? err.usage : undefined;
      const failed = finishTrace(trace, routed.model, usage, startedAt);
      await capture(() => captureAiGeneration(userId, failed, err, traceId));
      failedOver.push(routed.model.id);
    }
  }
  throw new AllModelsFailedError(task, failedOver);
}

import { after } from "next/server";

import type { RoutedModel } from "./router";
import type { TaskType } from "./tasks";
import { finishTrace, startTrace, sumUsage, type CallTrace, type TokenUsage } from "./trace";
import { ABORTED, captureAiGeneration } from "./usage-events";

/**
 * Usage tracking for a streamed chat turn. Returns the hooks to pass to
 * `streamText` and `toUIMessageStream`, and registers an `after()` callback
 * that reports the call once the response has closed. Every call is
 * recorded: finished, failed, or cut off by the client (with the usage of any
 * steps that finished).
 */
export function trackChatUsage({
  task,
  routed,
  userId,
  traceId,
}: {
  task: TaskType;
  routed: RoutedModel;
  userId: string;
  traceId: string;
}) {
  const trace = startTrace(task, routed);
  const startedAt = Date.now();
  let finished: CallTrace | undefined;
  let streamError: unknown;
  let abortedUsage: TokenUsage | undefined;

  after(() => {
    if (finished) return captureAiGeneration(userId, finished, streamError, traceId);
    const partial = finishTrace(trace, routed.model, abortedUsage, startedAt);
    return captureAiGeneration(userId, partial, streamError ?? ABORTED, traceId);
  });

  return {
    /** For `streamText`. */
    onAbort: ({ steps }: { steps: { usage: TokenUsage }[] }) => {
      abortedUsage = sumUsage(steps.map((step) => step.usage));
    },
    /** For `toUIMessageStream`: the trace rides along as message metadata. */
    messageMetadata: ({ part }: { part: { type: string; totalUsage?: TokenUsage } }) => {
      if (part.type === "start") return trace;
      if (part.type === "finish") {
        finished = finishTrace(trace, routed.model, part.totalUsage, startedAt);
        return finished;
      }
    },
    /** For `toUIMessageStream`. */
    onError: (error: unknown) => {
      streamError = error;
      console.error(`[${task}]`, error);
      return error instanceof Error ? error.message : "The tutor hit an error.";
    },
  };
}

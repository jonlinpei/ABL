import { auth } from "@clerk/nextjs/server";
import {
  convertToModelMessages,
  createUIMessageStreamResponse,
  hasToolCall,
  streamText,
  tool,
  toUIMessageStream,
  type UIMessage,
} from "ai";
import { after } from "next/server";

import { configuredProviders, toLanguageModel } from "@/lib/ai/providers";
import { NoEligibleModelError, resolveModel } from "@/lib/ai/router";
import { finishTrace, startTrace, sumUsage, type CallTrace, type TokenUsage } from "@/lib/ai/trace";
import { captureAiGeneration } from "@/lib/ai/usage-events";
import { DISCOVERY_SYSTEM_PROMPT } from "@/lib/goals/prompts";
import { GoalBriefSchema } from "@/lib/goals/schema";

export const maxDuration = 60;

export type DiscoveryMessage = UIMessage<CallTrace>;

const tools = {
  propose_goal_brief: tool({
    description:
      "Show the learner their goal brief as a card to confirm or correct. Call when discovery has enough information, and again after any correction.",
    inputSchema: GoalBriefSchema,
    // Strict mode guarantees schema-valid input, so the card always renders.
    strict: true,
    // The learner confirms in the UI. The result only closes the tool call so
    // the conversation can continue if they ask for changes.
    execute: async () => ({ status: "shown_to_learner" as const }),
  }),
};

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return new Response("Unauthorized", { status: 401 });

  const { id: chatId, messages }: { id?: unknown; messages: DiscoveryMessage[] } =
    await req.json();
  // One PostHog trace per conversation. The client sends the chat id, so bound it.
  const traceId =
    typeof chatId === "string" && chatId.length > 0 && chatId.length <= 100
      ? chatId
      : crypto.randomUUID();

  let resolution;
  try {
    // Demo: route only to providers that have a platform key configured.
    resolution = resolveModel("goal_discover", { allowedProviders: configuredProviders() });
  } catch (err) {
    if (err instanceof NoEligibleModelError && configuredProviders().length === 0) {
      return new Response(
        "No AI provider key is configured. Set ANTHROPIC_API_KEY (or another provider key) in .env.local and restart the dev server.",
        { status: 503 },
      );
    }
    throw err;
  }

  const routed = resolution.primary;
  const trace = startTrace("goal_discover", routed);
  const startedAt = Date.now();
  const today = new Date().toISOString().slice(0, 10);
  let finished: CallTrace | undefined;
  let streamError: unknown;
  let abortedUsage: TokenUsage | undefined;

  // Runs once the response has closed. Every call is recorded: finished,
  // failed, or cut off by the client (with the usage of any finished steps).
  after(() => {
    if (finished) return captureAiGeneration(userId, finished, streamError, traceId);
    const partial = finishTrace(trace, routed.model, abortedUsage, startedAt);
    return captureAiGeneration(userId, partial, streamError ?? "aborted", traceId);
  });

  const result = streamText({
    model: toLanguageModel(routed),
    instructions: `${DISCOVERY_SYSTEM_PROMPT}\n\nToday is ${today}.`,
    messages: await convertToModelMessages(messages),
    tools,
    stopWhen: hasToolCall("propose_goal_brief"),
    // Stop generating (and paying) when the client disconnects.
    abortSignal: req.signal,
    onAbort: ({ steps }) => {
      abortedUsage = sumUsage(steps.map((step) => step.usage));
    },
  });

  return createUIMessageStreamResponse({
    stream: toUIMessageStream({
      stream: result.stream,
      originalMessages: messages,
      messageMetadata: ({ part }) => {
        if (part.type === "start") return trace;
        if (part.type === "finish") {
          finished = finishTrace(trace, routed.model, part.totalUsage, startedAt);
          return finished;
        }
      },
      onError: (error) => {
        streamError = error;
        console.error("[goal_discover]", error);
        return error instanceof Error ? error.message : "The tutor hit an error.";
      },
    }),
  });
}

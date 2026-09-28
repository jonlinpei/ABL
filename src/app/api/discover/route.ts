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

import { configuredProviders, toLanguageModel } from "@/lib/ai/providers";
import { NoEligibleModelError, resolveModel } from "@/lib/ai/router";
import { trackChatUsage } from "@/lib/ai/chat-usage";
import type { CallTrace } from "@/lib/ai/trace";
import { invalidAttachments } from "@/lib/goals/attachments";
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

  const attachmentError = invalidAttachments(messages);
  if (attachmentError) return Response.json({ error: attachmentError }, { status: 400 });

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
  const usage = trackChatUsage({ task: "goal_discover", routed, userId, traceId });
  const today = new Date().toISOString().slice(0, 10);

  const modelMessages = await convertToModelMessages(messages);
  // A resume is resent on every turn. A cache breakpoint on the newest message
  // lets the next turn read the whole prefix, resume included, from cache.
  const last = modelMessages.at(-1);
  if (last) last.providerOptions = { anthropic: { cacheControl: { type: "ephemeral" } } };

  const result = streamText({
    model: toLanguageModel(routed),
    instructions: `${DISCOVERY_SYSTEM_PROMPT}\n\nToday is ${today}.`,
    messages: modelMessages,
    tools,
    stopWhen: hasToolCall("propose_goal_brief"),
    // Stop generating (and paying) when the client disconnects.
    abortSignal: req.signal,
    onAbort: usage.onAbort,
  });

  return createUIMessageStreamResponse({
    stream: toUIMessageStream({
      stream: result.stream,
      originalMessages: messages,
      messageMetadata: usage.messageMetadata,
      onError: usage.onError,
    }),
  });
}

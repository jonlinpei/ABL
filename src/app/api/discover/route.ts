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
import { isDatabaseConfigured } from "@/db";
import { goalForRequest } from "@/lib/goals/request-goal";
import { GoalBriefSchema, type GoalBrief } from "@/lib/goals/schema";
import { loadGoalState } from "@/lib/specialists/store";

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

  const { id: chatId, messages, goalId }: { id?: unknown; messages: DiscoveryMessage[]; goalId?: unknown } =
    await req.json();
  // One PostHog trace per conversation. The client sends the chat id, so bound it.
  const traceId =
    typeof chatId === "string" && chatId.length > 0 && chatId.length <= 100
      ? chatId
      : crypto.randomUUID();

  const attachmentError = invalidAttachments(messages);
  if (attachmentError) return Response.json({ error: attachmentError }, { status: 400 });

  // Changing an existing goal: discovery starts from its newest brief, a
  // pending version if one is being prepared, else the current one.
  let existing: GoalBrief | null = null;
  if (goalId != null && isDatabaseConfigured()) {
    const resolved = await goalForRequest(userId, goalId);
    if ("error" in resolved) return resolved.error;
    const state = await loadGoalState(userId, resolved.goal.id);
    existing = (state?.pending ?? state)?.brief.brief ?? null;
  }

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
    instructions: `${DISCOVERY_SYSTEM_PROMPT}\n\nToday is ${today}.${existing ? changingGoalContext(existing) : ""}`,
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

/** For "Change this goal": the brief as it stands, to update rather than start over. */
function changingGoalContext(brief: GoalBrief): string {
  return `

The learner is changing a goal they already have. Their current brief is below. Ask what's changed, update the brief, and don't start over or re-ask what it already answers.

<current_brief>
${JSON.stringify(brief, null, 2)}
</current_brief>`;
}

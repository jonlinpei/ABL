import { auth } from "@clerk/nextjs/server";
import { convertToModelMessages, createIdGenerator, createUIMessageStreamResponse, streamText, toUIMessageStream, type UIMessage } from "ai";
import { z } from "zod";

import { isDatabaseConfigured } from "@/db";
import { trackChatUsage } from "@/lib/ai/chat-usage";
import { configuredProviders, toLanguageModel } from "@/lib/ai/providers";
import { resolveModel } from "@/lib/ai/router";
import type { CallTrace } from "@/lib/ai/trace";
import { learnerTurns, MAX_SIDEKICK_TURNS, sidekickContext } from "@/lib/specialists/sidekick";
import { SIDEKICK_SKILL } from "@/lib/specialists/sidekick.generated";
import { loadSidekick, saveSidekickMessages } from "@/lib/specialists/sidekick-store";
import { loadSessionState } from "@/lib/specialists/session-state";
import { goalOfSession } from "@/lib/specialists/store";
import { goalForRequest } from "@/lib/goals/request-goal";

export const maxDuration = 30;

export type SidekickMessage = UIMessage<CallTrace>;

const Body = z.object({ id: z.uuid(), sessionId: z.string(), messages: z.array(z.unknown()).min(1) });

/** One turn of a sidekick: a quick side question during the learner's active session. */
export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return new Response("Unauthorized", { status: 401 });
  if (!isDatabaseConfigured()) return Response.json({ error: "No database is configured." }, { status: 503 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid request", issues: parsed.error.issues }, { status: 400 });
  const { id, sessionId } = parsed.data;
  const messages = parsed.data.messages as SidekickMessage[];

  const goalId = await goalOfSession(userId, sessionId);
  if (goalId) {
    const resolved = await goalForRequest(userId, goalId, { learning: true });
    if ("error" in resolved) return resolved.error;
  }
  const state = goalId ? await loadSessionState(userId, goalId) : undefined;
  const session = state?.active;
  if (!state || !session || session.id !== sessionId) {
    return Response.json({ error: "Side questions work during an active session." }, { status: 409 });
  }
  const existing = await loadSidekick(id, userId);
  if (existing?.closedAt || (existing && existing.sessionId !== sessionId)) {
    return Response.json({ error: "This side question is closed. Ask a new one." }, { status: 409 });
  }
  if (learnerTurns(messages) > MAX_SIDEKICK_TURNS) {
    return Response.json({ error: "This has grown past a quick question. Take it back to your tutor." }, { status: 429 });
  }

  const routed = resolveModel("sidekick_answer", { allowedProviders: configuredProviders() }).primary;
  // Grouped with the session's trace in PostHog.
  const usage = trackChatUsage({ task: "sidekick_answer", routed, userId, traceId: session.id });
  const result = streamText({
    model: toLanguageModel(routed),
    instructions: `${SIDEKICK_SKILL}\n\n${sidekickContext({ brief: state.brief.brief, plan: state.plan.plan, milestoneIndex: session.milestoneIndex, lesson: session.messages })}`,
    messages: await convertToModelMessages(messages),
    maxOutputTokens: 600,
    abortSignal: req.signal,
    onAbort: usage.onAbort,
  });

  return createUIMessageStreamResponse({
    stream: toUIMessageStream({
      stream: result.stream,
      originalMessages: messages,
      generateMessageId: createIdGenerator({ prefix: "msg", size: 16 }),
      messageMetadata: usage.messageMetadata,
      onError: usage.onError,
      onEnd: async ({ messages: all }) => {
        await saveSidekickMessages(id, userId, session.id, all);
      },
    }),
  });
}

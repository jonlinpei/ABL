import { auth } from "@clerk/nextjs/server";
import {
  convertToModelMessages,
  createIdGenerator,
  createUIMessageStreamResponse,
  hasToolCall,
  streamText,
  tool,
  toUIMessageStream,
  type ModelMessage,
  type UIMessage,
} from "ai";

import { isDatabaseConfigured } from "@/db";
import { inngest } from "@/inngest/client";
import { sessionCompleted } from "@/inngest/events";
import { trackChatUsage } from "@/lib/ai/chat-usage";
import { configuredProviders, toLanguageModel } from "@/lib/ai/providers";
import { resolveModel } from "@/lib/ai/router";
import type { CallTrace } from "@/lib/ai/trace";
import { goalForRequest } from "@/lib/goals/request-goal";
import { loadSessionState } from "@/lib/specialists/session-state";
import { glossaryNotes } from "@/lib/specialists/glossary";
import { loadGlossary } from "@/lib/specialists/glossary-store";
import { sidekickNotes } from "@/lib/specialists/sidekick";
import { loadSessionSidekicks } from "@/lib/specialists/sidekick-store";
import { endSession, goalOfSession, saveSessionMessages } from "@/lib/specialists/store";
import { endSessionSchema, normalizeReport, sessionClock, tutorContext } from "@/lib/specialists/tutor";
import { TUTOR_SKILL } from "@/lib/specialists/tutor.generated";

export const maxDuration = 60;

export type SessionMessage = UIMessage<CallTrace>;

/** One turn of a tutoring session (the Tutor specialist). */
export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return new Response("Unauthorized", { status: 401 });
  if (!isDatabaseConfigured()) return Response.json({ error: "No database is configured." }, { status: 503 });

  const { id: sessionId, messages }: { id?: unknown; messages: SessionMessage[] } = await req.json();
  // The session says which goal it's on.
  const goalId = typeof sessionId === "string" ? await goalOfSession(userId, sessionId) : undefined;
  if (goalId) {
    // A goal paused, completed or removed mid-session stops taking turns.
    const resolved = await goalForRequest(userId, goalId, { learning: true });
    if ("error" in resolved) return resolved.error;
  }
  const state = goalId ? await loadSessionState(userId, goalId) : undefined;
  const session = state?.active;
  if (!goalId || !state || !session || session.id !== sessionId) {
    return Response.json({ error: "This session isn't active. Start a new one." }, { status: 409 });
  }

  const plan = state.plan.plan;
  const milestone = plan.milestones[session.milestoneIndex]!;
  const tools = {
    end_session: tool({
      description: "Record what the learner covered and showed, and end the session. Call once, at the end.",
      // Evidence can cover the milestone's skills and any skill reviewed this session.
      inputSchema: endSessionSchema([...new Set([...milestone.skills.map((s) => s.skillId), ...state.dueReviews.map((r) => r.skillId)])]),
      strict: true,
      execute: async (input) => {
        const report = normalizeReport(input);
        const { ended } = await endSession(session.id, userId, report);
        if (ended) await startMasteryUpdate(userId, session.id, goalId);
        return { status: ended ? ("ended" as const) : ("already_ended" as const), milestoneComplete: report.milestoneComplete };
      },
    }),
  };

  const routed = resolveModel("tutor_session", { allowedProviders: configuredProviders() }).primary;
  const usage = trackChatUsage({ task: "tutor_session", routed, userId, traceId: session.id });
  const elapsed = Math.floor((Date.now() - session.startedAt.getTime()) / 60_000);

  // Per-turn notes ride on the newest learner message, so the instructions stay cacheable.
  const [sidekicks, glossary] = await Promise.all([loadSessionSidekicks(session.id), loadGlossary(userId)]);
  const notes = [
    sessionClock(elapsed, plan.sessionMinutes),
    sidekickNotes(sidekicks),
    glossaryNotes(glossary, milestone.skills.map((s) => s.skillId), state.gap),
  ];
  const modelMessages = withTurnNotes(await convertToModelMessages(messages), notes.filter((n): n is string => !!n));
  // Sessions are long: cache everything up to the newest message.
  const last = modelMessages.at(-1);
  if (last) last.providerOptions = { anthropic: { cacheControl: { type: "ephemeral" } } };

  const result = streamText({
    model: toLanguageModel(routed),
    instructions: `${TUTOR_SKILL}\n\n${tutorContext({ ...state, brief: state.brief.brief, plan, milestoneIndex: session.milestoneIndex })}`,
    messages: modelMessages,
    tools,
    stopWhen: hasToolCall("end_session"),
    abortSignal: req.signal,
    onAbort: usage.onAbort,
  });

  return createUIMessageStreamResponse({
    stream: toUIMessageStream({
      stream: result.stream,
      originalMessages: messages,
      // Stable ids, since the transcript is stored and reloaded.
      generateMessageId: createIdGenerator({ prefix: "msg", size: 16 }),
      messageMetadata: usage.messageMetadata,
      onError: usage.onError,
      onEnd: async ({ messages: all }) => {
        await saveSessionMessages(session.id, userId, all);
      },
    }),
  });
}

/** The session's report is the record; if the job runner is down, the evidence can be applied later. */
async function startMasteryUpdate(userId: string, sessionId: string, goalId: string) {
  try {
    await inngest.send(sessionCompleted.create({ userId, sessionId, goalId }));
  } catch (err) {
    console.error("[session] couldn't start the mastery update", err);
  }
}

/** Add the clock and other per-turn notes to the newest learner message, as separate text parts. */
function withTurnNotes(messages: ModelMessage[], notes: string[]): ModelMessage[] {
  const i = messages.findLastIndex((m) => m.role === "user");
  if (i === -1) return messages;
  const m = messages[i]!;
  if (m.role !== "user") return messages;
  const content = typeof m.content === "string" ? [{ type: "text" as const, text: m.content }] : m.content;
  const copy = [...messages];
  copy[i] = { ...m, content: [...content, ...notes.map((text) => ({ type: "text" as const, text }))] };
  return copy;
}

import { auth } from "@clerk/nextjs/server";
import { convertToModelMessages, createUIMessageStreamResponse, streamText, tool, toUIMessageStream, type UIMessage } from "ai";

import { isDatabaseConfigured } from "@/db";
import { trackChatUsage } from "@/lib/ai/chat-usage";
import { configuredProviders, toLanguageModel } from "@/lib/ai/providers";
import { resolveModel } from "@/lib/ai/router";
import type { CallTrace } from "@/lib/ai/trace";
import { goalForRequest } from "@/lib/goals/request-goal";
import { assessmentAccepted, checkSubmission, incompleteReply, submissionSchema } from "@/lib/specialists/assessment";
import { ASSESSOR_SKILL } from "@/lib/specialists/assessor.generated";
import { beforeAndAfter, milestoneCheckContext, milestoneToCheck } from "@/lib/specialists/milestone-check";
import { loadMilestoneChecks, saveMilestoneCheck } from "@/lib/specialists/milestone-check-store";
import { loadSessionState } from "@/lib/specialists/session-state";

export const maxDuration = 60;

export type MilestoneCheckMessage = UIMessage<CallTrace>;

/** The milestone check: a short "prove it" check of the milestone the learner just finished. */
export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return new Response("Unauthorized", { status: 401 });
  if (!isDatabaseConfigured()) return Response.json({ error: "No database is configured." }, { status: 503 });
  const { id: chatId, messages, goalId }: { id?: unknown; messages: MilestoneCheckMessage[]; goalId?: unknown } = await req.json();
  const traceId = typeof chatId === "string" && chatId.length > 0 && chatId.length <= 100 ? chatId : crypto.randomUUID();

  const resolved = await goalForRequest(userId, goalId, { learning: true });
  if ("error" in resolved) return resolved.error;
  const state = await loadSessionState(userId, resolved.goal.id);
  const handled = state ? new Set((await loadMilestoneChecks(state.plan.id)).map((c) => c.milestoneIndex)) : new Set<number>();
  const toCheck = state && milestoneToCheck(state.plan.plan, state.history, state.gap, handled);
  if (!state || !toCheck) return Response.json({ error: "There's no milestone check waiting." }, { status: 409 });

  const ids = toCheck.skills.map((s) => s.skillId) as [string, ...string[]];
  const before = toCheck.skills.map((s) => ({ skillId: s.skillId, level: s.current }));
  const tools = {
    submit_assessment: tool({
      description: "Record the level each checked skill showed. Call once, after the last skill.",
      inputSchema: submissionSchema(ids),
      strict: true,
      execute: async ({ results }) => {
        const check = checkSubmission(results, ids);
        if (!check.ok) return incompleteReply(check.missing);
        const { saved } = await saveMilestoneCheck(userId, state.plan.id, toCheck.milestoneIndex, before, check.results, state.gap);
        return { status: saved ? ("saved" as const) : ("already_saved" as const), results: beforeAndAfter(before, check.results, toCheck.skills) };
      },
    }),
  };

  const routed = resolveModel("assessment_run", { allowedProviders: configuredProviders() }).primary;
  const usage = trackChatUsage({ task: "assessment_run", routed, userId, traceId });
  const milestone = state.plan.plan.milestones[toCheck.milestoneIndex]!;
  const result = streamText({
    model: toLanguageModel(routed),
    instructions: `${ASSESSOR_SKILL}\n\n${milestoneCheckContext(state.brief.brief, milestone, toCheck.skills)}`,
    messages: await convertToModelMessages(messages),
    tools,
    stopWhen: assessmentAccepted,
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

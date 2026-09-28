import { auth } from "@clerk/nextjs/server";
import {
  convertToModelMessages,
  createUIMessageStreamResponse,
  streamText,
  tool,
  toUIMessageStream,
  type UIMessage,
} from "ai";
import { isDatabaseConfigured } from "@/db";
import { inngest } from "@/inngest/client";
import { assessmentDone } from "@/inngest/events";
import { trackChatUsage } from "@/lib/ai/chat-usage";
import { configuredProviders, toLanguageModel } from "@/lib/ai/providers";
import { resolveModel } from "@/lib/ai/router";
import type { CallTrace } from "@/lib/ai/trace";
import {
  applyAssessment,
  assessmentAccepted,
  assessorContext,
  checkSubmission,
  incompleteReply,
  selectSkillsToCheck,
  submissionSchema,
} from "@/lib/specialists/assessment";
import { ASSESSOR_SKILL } from "@/lib/specialists/assessor.generated";
import { loadLatestBriefAndGap, saveAssessment } from "@/lib/specialists/store";

export const maxDuration = 60;

export type AssessMessage = UIMessage<CallTrace>;

/** The skills check for the learner's newest brief (the Assessor specialist). */
export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return new Response("Unauthorized", { status: 401 });
  if (!isDatabaseConfigured()) {
    return Response.json({ error: "No database is configured." }, { status: 503 });
  }

  const { id: chatId, messages }: { id?: unknown; messages: AssessMessage[] } = await req.json();
  const traceId =
    typeof chatId === "string" && chatId.length > 0 && chatId.length <= 100 ? chatId : crypto.randomUUID();

  const state = await loadLatestBriefAndGap(userId);
  if (!state?.gap) {
    return Response.json({ error: "Your skills picture is still being built." }, { status: 409 });
  }
  if (state.gap.assessedAt) {
    return Response.json({ error: "You've already done the skills check for this goal." }, { status: 409 });
  }
  const skills = selectSkillsToCheck(state.gap.gap);
  if (skills.length === 0) {
    return Response.json({ error: "There's nothing to check for this goal." }, { status: 409 });
  }
  const { brief, gap } = state;

  const ids = skills.map((s) => s.skillId) as [string, ...string[]];
  const tools = {
    submit_assessment: tool({
      description: "Record the level each checked skill showed. Call once, after the last skill.",
      inputSchema: submissionSchema(ids),
      strict: true,
      execute: async ({ results }) => {
        const check = checkSubmission(results, ids);
        if (!check.ok) return incompleteReply(check.missing);
        const assessedGap = applyAssessment(gap.gap, check.results);
        const { saved } = await saveAssessment(userId, brief.id, check.results, assessedGap);
        if (saved) await continueLifecycle(userId, brief.id);
        return { status: saved ? ("saved" as const) : ("already_saved" as const), counts: assessedGap.counts };
      },
    }),
  };

  const routed = resolveModel("assessment_run", { allowedProviders: configuredProviders() }).primary;
  const usage = trackChatUsage({ task: "assessment_run", routed, userId, traceId });

  const result = streamText({
    model: toLanguageModel(routed),
    instructions: `${ASSESSOR_SKILL}\n\n${assessorContext(brief.brief, skills)}`,
    // The client starts the check with a hidden "ready" message.
    messages: await convertToModelMessages(messages),
    tools,
    // A rejected submission goes back to the Assessor, which carries on.
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

/** The lifecycle is waiting for the check before planning. The saved row is the record. */
async function continueLifecycle(userId: string, briefId: string) {
  try {
    await inngest.send(assessmentDone.create({ userId, briefId }));
  } catch (err) {
    console.error("[assess] couldn't resume the learner lifecycle", err);
  }
}


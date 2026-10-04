import { auth } from "@clerk/nextjs/server";
import { z } from "zod";

import { isDatabaseConfigured } from "@/db";
import { goalForRequest } from "@/lib/goals/request-goal";
import { draftSideQuest, planWeeksFor } from "@/lib/specialists/side-quest";
import { proposeSideQuest } from "@/lib/specialists/side-quest-store";
import { loadSessionState } from "@/lib/specialists/session-state";

export const maxDuration = 60;

const Body = z.object({ goalId: z.string().optional(), topic: z.string().trim().min(2).max(300) });

/**
 * The learner names a topic to explore: draft a side quest for it, with what
 * it would cost their timeline if it uses plan time. It's a proposal until
 * they choose.
 */
export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return new Response("Unauthorized", { status: 401 });
  if (!isDatabaseConfigured()) return Response.json({ error: "No database is configured." }, { status: 503 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Tell me what you'd like to explore." }, { status: 400 });
  const resolved = await goalForRequest(userId, parsed.data.goalId, { learning: true });
  if ("error" in resolved) return resolved.error;
  const state = await loadSessionState(userId, resolved.goal.id);
  if (!state) return Response.json({ error: "Your roadmap isn't ready yet." }, { status: 409 });

  let draft;
  try {
    draft = await draftSideQuest(
      { brief: state.brief.brief, plan: state.plan.plan, milestoneIndex: state.milestoneIndex, gap: state.gap, topic: parsed.data.topic },
      userId,
    );
  } catch (err) {
    console.error("[side-quests] couldn't draft", err);
    return Response.json({ error: "Couldn't plan that side quest right now. Please try again." }, { status: 502 });
  }
  const quest = await proposeSideQuest(userId, resolved.goal.id, parsed.data.topic, draft, planWeeksFor(draft.sessions, state.plan.plan));
  if (!quest) return Response.json({ error: "Finish or drop your current side quest first." }, { status: 409 });
  return Response.json({ id: quest.id });
}

import { auth } from "@clerk/nextjs/server";

import { isDatabaseConfigured } from "@/db";
import { goalForRequest } from "@/lib/goals/request-goal";
import { loadSessionState } from "@/lib/specialists/session-state";
import { endedQuestSessions, loadSideQuest } from "@/lib/specialists/side-quest-store";
import { startSession } from "@/lib/specialists/store";

export interface StartSessionResponse {
  id: string;
  milestoneIndex: number;
  /** The milestone's title, or the side quest's for a side-quest session. */
  milestoneTitle: string;
  /** Set for a side-quest session. */
  sideQuest: { id: string; sessionNumber: number; sessions: number } | null;
  sessionNumber: number;
  /** The transcript so far, when resuming a session that's already running. */
  messages: unknown[];
}

/**
 * Start the next tutoring session on a goal, or resume the one in progress.
 * With `sideQuestId`, it's a session on the goal's active side quest.
 */
export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return new Response("Unauthorized", { status: 401 });
  if (!isDatabaseConfigured()) return Response.json({ error: "No database is configured." }, { status: 503 });

  const body = await req.json().catch(() => null);
  const resolved = await goalForRequest(userId, body?.goalId, { learning: true });
  if ("error" in resolved) return resolved.error;
  const state = await loadSessionState(userId, resolved.goal.id);
  if (!state) return Response.json({ error: "Your roadmap isn't ready yet." }, { status: 409 });

  const milestoneIndex = state.active?.milestoneIndex ?? state.milestoneIndex;
  const plan = state.plan.plan;
  if (milestoneIndex >= plan.milestones.length) {
    return Response.json({ error: "You've completed every milestone in this plan." }, { status: 409 });
  }
  // A session in progress is resumed, whichever kind it is: one at a time per plan.
  let questId: string | null = state.active ? (state.active.sideQuestId ?? null) : null;
  if (!state.active && typeof body?.sideQuestId === "string") {
    const quest = await loadSideQuest(userId, body.sideQuestId);
    if (!quest || quest.goalId !== resolved.goal.id || quest.status !== "active") {
      return Response.json({ error: "That side quest isn't under way." }, { status: 409 });
    }
    questId = quest.id;
  }
  const session = state.active ?? (await startSession(userId, state.plan.id, milestoneIndex, questId));
  const quest = session.sideQuestId ? await loadSideQuest(userId, session.sideQuestId) : undefined;
  const response: StartSessionResponse = {
    id: session.id,
    milestoneIndex: session.milestoneIndex,
    milestoneTitle: quest?.title ?? plan.milestones[session.milestoneIndex]!.title,
    sideQuest: quest ? { id: quest.id, sessionNumber: (await endedQuestSessions(quest.id)) + 1, sessions: quest.sessions } : null,
    // Numbered across the goal's plan versions: a reworked plan continues, it doesn't restart.
    sessionNumber: state.sessionsDone + 1,
    messages: session.messages,
  };
  return Response.json(response);
}

import { auth } from "@clerk/nextjs/server";

import { isDatabaseConfigured } from "@/db";
import { goalForRequest } from "@/lib/goals/request-goal";
import { loadSessionState } from "@/lib/specialists/session-state";
import { startSession } from "@/lib/specialists/store";

export interface StartSessionResponse {
  id: string;
  milestoneIndex: number;
  milestoneTitle: string;
  sessionNumber: number;
  /** The transcript so far, when resuming a session that's already running. */
  messages: unknown[];
}

/** Start the next tutoring session on a goal, or resume the one in progress. */
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
  const session = state.active ?? (await startSession(userId, state.plan.id, milestoneIndex));
  const response: StartSessionResponse = {
    id: session.id,
    milestoneIndex: session.milestoneIndex,
    milestoneTitle: plan.milestones[session.milestoneIndex]!.title,
    // Numbered across the goal's plan versions: a reworked plan continues, it doesn't restart.
    sessionNumber: state.sessionsDone + 1,
    messages: session.messages,
  };
  return Response.json(response);
}

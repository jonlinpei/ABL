import { auth } from "@clerk/nextjs/server";

import { isDatabaseConfigured } from "@/db";
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

/** Start the next tutoring session, or resume the one in progress. */
export async function POST() {
  const { userId } = await auth();
  if (!userId) return new Response("Unauthorized", { status: 401 });
  if (!isDatabaseConfigured()) return Response.json({ error: "No database is configured." }, { status: 503 });

  const state = await loadSessionState(userId);
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
    sessionNumber: state.history.length + 1,
    messages: session.messages,
  };
  return Response.json(response);
}

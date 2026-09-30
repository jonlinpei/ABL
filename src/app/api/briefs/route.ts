import { auth } from "@clerk/nextjs/server";

import { isDatabaseConfigured } from "@/db";
import { inngest } from "@/inngest/client";
import { briefConfirmed } from "@/inngest/events";
import { saveConfirmedBrief } from "@/lib/goals/brief-store";
import { goalForRequest } from "@/lib/goals/request-goal";
import { GoalBriefSchema } from "@/lib/goals/schema";

export interface SaveBriefResponse {
  id: string;
  version: number;
  goalId: string;
}

/**
 * Save the brief the learner just confirmed: a new goal, or with `goalId`,
 * the next version of that goal.
 */
export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return new Response("Unauthorized", { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = GoalBriefSchema.safeParse(body?.brief);
  if (!parsed.success) {
    return Response.json({ error: "Invalid career brief", issues: parsed.error.issues }, { status: 400 });
  }
  if (!isDatabaseConfigured()) {
    return Response.json(
      { error: "No database is configured, so the brief wasn't saved. Set DATABASE_URL in .env.local." },
      { status: 503 },
    );
  }

  let goalId: string | undefined;
  if (body?.goalId != null) {
    const resolved = await goalForRequest(userId, body.goalId);
    if ("error" in resolved) return resolved.error;
    goalId = resolved.goal.id;
  }

  try {
    const saved: SaveBriefResponse = await saveConfirmedBrief(userId, parsed.data, goalId);
    await startLifecycle(userId, saved);
    return Response.json(saved);
  } catch (err) {
    console.error("[briefs] save failed", err);
    return Response.json({ error: "Couldn't save your brief. Please try again." }, { status: 500 });
  }
}

/**
 * Start the specialists that follow discovery. The saved brief and its
 * `learner_events` row are the record, so if the job runner is unreachable the
 * learner's confirmation still stands; the event can be re-sent from the log.
 */
async function startLifecycle(userId: string, saved: SaveBriefResponse) {
  try {
    await inngest.send(briefConfirmed.create({ userId, briefId: saved.id, version: saved.version, goalId: saved.goalId }));
  } catch (err) {
    console.error("[briefs] couldn't start the learner lifecycle", err);
  }
}

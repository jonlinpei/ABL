import { auth } from "@clerk/nextjs/server";

import { isDatabaseConfigured } from "@/db";
import { listGoals, type GoalSummary } from "@/lib/goals/goal-store";

export interface GoalsResponse {
  goals: GoalSummary[];
}

/** Every goal the learner has, newest-opened first: active, paused, completed and recently removed. */
export async function GET() {
  const { userId } = await auth();
  if (!userId) return new Response("Unauthorized", { status: 401 });
  if (!isDatabaseConfigured()) return Response.json({ error: "No database is configured." }, { status: 503 });
  return Response.json({ goals: await listGoals(userId) } satisfies GoalsResponse);
}

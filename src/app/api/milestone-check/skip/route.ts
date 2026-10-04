import { auth } from "@clerk/nextjs/server";
import { z } from "zod";

import { isDatabaseConfigured } from "@/db";
import { goalForRequest } from "@/lib/goals/request-goal";
import { milestoneToCheck } from "@/lib/specialists/milestone-check";
import { loadMilestoneChecks, skipMilestoneCheck } from "@/lib/specialists/milestone-check-store";
import { loadSessionState } from "@/lib/specialists/session-state";

const Body = z.object({ goalId: z.string().optional() });

/** "Not now": the learner skips the check for the milestone they just finished. */
export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return new Response("Unauthorized", { status: 401 });
  if (!isDatabaseConfigured()) return Response.json({ error: "No database is configured." }, { status: 503 });
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return Response.json({ error: "Invalid request" }, { status: 400 });
  const resolved = await goalForRequest(userId, parsed.data.goalId);
  if ("error" in resolved) return resolved.error;
  const state = await loadSessionState(userId, resolved.goal.id);
  const handled = state ? new Set((await loadMilestoneChecks(state.plan.id)).map((c) => c.milestoneIndex)) : new Set<number>();
  const toCheck = state && milestoneToCheck(state.plan.plan, state.history, state.gap, handled);
  if (!state || !toCheck) return Response.json({ ok: true });
  await skipMilestoneCheck(userId, state.plan.id, toCheck.milestoneIndex);
  return Response.json({ ok: true });
}

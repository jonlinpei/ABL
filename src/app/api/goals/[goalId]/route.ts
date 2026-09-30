import { auth } from "@clerk/nextjs/server";
import { z } from "zod";

import { isDatabaseConfigured } from "@/db";
import { loadGoal, purgeGoal, setGoalStatus, touchGoal } from "@/lib/goals/goal-store";
import { GOAL_ACTIONS } from "@/lib/goals/lifecycle";

const Body = z.object({ action: z.enum(["open", ...GOAL_ACTIONS]) });

async function signedIn(ctx: RouteContext<"/api/goals/[goalId]">) {
  const { userId } = await auth();
  if (!userId) return { error: new Response("Unauthorized", { status: 401 }) };
  if (!isDatabaseConfigured()) return { error: Response.json({ error: "No database is configured." }, { status: 503 }) };
  const { goalId } = await ctx.params;
  if (!z.uuid().safeParse(goalId).success) return { error: Response.json({ error: "That goal wasn't found." }, { status: 404 }) };
  return { userId, goalId };
}

/**
 * Act on a goal: open it (it becomes the one the learner lands on), or
 * pause, resume, complete, reopen, remove or restore it.
 */
export async function POST(req: Request, ctx: RouteContext<"/api/goals/[goalId]">) {
  const s = await signedIn(ctx);
  if (s.error) return s.error;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid request" }, { status: 400 });

  if (parsed.data.action === "open") {
    const goal = await loadGoal(s.userId, s.goalId);
    if (!goal || goal.status === "removed") return Response.json({ error: "That goal wasn't found." }, { status: 404 });
    await touchGoal(s.userId, s.goalId);
    return Response.json({ ok: true });
  }
  const updated = await setGoalStatus(s.userId, s.goalId, parsed.data.action);
  if (!updated) return Response.json({ error: "That can't be done to this goal right now." }, { status: 409 });
  return Response.json({ ok: true, status: updated.status });
}

/**
 * Delete a removed goal now instead of in 30 days, with its plans, sessions
 * and everything built for it. Only a removed goal: removing is the first
 * step, so one tap can't delete a goal. The learner's skills stay.
 */
export async function DELETE(_req: Request, ctx: RouteContext<"/api/goals/[goalId]">) {
  const s = await signedIn(ctx);
  if (s.error) return s.error;
  const { purged } = await purgeGoal(s.userId, s.goalId);
  if (!purged) return Response.json({ error: "Only a removed goal can be deleted." }, { status: 409 });
  return Response.json({ deleted: true });
}

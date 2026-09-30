import { auth } from "@clerk/nextjs/server";
import { z } from "zod";

import { isDatabaseConfigured } from "@/db";
import { inngest } from "@/inngest/client";
import { replanRequested } from "@/inngest/events";
import { startHuddle } from "@/lib/specialists/huddle-store";
import { ReplanRequestSchema } from "@/lib/specialists/schemas";
import { goalForRequest } from "@/lib/goals/request-goal";
import { loadGoalState } from "@/lib/specialists/store";

const Body = z.object({ request: ReplanRequestSchema, goalId: z.string().optional() });

/** The learner asks to rework a goal's plan: open a huddle and start it. */
export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return new Response("Unauthorized", { status: 401 });
  if (!isDatabaseConfigured()) return Response.json({ error: "No database is configured." }, { status: 503 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid request", issues: parsed.error.issues }, { status: 400 });

  const resolved = await goalForRequest(userId, parsed.data.goalId, { learning: true });
  if ("error" in resolved) return resolved.error;
  const state = await loadGoalState(userId, resolved.goal.id);
  if (!state?.plan) return Response.json({ error: "You don't have a plan to rework yet." }, { status: 409 });
  // A goal change in progress gets its own proposal; reworking now would compete with it.
  if (state.pending) {
    return Response.json({ error: "Your updated goal's plan is still being prepared. You'll be able to compare it with this one shortly." }, { status: 409 });
  }
  const { id, created } = await startHuddle(userId, state.plan.id, parsed.data.request, "learner", "The learner asked to rework their plan.");
  if (created) {
    try {
      await inngest.send(replanRequested.create({ userId, huddleId: id }));
    } catch (err) {
      console.error("[replan] couldn't start the huddle", err);
      return Response.json({ error: "Couldn't start reworking your plan. Please try again." }, { status: 502 });
    }
  }
  return Response.json({ huddleId: id, created });
}

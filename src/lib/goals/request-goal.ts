import { z } from "zod";

import type { GoalRow } from "@/db/schema";

import { resolveGoal } from "./goal-store";
import { isLearnable } from "./lifecycle";

/**
 * The goal a request is about, from `?goalId=` or a body's `goalId`, falling
 * back to the learner's current goal. A named goal that isn't theirs (or was
 * removed) is a 404, not a fallback.
 */
export async function goalForRequest(
  userId: string,
  goalId: unknown,
  { learning = false }: { learning?: boolean } = {},
): Promise<{ goal: GoalRow } | { error: Response }> {
  const id = typeof goalId === "string" && goalId.length > 0 ? goalId : null;
  if (id && !z.uuid().safeParse(id).success) {
    return { error: Response.json({ error: "That goal wasn't found." }, { status: 404 }) };
  }
  const goal = await resolveGoal(userId, id);
  if (!goal) {
    return { error: Response.json({ error: id ? "That goal wasn't found." : "No goal yet." }, { status: id ? 404 : 409 }) };
  }
  if (learning && !isLearnable(goal.status)) {
    return { error: Response.json({ error: "Resume this goal first." }, { status: 409 }) };
  }
  return { goal };
}

/** `?goalId=` from a request URL. */
export function goalIdParam(req: Request): string | null {
  return new URL(req.url).searchParams.get("goalId");
}

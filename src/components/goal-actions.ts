import type { GoalAction } from "@/lib/goals/lifecycle";

/** Open, pause, resume, complete, reopen, remove or restore a goal. Throws with the server's message on failure. */
export async function goalAction(goalId: string, action: GoalAction | "open") {
  const res = await fetch(`/api/goals/${goalId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(data?.error ?? `Request failed (${res.status})`);
  }
}

/** Delete a removed goal now. */
export async function deleteGoalNow(goalId: string) {
  const res = await fetch(`/api/goals/${goalId}`, { method: "DELETE" });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(data?.error ?? `Request failed (${res.status})`);
  }
}

export const REMOVE_CONFIRM =
  "Remove this goal? Its plan and lessons will be deleted in 30 days, and you can restore it until then. What you learned stays in your skills.";

export const DELETE_NOW_CONFIRM =
  "Delete this goal now? Its plan, lessons and session history will be permanently deleted. This can't be undone. What you learned stays in your skills.";

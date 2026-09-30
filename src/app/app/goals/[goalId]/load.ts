import { auth } from "@clerk/nextjs/server";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";

import { isDatabaseConfigured } from "@/db";
import type { GoalStatus } from "@/db/schema";
import { loadGoal } from "@/lib/goals/goal-store";
import { loadGoalState } from "@/lib/specialists/store";

/** The signed-in learner's goal and its newest brief, or a 404 if it isn't theirs or was removed. */
export async function loadGoalPage(goalId: string) {
  if (!isDatabaseConfigured()) redirect("/app");
  if (!z.uuid().safeParse(goalId).success) notFound();
  const { userId } = await auth();
  const goal = await loadGoal(userId!, goalId);
  if (!goal || goal.status === "removed") notFound();
  const state = await loadGoalState(userId!, goalId);
  return { goal: { ...goal, status: goal.status as Exclude<GoalStatus, "removed"> }, brief: state?.brief.brief ?? null };
}

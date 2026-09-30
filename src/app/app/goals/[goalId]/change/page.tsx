import { redirect } from "next/navigation";

import { GoalDiscoveryDemo } from "@/components/goal-discovery-demo";

import { loadGoalPage } from "../load";

/** "Change this goal": discovery starting from the goal's brief, saved as its next version. */
export default async function ChangeGoalPage({ params }: PageProps<"/app/goals/[goalId]/change">) {
  const { goalId } = await params;
  const { goal, brief } = await loadGoalPage(goalId);
  // Only a goal being worked on changes; the others resume or reopen first.
  if (goal.status !== "active") redirect(`/app/goals/${goalId}`);
  return <GoalDiscoveryDemo goalId={goalId} currentTitle={brief?.target.role} />;
}

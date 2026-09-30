import { GoalView } from "@/components/goal-view";

import { loadGoalPage } from "./load";

export default async function GoalPage({ params }: PageProps<"/app/goals/[goalId]">) {
  const { goalId } = await params;
  const { goal, brief } = await loadGoalPage(goalId);
  return (
    <GoalView
      // Remount when the status changes, so the page starts fresh for it.
      key={goal.status}
      goal={{
        id: goal.id,
        status: goal.status,
        title: brief?.target.role ?? null,
        industry: brief?.target.industry ?? null,
        completedAt: goal.completedAt?.toISOString() ?? null,
      }}
    />
  );
}

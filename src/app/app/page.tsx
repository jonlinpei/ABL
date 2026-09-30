import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

import { GoalDiscoveryDemo } from "@/components/goal-discovery-demo";
import { GoalsHome } from "@/components/goals-home";
import { isDatabaseConfigured } from "@/db";
import { listGoals } from "@/lib/goals/goal-store";

/**
 * Home: discovery for a first goal, straight into the goal for a learner
 * with just one, and their goals otherwise (`?all=1` always shows them).
 */
export default async function AppHome({ searchParams }: PageProps<"/app">) {
  // Without a database the discovery demo still runs; nothing is saved.
  if (!isDatabaseConfigured()) return <GoalDiscoveryDemo />;
  const { userId } = await auth();
  const goals = await listGoals(userId!);
  if (goals.length === 0) return <GoalDiscoveryDemo />;
  const { all } = await searchParams;
  if (!all && goals.length === 1 && goals[0]!.status === "active") redirect(`/app/goals/${goals[0]!.id}`);
  return <GoalsHome goals={goals} />;
}

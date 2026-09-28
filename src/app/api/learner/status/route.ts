import { auth } from "@clerk/nextjs/server";

import { isDatabaseConfigured } from "@/db";
import { selectSkillsToCheck } from "@/lib/specialists/assessment";
import type { Gap, Plan } from "@/lib/specialists/schemas";
import { loadLatestBriefAndGap } from "@/lib/specialists/store";

export type LearnerStatus =
  | { stage: "no_brief" }
  | { stage: "building_gap" }
  | { stage: "ready_to_check"; skills: { skillId: string; name: string }[] }
  | { stage: "planning"; gap: Gap; assessed: boolean }
  | { stage: "plan_ready"; gap: Gap; assessed: boolean; plan: Plan };

/** Where the learner is after discovery, for the app to poll. */
export async function GET() {
  const { userId } = await auth();
  if (!userId) return new Response("Unauthorized", { status: 401 });
  if (!isDatabaseConfigured()) return Response.json({ error: "No database is configured." }, { status: 503 });

  const state = await loadLatestBriefAndGap(userId);
  let status: LearnerStatus;
  if (!state) status = { stage: "no_brief" };
  else if (!state.gap) status = { stage: "building_gap" };
  else {
    const skills = selectSkillsToCheck(state.gap.gap);
    const assessed = !!state.gap.assessedAt;
    if (!assessed && skills.length > 0) {
      status = { stage: "ready_to_check", skills: skills.map((s) => ({ skillId: s.skillId, name: s.name })) };
    } else if (!state.plan) {
      status = { stage: "planning", gap: state.gap.gap, assessed };
    } else {
      status = { stage: "plan_ready", gap: state.gap.gap, assessed, plan: state.plan.plan };
    }
  }
  return Response.json(status);
}

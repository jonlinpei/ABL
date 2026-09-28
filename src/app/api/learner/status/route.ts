import { auth } from "@clerk/nextjs/server";

import { isDatabaseConfigured } from "@/db";
import { selectSkillsToCheck } from "@/lib/specialists/assessment";
import type { Gap } from "@/lib/specialists/schemas";
import { loadLatestBriefAndGap } from "@/lib/specialists/store";

export type LearnerStatus =
  | { stage: "no_brief" }
  | { stage: "building_gap" }
  | { stage: "ready_to_check"; skills: { skillId: string; name: string }[] }
  | { stage: "gap_ready"; gap: Gap; assessed: boolean };

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
    status =
      !state.gap.assessedAt && skills.length > 0
        ? { stage: "ready_to_check", skills: skills.map((s) => ({ skillId: s.skillId, name: s.name })) }
        : { stage: "gap_ready", gap: state.gap.gap, assessed: !!state.gap.assessedAt };
  }
  return Response.json(status);
}

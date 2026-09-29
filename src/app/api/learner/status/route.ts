import { auth } from "@clerk/nextjs/server";

import { isDatabaseConfigured } from "@/db";
import { selectSkillsToCheck } from "@/lib/specialists/assessment";
import { openCheckIn } from "@/lib/specialists/coach-store";
import { openHuddle } from "@/lib/specialists/huddle-store";
import type { Gap, Plan, Replan, SessionReport } from "@/lib/specialists/schemas";
import { countEndedSessions, loadEarlierSessions, loadLatestBriefAndGap, loadSessions } from "@/lib/specialists/store";
import { currentMilestone } from "@/lib/specialists/tutor";

export type LearnerStatus =
  | { stage: "no_brief" }
  | { stage: "building_gap" }
  | { stage: "ready_to_check"; skills: { skillId: string; name: string }[] }
  | { stage: "planning"; gap: Gap; assessed: boolean }
  | { stage: "plan_ready"; gap: Gap; assessed: boolean; plan: Plan; progress: PlanProgress };

export interface PlanProgress {
  /** The milestone being worked on; equal to the milestone count when the plan is done. */
  milestoneIndex: number;
  sessionsDone: number;
  activeSessionId: string | null;
  lastReport: SessionReport | null;
  /** The coach's newest unanswered check-in, if any. */
  checkIn: { id: string; message: string; options: string[] } | null;
  /** A plan rework in progress, or waiting for the learner's decision. */
  replan: { huddleId: string; status: "running" } | { huddleId: string; status: "proposed"; proposal: Replan } | null;
}

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
      const [rows, note, open, sessionsDone] = await Promise.all([
        loadSessions(state.plan.id),
        openCheckIn(userId),
        openHuddle(userId),
        countEndedSessions(userId),
      ]);
      const history = rows
        .filter((r) => r.endedAt && r.report)
        .map((r) => ({ milestoneIndex: r.milestoneIndex, report: r.report!, endedAt: r.endedAt!.toISOString() }));
      status = {
        stage: "plan_ready",
        gap: state.gap.gap,
        assessed,
        plan: state.plan.plan,
        progress: {
          milestoneIndex: currentMilestone(state.plan.plan, history),
          // Counted across plan versions, so a reworked plan doesn't read as a fresh start.
          sessionsDone,
          activeSessionId: rows.find((r) => !r.endedAt)?.id ?? null,
          lastReport:
            history.at(-1)?.report ??
            (await loadEarlierSessions(userId, state.plan.id, 1)).at(-1)?.report ??
            null,
          checkIn: note?.message ? { id: note.id, message: note.message, options: note.options } : null,
          replan: !open
            ? null
            : open.huddle.status === "proposed" && open.proposed
              ? { huddleId: open.huddle.id, status: "proposed", proposal: open.proposed.plan as Replan }
              : { huddleId: open.huddle.id, status: "running" },
        },
      };
    }
  }
  return Response.json(status);
}

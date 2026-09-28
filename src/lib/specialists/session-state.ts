import { loadLatestBriefAndGap, loadSessions } from "./store";
import { currentMilestone, type PastSession } from "./tutor";

/**
 * Everything a tutoring session is built from: the learner's newest brief,
 * gap and plan, the plan's sessions, and which milestone they're on.
 * Undefined until a plan exists.
 */
export async function loadSessionState(userId: string) {
  const state = await loadLatestBriefAndGap(userId);
  if (!state?.gap || !state.plan) return undefined;
  const rows = await loadSessions(state.plan.id);
  const history: PastSession[] = rows
    .filter((r) => r.endedAt && r.report)
    .map((r) => ({ milestoneIndex: r.milestoneIndex, report: r.report!, endedAt: r.endedAt!.toISOString() }));
  const active = rows.find((r) => !r.endedAt);
  return {
    brief: state.brief,
    gap: state.gap.gap,
    plan: state.plan,
    history,
    active,
    milestoneIndex: currentMilestone(state.plan.plan, history),
  };
}

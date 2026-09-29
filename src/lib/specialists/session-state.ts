import { tutorNotesSince } from "./coach-store";
import { dueForReview } from "./mastery";
import { loadMastery } from "./mastery-store";
import { countEndedSessions, loadEarlierSessions, loadLatestBriefAndGap, loadSessions } from "./store";
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
  const milestoneIndex = currentMilestone(state.plan.plan, history);
  // Reviews worth a quick warm-up: due skills outside the current milestone,
  // which the session practises anyway. At most two, to keep it quick.
  const milestoneSkills = new Set(state.plan.plan.milestones[milestoneIndex]?.skills.map((s) => s.skillId));
  const dueReviews = dueForReview(await loadMastery(userId), new Date())
    .filter((r) => !milestoneSkills.has(r.skillId))
    .slice(0, 2);
  // A reworked plan starts its own history. Until it has one, the last
  // sessions on earlier plans carry homework and context across the change.
  const carried: PastSession[] =
    history.length === 0
      ? (await loadEarlierSessions(userId, state.plan.id)).map((r) => ({
          milestoneIndex: r.milestoneIndex,
          report: r.report!,
          endedAt: r.endedAt!.toISOString(),
        }))
      : [];
  const lastEnd = rows.filter((r) => r.endedAt).at(-1)?.endedAt ?? (carried.length ? new Date(carried.at(-1)!.endedAt) : null);
  // Notes the coach left for the tutor since the last session.
  const coachNotes = await tutorNotesSince(state.plan.id, lastEnd);
  const sessionsDone = await countEndedSessions(userId);
  return {
    brief: state.brief,
    gap: state.gap.gap,
    plan: state.plan,
    history,
    active,
    milestoneIndex,
    dueReviews,
    coachNotes,
    carried,
    sessionsDone,
  };
}

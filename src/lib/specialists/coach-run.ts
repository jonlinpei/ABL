import { coachContext, decide, mayCheckIn } from "./coach";
import { loadCoachNotes, saveCoachNote } from "./coach-store";
import { loadMastery } from "./mastery-store";
import { detectSignals } from "./signals";
import { loadLatestBriefAndGap, loadSessions } from "./store";
import { currentMilestone } from "./tutor";

/**
 * One coach check for a learner: detect signals in code, and only when there
 * are some (and no session is running), ask the coach what to do and save it.
 */
export async function runCoach(userId: string, now = new Date()) {
  const state = await loadLatestBriefAndGap(userId);
  if (!state?.plan) return { outcome: "no_plan" as const };
  const plan = state.plan.plan;
  const rows = await loadSessions(state.plan.id);
  if (rows.some((r) => !r.endedAt)) return { outcome: "session_in_progress" as const };

  const ended = rows.filter((r) => r.endedAt && r.report);
  const history = ended.map((r) => ({ milestoneIndex: r.milestoneIndex, report: r.report!, endedAt: r.endedAt!.toISOString() }));
  const milestoneIndex = currentMilestone(plan, history);
  const signals = detectSignals({
    plan,
    planStartedAt: state.plan.createdAt,
    sessions: rows.map((r) => ({ milestoneIndex: r.milestoneIndex, endedAt: r.endedAt, report: r.report })),
    mastery: await loadMastery(userId),
    milestoneIndex,
    now,
  });
  if (signals.length === 0) return { outcome: "on_track" as const };

  const notes = await loadCoachNotes(state.plan.id);
  const lastCheckIn = notes.filter((n) => n.message).at(-1)?.createdAt ?? null;
  const lastSessionEnd = ended.at(-1)?.endedAt ?? null;
  const allowCheckIn = mayCheckIn(lastCheckIn, lastSessionEnd, now);
  // Nothing new to say: a tutor note is already waiting and check-ins are paused.
  const pendingTutorNote = notes.some((n) => n.tutorNote && (!lastSessionEnd || n.createdAt > lastSessionEnd));
  if (!allowCheckIn && pendingTutorNote) return { outcome: "already_noted" as const, signals };

  const decision = await decide(
    coachContext({
      brief: state.brief.brief,
      plan,
      milestoneIndex,
      signals,
      recentSessions: ended.map((r) => ({ endedAt: r.endedAt!, report: r.report! })),
      notes: notes.map((n) => ({ createdAt: n.createdAt, message: n.message, response: n.response })),
      allowCheckIn,
      today: now.toISOString().slice(0, 10),
    }),
    allowCheckIn,
    userId,
  );
  if (!decision.message && !decision.tutorNote && !decision.suggestReplan) {
    return { outcome: "no_action" as const, signals, reason: decision.reason };
  }
  const { id } = await saveCoachNote(userId, state.plan.id, signals, decision);
  return { outcome: "noted" as const, noteId: id, signals, checkIn: !!decision.message, tutorNote: !!decision.tutorNote };
}

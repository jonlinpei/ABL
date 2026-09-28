import type { MasteryRecord } from "./mastery";
import type { Plan, SessionReport } from "./schemas";

const DAY = 86_400_000;

/** A session as the signal detectors need it. */
export interface SessionFact {
  milestoneIndex: number;
  endedAt: Date | null;
  report: SessionReport | null;
}

/** Something the coach should know about. Detected in code, so it's cheap and explainable. */
export type Signal =
  | { kind: "missed_sessions"; daysSinceLast: number; expectedPerWeek: number; lapsed: boolean }
  | {
      kind: "behind_pace";
      sessionsPerWeek: number;
      expectedPerWeek: number;
      /** Finish date at the recent pace; null when the pace is under a quarter of the plan's, where a date would be meaningless. */
      projectedFinish: string | null;
      plannedFinish: string;
    }
  | { kind: "stuck_topic"; skillId: string; name: string; sessionsOnMilestone: number; level: number; toLevel: number };

/** Sessions a week the plan assumes: weekly hours over session length. */
export function expectedSessionsPerWeek(plan: Plan): number {
  return Math.max(1, Math.round((plan.weeklyHours * 60) / plan.sessionMinutes));
}

/**
 * Signals for the coach, from the plan, its sessions and the learner's
 * mastery. Nothing here calls a model.
 *
 * - missed_sessions: no session for 5+ days and at least two expected
 *   sessions missed; lapsed after 14 days.
 * - behind_pace: over the last 3 weeks (at least 2 since the plan started),
 *   under 60% of the planned sessions. Includes the finish date at the
 *   actual pace next to the planned one, when the pace is steady enough
 *   (a quarter of the plan's or more) for a date to mean something.
 * - stuck_topic: 3+ sessions on the current milestone and one of its skills
 *   hasn't risen across its last 3 pieces of evidence, still short of the
 *   level the milestone needs.
 */
export function detectSignals({
  plan,
  planStartedAt,
  sessions,
  mastery,
  milestoneIndex,
  now,
}: {
  plan: Plan;
  planStartedAt: Date;
  sessions: SessionFact[];
  mastery: MasteryRecord[];
  milestoneIndex: number;
  now: Date;
}): Signal[] {
  const signals: Signal[] = [];
  const done = sessions.filter((s) => s.endedAt).sort((a, b) => a.endedAt!.getTime() - b.endedAt!.getTime());
  if (milestoneIndex >= plan.milestones.length) return signals;
  const expectedPerWeek = expectedSessionsPerWeek(plan);

  // Missed sessions: measured from the last session, or the plan's start.
  const lastActivity = done.at(-1)?.endedAt ?? planStartedAt;
  const daysSinceLast = Math.floor((now.getTime() - lastActivity.getTime()) / DAY);
  const expectedGapDays = 7 / expectedPerWeek;
  if (daysSinceLast >= 5 && daysSinceLast >= 2 * expectedGapDays) {
    signals.push({ kind: "missed_sessions", daysSinceLast, expectedPerWeek, lapsed: daysSinceLast >= 14 });
  }

  // Pace over the last three weeks, once there's two weeks of history.
  const daysActive = (now.getTime() - planStartedAt.getTime()) / DAY;
  if (daysActive >= 14) {
    const windowDays = Math.min(21, daysActive);
    const recent = done.filter((s) => now.getTime() - s.endedAt!.getTime() <= windowDays * DAY).length;
    const sessionsPerWeek = Math.round(((recent * 7) / windowDays) * 10) / 10;
    if (sessionsPerWeek < 0.6 * expectedPerWeek) {
      const remainingWeeks = plan.milestones.slice(milestoneIndex).reduce((n, m) => n + m.weeks, 0);
      const ratio = sessionsPerWeek / expectedPerWeek;
      signals.push({
        kind: "behind_pace",
        sessionsPerWeek,
        expectedPerWeek,
        // One session in three weeks would "project" years out; that's noise, not a forecast.
        projectedFinish: ratio >= 0.25 ? isoDate(now.getTime() + (remainingWeeks / ratio) * 7 * DAY) : null,
        plannedFinish: isoDate(now.getTime() + remainingWeeks * 7 * DAY),
      });
    }
  }

  // A topic that isn't sticking.
  const milestone = plan.milestones[milestoneIndex]!;
  const onMilestone = done.filter((s) => s.milestoneIndex === milestoneIndex).length;
  if (onMilestone >= 3) {
    const byId = new Map(mastery.map((m) => [m.skillId, m]));
    for (const target of milestone.skills) {
      const m = byId.get(target.skillId);
      const recent = m?.evidence.filter((e) => e.source === "session").slice(-3) ?? [];
      if (!m || recent.length < 3 || m.level >= target.toLevel) continue;
      const rose = recent.at(-1)!.level > recent[0]!.level;
      if (!rose) {
        signals.push({
          kind: "stuck_topic",
          skillId: m.skillId,
          name: m.name,
          sessionsOnMilestone: onMilestone,
          level: m.level,
          toLevel: target.toLevel,
        });
      }
    }
  }
  return signals;
}

function isoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

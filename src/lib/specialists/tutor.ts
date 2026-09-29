import { z } from "zod";

import type { GoalBrief } from "@/lib/goals/schema";

import type { MasteryRecord } from "./mastery";
import { GlossaryEntry, SessionReport, type Gap, type Plan } from "./schemas";

/** One past session, as the tutor needs to see it. */
export interface PastSession {
  milestoneIndex: number;
  report: SessionReport;
  endedAt: string;
}

/**
 * The milestone to work on: the first one no session has completed. Past the
 * last milestone the plan is done.
 */
export function currentMilestone(plan: Plan, history: PastSession[]): number {
  const done = new Set(history.filter((s) => s.report.milestoneComplete).map((s) => s.milestoneIndex));
  const next = plan.milestones.findIndex((_, i) => !done.has(i));
  return next === -1 ? plan.milestones.length : next;
}

/** Everything the tutor needs for this session: the learner, the milestone, and what happened before. */
export function tutorContext({
  brief,
  gap,
  plan,
  history,
  milestoneIndex,
  dueReviews = [],
  coachNotes = [],
  carried = [],
}: {
  brief: GoalBrief;
  gap: Gap;
  plan: Plan;
  history: PastSession[];
  milestoneIndex: number;
  dueReviews?: MasteryRecord[];
  coachNotes?: string[];
  /** Sessions on earlier plan versions, when this plan has none of its own yet. */
  carried?: PastSession[];
}): string {
  const m = plan.milestones[milestoneIndex]!;
  const byId = new Map(gap.items.map((i) => [i.skillId, i]));
  const skills = m.skills
    .map((s) => {
      const g = byId.get(s.skillId);
      const check = g?.verify && g.basis === "self_reported" ? " Their own estimate, so check it early with one quick question." : "";
      return `- ${s.skillId}: ${g?.name ?? s.skillId}. Now ${g?.current ?? "?"} (${g?.basis.replace("_", " ") ?? "unknown"}); this milestone takes it to ${s.toLevel}.${check}`;
    })
    .join("\n");
  // Past sessions on this plan, or, right after a replan, on the plan before it.
  const past = history.length > 0 ? history : carried;
  const first = past.length === 0;
  const continuingAfterReplan = history.length === 0 && carried.length > 0;
  const last = past.at(-1);
  const recent = past
    .slice(-3)
    .map((s) => `- ${s.endedAt.slice(0, 10)}: ${s.report.summary}`)
    .join("\n");
  const changes = "whatChanged" in plan ? (plan as { whatChanged: { change: string; because: string }[] }).whatChanged : [];
  return `## The learner
${brief.current.role} (${brief.current.industry}) moving to ${brief.target.role}. ${brief.current.work}
Interests: ${brief.interests.join(", ") || "none listed"}. Tried before: ${brief.pastAttempts ?? "nothing"}.

## Where they are in the plan: "${plan.title}"
Milestone ${milestoneIndex + 1} of ${plan.milestones.length}: ${m.title}
- Why it matters: ${m.whyItMatters}
- Topics: ${m.topics.join("; ")}
- Visible win that completes it: ${m.visibleWin}
${m.project ? `- Project it builds: ${m.project}` : ""}
Skills this milestone works on:
${skills || "- None listed."}

## This session
${
  first
    ? `This is their first session. Teach the plan's first session: "${plan.firstSession.title}". ${plan.firstSession.whatYouWillDo} They should come away with: ${plan.firstSession.outcome}`
    : continuingAfterReplan
      ? `They're continuing after reworking their plan: this is the first session of the reworked plan, not their first session. Acknowledge the change in a sentence, then teach its first session: "${plan.firstSession.title}". ${plan.firstSession.whatYouWillDo} They should come away with: ${plan.firstSession.outcome}${
          changes.length ? `\nWhat changed in their plan: ${changes.map((c) => `${c.change} (${c.because})`).join("; ")}` : ""
        }`
      : `Session ${history.length + 1} on this plan. Pick up from where the last one ended and move toward the milestone's visible win.`
}
${last?.report.homework ? `\nLast session's homework was: "${last.report.homework.task}" Open by asking how it went.` : ""}
${
  dueReviews.length
    ? `\n## Due for a quick review\n${dueReviews
        .map((r) => `- ${r.skillId}: ${r.name}. Last shown at level ${r.level}: ${r.evidence.at(-1)?.evidence ?? ""}`)
        .join("\n")}\nAfter the homework check, ask one short question on one of these (two minutes at most), then move on. Record what it showed in the evidence.`
    : ""
}
${coachNotes.length ? `\n## Note from the coach\n${coachNotes.map((n) => `- ${n}`).join("\n")}\nUse it quietly: change how you teach; don't mention the note to the learner.` : ""}
${recent ? `\n## Recent sessions\n${recent}` : ""}

Sessions are ${plan.sessionMinutes} minutes. Each learner message ends with the session clock.`;
}

/**
 * The session clock, added to the newest learner message rather than the
 * instructions: the instructions stay identical every turn, so the whole
 * conversation before this message can be served from the prompt cache.
 */
export function sessionClock(elapsedMinutes: number, sessionMinutes: number): string {
  const wrap =
    elapsedMinutes >= sessionMinutes
      ? " Time is up: close the session now."
      : elapsedMinutes >= sessionMinutes - 5
        ? " Start wrapping up."
        : "";
  return `[Session clock: ${elapsedMinutes} of ${sessionMinutes} minutes.${wrap}]`;
}

/**
 * Input schema for `end_session`: the report, with evidence limited to the
 * milestone's skills. Levels are plain numbers (strict tool mode rejects
 * min/max), clamped by `normalizeReport`.
 */
export function endSessionSchema(skillIds: string[]) {
  const evidenceItem = SessionReport.shape.evidence.element;
  return SessionReport.extend({
    evidence: z
      .array(
        skillIds.length > 0
          ? evidenceItem.extend({ skillId: z.enum(skillIds as [string, ...string[]]) })
          : evidenceItem,
      )
      .describe("Only skills they actually practised this session."),
    terms: z
      .array(GlossaryEntry)
      .describe("Up to 5 key terms you introduced or explained this session, for their glossary. Empty if none."),
  });
}

/** Terms kept per session, so the glossary gets the key ones, not every word. */
const MAX_SESSION_TERMS = 5;

/** Clamp levels to 0 to 4 and keep one evidence entry per skill (the last). */
export function normalizeReport(report: SessionReport): SessionReport {
  const bySkill = new Map(report.evidence.map((e) => [e.skillId, e]));
  return {
    ...report,
    evidence: [...bySkill.values()].map((e) => ({
      ...e,
      level: Math.min(4, Math.max(0, Math.round(e.level))),
    })),
    homework: report.homework
      ? { ...report.homework, minutes: Math.max(1, Math.round(report.homework.minutes)) }
      : null,
    terms: [...new Map((report.terms ?? []).filter((t) => t.term.trim() && t.definition.trim()).map((t) => [t.term.trim().toLowerCase(), t])).values()].slice(
      0,
      MAX_SESSION_TERMS,
    ),
  };
}

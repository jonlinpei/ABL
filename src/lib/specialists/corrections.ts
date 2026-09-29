import type { GoalBrief, InferableField } from "@/lib/goals/schema";

import { finishGap, scoreItem } from "./gap";
import { MAX_EVIDENCE, type EvidenceEntry, type MasteryRecord } from "./mastery";
import type { Gap, Plan } from "./schemas";

/**
 * Brief fields a learner can change in place. They shape how ABL teaches and
 * coaches, not the goal or the plan's size, so no replan is needed. Hours,
 * session length and deadline go through a replan; the target and current
 * role go through a new goal.
 */
export const EDITABLE_BRIEF_FIELDS = [
  "interests",
  "priority",
  "preferredTimes",
  "motivation",
  "successLooksLike",
  "pastAttempts",
  "strengths",
] as const;
export type EditableBriefField = (typeof EDITABLE_BRIEF_FIELDS)[number];
export type BriefDetails = Partial<Pick<GoalBrief, Exclude<EditableBriefField, "strengths">> & { strengths: string[] }>;

/** The brief with the learner's edits, and those fields no longer marked as guesses. */
export function editBrief(brief: GoalBrief, details: BriefDetails): GoalBrief {
  const { strengths, ...top } = details;
  const edited = new Set<string>(Object.keys(details));
  return {
    ...brief,
    ...top,
    current: strengths ? { ...brief.current, strengths } : brief.current,
    inferred: brief.inferred.filter((f: InferableField) => !edited.has(f)),
  };
}

/**
 * The gap with the learner's own level for one skill. It's marked
 * self-reported, so the tutor confirms it early (`verify`), and session
 * evidence corrects it either way. Null if the skill isn't in the gap.
 */
export function correctGap(gap: Gap, skillId: string, level: number): Gap | null {
  if (!gap.items.some((i) => i.skillId === skillId)) return null;
  const items = gap.items.map((i) => (i.skillId === skillId ? scoreItem({ ...i, current: level, basis: "self_reported" }) : i));
  return finishGap(items, gap.credentials, gap.proofOfSkill);
}

/**
 * The mastery record with the learner's level, so the next session's update
 * starts from it instead of overwriting it. The review schedule is unchanged.
 */
export function correctMastery(record: MasteryRecord, level: number, note: string | null, now: Date): MasteryRecord {
  const entry: EvidenceEntry = {
    level,
    evidence: note ? `The learner says: ${note}` : "The learner corrected their level.",
    source: "learner",
    at: now.toISOString(),
  };
  return { ...record, level, evidence: [...record.evidence, entry].slice(-MAX_EVIDENCE) };
}

/**
 * Whether a correction means the plan no longer matches the learner: an
 * upcoming milestone teaches what they now say they know, or a finished one
 * assumed more than they now say they have.
 */
export function planAffected(plan: Plan, milestoneIndex: number, skillId: string, level: number): boolean {
  return plan.milestones.some((m, i) =>
    m.skills.some((s) => s.skillId === skillId && (i >= milestoneIndex ? level >= s.toLevel : level < s.toLevel)),
  );
}

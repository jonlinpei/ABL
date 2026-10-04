import type { GoalBrief } from "@/lib/goals/schema";

import type { AssessedSkill, Gap, Plan } from "./schemas";
import type { PastSession } from "./tutor";

/** A milestone's skills, as the check needs them. */
export interface CheckSkill {
  skillId: string;
  name: string;
  /** Their level now, before the check. */
  current: number;
  /** The level the milestone set out to reach. */
  toLevel: number;
}

export interface MilestoneToCheck {
  milestoneIndex: number;
  title: string;
  skills: CheckSkill[];
}

/**
 * The milestone to offer a check for: the one the learner's latest session
 * just completed, if it has skills and they haven't taken or skipped its
 * check yet. Older milestones aren't offered again, so the offer never piles up.
 */
export function milestoneToCheck(plan: Plan, history: PastSession[], gap: Gap | null, handled: Set<number>): MilestoneToCheck | null {
  const last = history.at(-1);
  if (!last?.report.milestoneComplete) return null;
  const index = last.milestoneIndex;
  const milestone = plan.milestones[index];
  if (!milestone || handled.has(index) || milestone.skills.length === 0) return null;
  const byId = new Map(gap?.items.map((i) => [i.skillId, i]));
  return {
    milestoneIndex: index,
    title: milestone.title,
    skills: milestone.skills.slice(0, 5).map((s) => ({
      skillId: s.skillId,
      name: byId.get(s.skillId)?.name ?? s.skillId,
      current: byId.get(s.skillId)?.current ?? 0,
      toLevel: s.toLevel,
    })),
  };
}

/** What the Assessor needs for a milestone check: what they finished, and the skills to show. */
export function milestoneCheckContext(brief: GoalBrief, milestone: Plan["milestones"][number], skills: CheckSkill[]): string {
  return `## This learner

${brief.current.role} moving to ${brief.target.role} (${brief.target.industry}). Interests: ${brief.interests.join(", ") || "not listed"}.

## This is a milestone check

They just finished the milestone "${milestone.title}" (${milestone.visibleWin}). Topics: ${milestone.topics.join("; ")}.

## Skills to check, in this order

${skills.map((s) => `- ${s.skillId}: ${s.name}. Before this milestone: ${s.current}; the milestone aimed for ${s.toLevel}.`).join("\n")}`;
}

/** Each checked skill's level before the check and what it showed. */
export function beforeAndAfter(before: { skillId: string; level: number }[], results: AssessedSkill[], skills: { skillId: string; name: string; toLevel: number }[]) {
  return results.map((r) => {
    const s = skills.find((k) => k.skillId === r.skillId);
    return {
      skillId: r.skillId,
      name: s?.name ?? r.skillId,
      before: before.find((b) => b.skillId === r.skillId)?.level ?? 0,
      after: r.level,
      toLevel: s?.toLevel ?? r.level,
    };
  });
}

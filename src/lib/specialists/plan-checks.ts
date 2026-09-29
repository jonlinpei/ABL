import type { GoalBrief } from "@/lib/goals/schema";

import type { Gap, Plan, PlanReview } from "./schemas";

/**
 * The hard rules every plan must pass, checked in code rather than trusted
 * to a model: it fits the learner's real week, closes every must-have, and
 * doesn't spend time on what they already know.
 */
export function checkPlan(plan: Plan, gap: Gap, brief: GoalBrief): PlanReview["issues"] {
  const issues: PlanReview["issues"] = [];
  const must = (issue: string, fix: string) => issues.push({ severity: "must_fix", issue, fix });
  const should = (issue: string, fix: string) => issues.push({ severity: "should_fix", issue, fix });
  const byId = new Map(gap.items.map((i) => [i.skillId, i]));

  if (plan.weeklyHours > brief.weeklyHours) {
    must(
      `Plans ${plan.weeklyHours} h/week; the learner has ${brief.weeklyHours}.`,
      `Plan for at most ${brief.weeklyHours} hours a week and stretch the timeline instead.`,
    );
  }
  if (plan.sessionMinutes > brief.sessionMinutes || plan.firstSession.minutes > brief.sessionMinutes) {
    must(
      `Sessions run longer than the learner's ${brief.sessionMinutes} minutes.`,
      `Keep sessions, including the first, to ${brief.sessionMinutes} minutes or less.`,
    );
  }
  if (plan.milestones.length < 3 || plan.milestones.length > 8) {
    should(`${plan.milestones.length} milestones.`, "Use 3 to 8 milestones.");
  }

  // Highest level each skill reaches anywhere in the plan.
  const reached = new Map<string, number>();
  for (const m of plan.milestones) {
    for (const s of m.skills) {
      if (!byId.has(s.skillId)) {
        must(`Milestone "${m.title}" targets unknown skill "${s.skillId}".`, "Use only skill ids from the gap.");
        continue;
      }
      reached.set(s.skillId, Math.max(reached.get(s.skillId) ?? 0, s.toLevel));
    }
  }
  const leftOut = new Set(plan.notCovered.map((n) => n.skillId));

  for (const item of gap.items) {
    const to = reached.get(item.skillId);
    if (item.status === "met") {
      if (to !== undefined && to <= item.current) {
        should(
          `"${item.name}" is already at the needed level but the plan teaches it.`,
          "Drop it, or only touch it where it serves another skill.",
        );
      }
      continue;
    }
    if (item.importance !== "must") continue;
    if (leftOut.has(item.skillId)) {
      must(
        `Must-have "${item.name}" is left out of the plan.`,
        "Must-haves can't be left out; include it, at a smaller scope if time is short.",
      );
    } else if (to === undefined) {
      must(`Must-have "${item.name}" is never taught.`, `Add it to a milestone, up to level ${item.required}.`);
    } else if (to < item.required) {
      must(
        `Must-have "${item.name}" only reaches level ${to}; the target needs ${item.required}.`,
        `Bring it to level ${item.required}.`,
      );
    }
  }
  return issues;
}

/** Total weeks, derived from the milestones so it can't disagree with them. */
export function totalWeeks(plan: Plan): number {
  return plan.milestones.reduce((n, m) => n + m.weeks, 0);
}

/**
 * A replan must keep the remaining work honest. Fewer hours a week means
 * more weeks; the total only shrinks if scope is cut in the open (more
 * skills in notCovered). A quiet cut would make a missed deadline look fine.
 */
export function checkReplanWorkload(current: Plan, milestoneIndex: number, replan: Plan): PlanReview["issues"] {
  const before = current.milestones.slice(milestoneIndex).reduce((n, m) => n + m.weeks, 0) * current.weeklyHours;
  const after = totalWeeks(replan) * replan.weeklyHours;
  if (before === 0 || after >= 0.8 * before) return [];
  const cutInTheOpen = replan.notCovered.length > current.notCovered.length;
  const message = `The remaining work drops from about ${Math.round(before)} hours to ${Math.round(after)} (${totalWeeks(replan)} weeks at ${replan.weeklyHours} h/week).`;
  return [
    cutInTheOpen
      ? { severity: "should_fix", issue: `${message} Make sure whatChanged says what was cut.`, fix: "Name the scope cut in whatChanged." }
      : {
          severity: "must_fix",
          issue: `${message} Nothing was cut, so the same work is being promised in less time.`,
          fix: `Keep the work and extend the timeline to about ${Math.ceil(before / replan.weeklyHours)} weeks, updating deadlineFit honestly, or cut scope openly in notCovered and whatChanged.`,
        },
  ];
}

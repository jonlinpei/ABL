import type { Plan, ReplanRequest } from "@/lib/specialists/schemas";

import type { GoalBrief } from "./schema";

/**
 * What a new version of a goal's brief changes, and so what it needs:
 * - `rebuild`: where they're going or where they're starting from changed
 *   (role, market or industry), so the requirements, profile and plan are
 *   rebuilt, with a skills check if needed;
 * - `replan`: the target is the same but the plan's shape changed (their
 *   week, deadline, priority or what success means), so the current plan is
 *   reworked, keeping their progress;
 * - `details`: nothing the plan depends on (interests, motivation and the
 *   like), so the brief updates and the plan stays.
 */
export type GoalChange = "rebuild" | "replan" | "details";

const norm = (s: string | null | undefined) => (s ?? "").toLowerCase().replace(/\s+/g, " ").trim();

const POSITION = ["role", "market", "industry"] as const;
const PLAN_FIELDS = ["weeklyHours", "sessionMinutes", "deadline", "priority", "restatedGoal", "successLooksLike", "startingPoint"] as const;

export function classifyGoalChange(before: GoalBrief, after: GoalBrief): GoalChange {
  const moved = POSITION.some((k) => norm(before.target[k]) !== norm(after.target[k]) || norm(before.current[k]) !== norm(after.current[k]));
  if (moved) return "rebuild";
  return changedPlanFields(before, after).length > 0 ? "replan" : "details";
}

/** Plan-shaping fields that differ between two versions. */
export function changedPlanFields(before: GoalBrief, after: GoalBrief): (typeof PLAN_FIELDS)[number][] {
  return PLAN_FIELDS.filter((k) => norm(String(before[k] ?? "")) !== norm(String(after[k] ?? "")));
}

const FIELD_LABEL: Record<(typeof PLAN_FIELDS)[number], string> = {
  weeklyHours: "weekly hours",
  sessionMinutes: "session length",
  deadline: "deadline",
  priority: "priority",
  restatedGoal: "goal",
  successLooksLike: "what success looks like",
  startingPoint: "starting point",
};

/** The rework request for a same-target change: the new week and deadline, and a note on what else changed. */
export function replanRequestFor(before: GoalBrief, after: GoalBrief): { request: ReplanRequest; reason: string } {
  const changed = changedPlanFields(before, after);
  const others = changed.filter((k) => !["weeklyHours", "sessionMinutes", "deadline"].includes(k));
  const notes = others.map((k) => `${FIELD_LABEL[k]}: now "${after[k]}"`);
  return {
    request: {
      weeklyHours: changed.includes("weeklyHours") ? after.weeklyHours : null,
      sessionMinutes: changed.includes("sessionMinutes") ? after.sessionMinutes : null,
      deadline: changed.includes("deadline") ? after.deadline : null,
      note: notes.length ? `I updated my goal. ${notes.join("; ")}.` : null,
    },
    reason: `The learner updated their goal (${changed.map((k) => FIELD_LABEL[k]).join(", ")}).`,
  };
}

const weeks = (p: Plan) => p.milestones.reduce((n, m) => n + m.weeks, 0);
const where = (t: GoalBrief["target"]) => [t.role, t.industry].filter(Boolean).join(", ");

/** One line on a rebuilt version's plan, for the learner to read before choosing. */
export function rebuildSummary(before: GoalBrief, after: GoalBrief, current: Plan, proposed: Plan): string {
  const aim =
    norm(where(before.target)) !== norm(where(after.target))
      ? `Aimed at ${where(after.target)} instead of ${where(before.target)}`
      : norm(before.current.role) !== norm(after.current.role)
        ? `Rebuilt from your new starting point as ${after.current.role}`
        : `Rebuilt for ${after.target.market}`;
  return `${aim}: ${proposed.milestones.length} milestones over about ${weeks(proposed)} weeks at ${proposed.weeklyHours} h/week (now ${current.milestones.length} over ${weeks(current)}).`;
}

import { GOAL_CLARIFICATION_SKILL } from "./goal-clarification.generated";
import type { GoalBrief } from "./schema";

/**
 * Goal discovery is driven by the goal-clarification skill
 * (skills/goal-clarification/SKILL.md), the single source of truth shared by
 * the app and Claude. Edit the skill, not this file.
 */
export const DISCOVERY_SYSTEM_PROMPT = GOAL_CLARIFICATION_SKILL;

export const ROADMAP_SYSTEM_PROMPT = `You are ABL's planner. You turn a learner's confirmed goal brief into a first learning roadmap.

Hard rules:
- Weekly load must not exceed the learner's weeklyHours, and the first session must not exceed their sessionMinutes. Their real life is the constraint, not the ideal curriculum.
- Skip what their starting point already covers, and list it in skippedAsKnown so they can undo it.
- 3 to 6 milestones. Each has one sentence tying it to their goal, and a small, concrete visible win.
- Weight toward their priority: speed (shortest credible path), depth (fuller understanding), practical (applied tasks first).
- Use their interests and work context in milestone framing and the first session where it helps.
- Where the brief is unclear, make a sensible assumption and list it in assumptions.
- If the goal leads to a credential with required courses or supervised hours, ABL complements that coursework and does not replace it. Where a mistake could cause harm, include the qualified professional or course the brief calls for.
- Where practice has to happen away from the screen (an instrument, a sport), plan it with what the learner said they have access to.
- Plain language. No jargon without a short definition.`;

export function roadmapPrompt(brief: GoalBrief, today: string): string {
  return `Today is ${today}.

Confirmed goal brief (JSON):
${JSON.stringify(brief, null, 2)}

Write the roadmap.`;
}

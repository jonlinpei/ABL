import { GOAL_CLARIFICATION_SKILL } from "./goal-clarification.generated";

/**
 * Goal discovery is driven by the goal-clarification skill
 * (skills/goal-clarification/SKILL.md), the single source of truth shared by
 * the app and Claude. Edit the skill, not this file.
 */
export const DISCOVERY_SYSTEM_PROMPT = GOAL_CLARIFICATION_SKILL;

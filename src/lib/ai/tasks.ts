import type { Tier } from "./models";

/**
 * Every AI call in the app is one of these task types. Code asks the router
 * for a model by task, never by model ID.
 */
export const TASK_TYPES = [
  "sidekick_answer",
  "glossary_define",
  "goal_clarify",
  "goal_discover",
  "roadmap_generate",
  "replan",
  "assessment_grade",
  "gap_detect",
] as const;
export type TaskType = (typeof TASK_TYPES)[number];

export interface TaskRequirements {
  structuredOutput?: boolean;
  toolUse?: boolean;
  /** Minimum input tokens the model must accept. */
  minContextWindow?: number;
}

export interface TaskRoute {
  /** Tier tried first. */
  tier: Tier;
  /** Hard requirements. Models that miss any are never used for the task. */
  requires: TaskRequirements;
  /**
   * Tiers tried after `tier`, in order, if no model in the earlier tiers is
   * eligible or if a call fails at runtime.
   */
  fallback: readonly Tier[];
  /** Why the task routes this way. Kept next to the config so it stays honest. */
  rationale: string;
}

export const TASK_ROUTES: Readonly<Record<TaskType, TaskRoute>> = {
  sidekick_answer: {
    tier: "fast",
    requires: { minContextWindow: 64_000 },
    fallback: ["standard"],
    rationale:
      "Interactive side panel (PRD F3). Latency matters most; free-form text answer.",
  },
  glossary_define: {
    tier: "fast",
    requires: { structuredOutput: true },
    fallback: ["standard"],
    rationale: "Short plain-English definition in a fixed shape (PRD F6).",
  },
  goal_clarify: {
    tier: "standard",
    requires: { structuredOutput: true },
    fallback: ["deep", "fast"],
    rationale:
      "Restate the goal and ask up to 3 clarifying questions (PRD story 1). Needs judgement, not depth.",
  },
  goal_discover: {
    tier: "standard",
    requires: { toolUse: true },
    fallback: ["deep"],
    rationale:
      "Conversational goal discovery that ends in a goal brief the learner confirms (docs/content.md). Emits the brief as a tool call. Tone and judgement matter; no fast-tier fallback.",
  },
  roadmap_generate: {
    tier: "deep",
    requires: { structuredOutput: true, toolUse: true, minContextWindow: 200_000 },
    fallback: ["standard"],
    rationale:
      "Full plan from goal, assessment and time budget (PRD F1). Highest-stakes output; may call tools to look up content.",
  },
  replan: {
    tier: "standard",
    requires: { structuredOutput: true, minContextWindow: 128_000 },
    fallback: ["deep"],
    rationale:
      "Adjust an existing plan after missed sessions (PRD F7). Bounded edit of a known structure.",
  },
  assessment_grade: {
    tier: "standard",
    requires: { structuredOutput: true },
    fallback: ["deep"],
    rationale:
      "Grade answers into mastery signals (PRD story 2). Wrong grades corrupt the mastery graph, so no fast-tier fallback.",
  },
  gap_detect: {
    tier: "fast",
    requires: { structuredOutput: true },
    fallback: ["standard"],
    rationale:
      "Classify whether a sidekick question reveals a knowledge gap (PRD story 7). High volume, simple label.",
  },
};

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
  "profile_extract",
  "requirements_research",
  "requirements_build",
  "assessment_run",
  "tutor_session",
  "coach_decide",
  "mastery_update",
  "plan_review",
] as const;
export type TaskType = (typeof TASK_TYPES)[number];

export interface TaskRequirements {
  structuredOutput?: boolean;
  toolUse?: boolean;
  /** Needs the provider's web search tool. */
  webSearch?: boolean;
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
  profile_extract: {
    tier: "standard",
    requires: { structuredOutput: true },
    fallback: ["deep"],
    rationale:
      "Profiler: turn a resume, LinkedIn profile and discovery transcript into a skills profile with evidence. Runs once per confirmed brief; misread skills skew the gap, so no fast-tier fallback.",
  },
  requirements_research: {
    tier: "standard",
    requires: { structuredOutput: true, webSearch: true },
    fallback: [],
    rationale:
      "Requirements analyst's research: find current job postings for a target and pull out what they ask for. Cached per target like the requirements. Searching takes minutes, so there's no fallback retry; without postings, requirements are built from model knowledge.",
  },
  requirements_build: {
    tier: "deep",
    requires: { structuredOutput: true },
    fallback: ["standard"],
    rationale:
      "Requirements analyst: what a target role, market and industry demand. Cached and shared by every learner with the same target, so the deep tier's cost is paid rarely.",
  },
  assessment_run: {
    tier: "standard",
    requires: { toolUse: true },
    fallback: ["deep"],
    rationale:
      "Assessor: the short skills check after discovery that confirms or corrects the profile. Conversational, emits results as tool calls.",
  },
  tutor_session: {
    tier: "standard",
    requires: { toolUse: true },
    fallback: ["deep"],
    rationale:
      "Tutor: teach the current plan step and assign and follow up on exercises. The main learner-facing conversation; quick side questions use sidekick_answer instead.",
  },
  coach_decide: {
    tier: "standard",
    requires: { structuredOutput: true },
    fallback: ["deep"],
    rationale:
      "Coach: decide how to respond to missed sessions, falling pace or a stuck topic, and write the check-in. The message goes straight to a learner at risk of quitting, and in evals the fast tier broke tone rules (framing a gap as past failure, claiming a late plan was on track). It only runs when code has found a signal, about once a day at most, so the standard tier's cost is small.",
  },
  mastery_update: {
    tier: "fast",
    requires: { structuredOutput: true },
    fallback: ["standard"],
    rationale:
      "Mastery keeper's judgement calls: merge duplicate topics, link related ones. Evidence scoring and FSRS scheduling are deterministic and don't call a model.",
  },
  plan_review: {
    tier: "standard",
    requires: { structuredOutput: true },
    fallback: ["deep"],
    rationale:
      "Plan reviewer: judge a draft plan against the brief and gap (deadline honesty, pacing, order, proof) after code has checked the arithmetic. A second model's read catches what the planner talked itself into.",
  },
};

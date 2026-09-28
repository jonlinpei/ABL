import { generateStructured } from "@/lib/ai/structured";
import type { GoalBrief } from "@/lib/goals/schema";

import { checkPlan } from "./plan-checks";
import { PLAN_REVIEWER_SKILL } from "./plan-reviewer.generated";
import { PLANNER_SKILL } from "./planner.generated";
import { PlanReviewSchema, PlanSchema, type Gap, type Plan, type PlanReview } from "./schemas";

/** What the planner and reviewer both read: the brief's constraints and the gap. */
export function planContext(brief: GoalBrief, gap: Gap, today: string): string {
  const b = brief;
  const items = gap.items
    .map(
      (i) =>
        `- ${i.skillId}: ${i.name} (${i.category}, ${i.importance}). Now ${i.current} (${i.basis.replace("_", " ")}), needs ${i.required}: ${i.status}.`,
    )
    .join("\n");
  const credentials = gap.credentials.length
    ? gap.credentials.map((c) => `- ${c.name} (${c.status}): ${c.note}`).join("\n")
    : "- None that matter for hiring.";
  return `Today is ${today}.

## Career brief
- Move: ${b.current.role} (${b.current.industry}) to ${b.target.role} (${b.target.market}; ${b.target.industry}). Changing: ${b.changes.join(", ") || "nothing, growing in place"}.
- Goal: ${b.restatedGoal}
- Why: ${b.motivation}
- Success looks like: ${b.successLooksLike}
- Deadline: ${b.deadline ?? "none"}
- Time: ${b.weeklyHours} hours a week, sessions of ${b.sessionMinutes} minutes${b.preferredTimes ? `, ${b.preferredTimes}` : ""}.
- Priority: ${b.priority}
- Tried before: ${b.pastAttempts ?? "nothing"}
- Current work: ${b.current.work}
- Interests: ${b.interests.join(", ") || "none listed"}

## Skills gap (ids to use in the plan)
${items}

## What employers want to see
${gap.proofOfSkill.map((p) => `- ${p}`).join("\n") || "- Nothing specific."}

## Credentials
${credentials}`;
}

export async function draftPlan(
  context: string,
  userId: string,
  revision?: { plan: Plan; issues: PlanReview["issues"] },
): Promise<Plan> {
  const prompt = revision
    ? `${context}

## Your earlier draft
${JSON.stringify(revision.plan, null, 2)}

## Reviewer feedback to address
${revision.issues.map((i) => `- [${i.severity}] ${i.issue} Fix: ${i.fix}`).join("\n")}

Return the whole revised plan.`
    : `${context}\n\nWrite the plan.`;
  const { output } = await generateStructured({
    task: "roadmap_generate",
    userId,
    instructions: PLANNER_SKILL,
    prompt,
    schema: PlanSchema,
  });
  return output;
}

export async function reviewPlan(context: string, plan: Plan, userId: string): Promise<PlanReview> {
  const { output } = await generateStructured({
    task: "plan_review",
    userId,
    instructions: PLAN_REVIEWER_SKILL,
    prompt: `${context}\n\n## Proposed plan\n${JSON.stringify(plan, null, 2)}`,
    schema: PlanReviewSchema,
  });
  return output;
}

/** Code's hard rules plus the reviewer's judgement, as one verdict. */
export function combineReview(checks: PlanReview["issues"], review: PlanReview): PlanReview {
  const issues = [...checks, ...review.issues];
  return { verdict: issues.some((i) => i.severity === "must_fix") ? "revise" : "approve", issues };
}

export interface PlanOutcome {
  plan: Plan;
  /** The final verdict. Issues still open after the revision round are kept, not hidden. */
  review: PlanReview;
  revised: boolean;
}

/** Runs a named unit of work; the lifecycle passes Inngest's `step.run` so each is memoized. */
export type StepRunner = <T>(name: string, fn: () => Promise<T>) => Promise<T>;

const direct: StepRunner = (_name, fn) => fn();

/**
 * Draft, review (code checks plus the reviewer), and revise once if anything
 * must be fixed. One round keeps cost and latency bounded; whatever is still
 * open afterwards is recorded with the plan.
 */
export async function planWithReview({
  brief,
  gap,
  userId,
  today,
  run = direct,
}: {
  brief: GoalBrief;
  gap: Gap;
  userId: string;
  today: string;
  run?: StepRunner;
}): Promise<PlanOutcome> {
  const context = planContext(brief, gap, today);
  const draft = await run("draft-plan", () => draftPlan(context, userId));
  const first = combineReview(
    checkPlan(draft, gap, brief),
    await run("review-plan", () => reviewPlan(context, draft, userId)),
  );
  if (first.verdict === "approve") return { plan: draft, review: first, revised: false };

  const revisedPlan = await run("revise-plan", () => draftPlan(context, userId, { plan: draft, issues: first.issues }));
  // The revision is re-checked in code; a second model review would start an open-ended loop.
  const remaining = checkPlan(revisedPlan, gap, brief);
  return {
    plan: revisedPlan,
    review: {
      verdict: remaining.some((i) => i.severity === "must_fix") ? "revise" : "approve",
      issues: remaining,
    },
    revised: true,
  };
}

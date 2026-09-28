import type { GoalBrief } from "@/lib/goals/schema";

import { z } from "zod";

import { finishGap, scoreItem } from "./gap";
import { AssessedSkill, type Gap } from "./schemas";

/** The skills check promises ten minutes or less; about two minutes a skill. */
export const MAX_SKILLS_TO_CHECK = 5;

/**
 * The skills worth checking: levels the plan would rely on that came from a
 * claim or a guess. Must-haves first, then the highest claims, since those
 * would skip the most teaching if they're wrong.
 */
export function selectSkillsToCheck(gap: Gap, max = MAX_SKILLS_TO_CHECK): Gap["items"] {
  return gap.items
    .filter((i) => i.verify)
    .sort(
      (a, b) =>
        Number(b.importance === "must") - Number(a.importance === "must") || b.current - a.current,
    )
    .slice(0, max);
}

/**
 * The gap with assessed levels in place of the profiler's estimates. Skills
 * the Assessor didn't check keep their estimate. A low-confidence result on a
 * skipped question still counts: it's better evidence than a guess.
 */
export function applyAssessment(gap: Gap, results: AssessedSkill[]): Gap {
  const byId = new Map(results.map((r) => [r.skillId, r]));
  const items = gap.items.map((item) => {
    const result = byId.get(item.skillId);
    if (!result) return item;
    return scoreItem({ ...item, current: result.level, basis: "assessed" });
  });
  return finishGap(items, gap.credentials, gap.proofOfSkill);
}

/**
 * What the Assessor needs to know for this learner: the move they're making
 * and the skills to check, with the level assumed and the level needed.
 */
export function assessorContext(brief: GoalBrief, skills: Gap["items"]): string {
  const list = skills
    .map(
      (s) =>
        `- ${s.skillId}: ${s.name}. Estimated ${s.current} (${s.basis.replace("_", " ")}, a guess to test); the target needs ${s.required}.`,
    )
    .join("\n");
  return `## This learner

${brief.current.role} moving to ${brief.target.role} (${brief.target.industry}). Experience: ${brief.current.experience}.
What they bring: ${brief.current.strengths.join("; ") || "not listed"}.

## Skills to check, in this order

${list}`;
}

/**
 * Input schema for the `submit_assessment` tool, limited to the skills being
 * checked. Strict tool mode rejects min/max on numbers, and zod's `.int()`
 * adds safe-integer bounds, so the level is a plain number here and
 * `checkSubmission` rounds and clamps it.
 */
export function submissionSchema(ids: [string, ...string[]]) {
  return z.object({
    results: z.array(
      AssessedSkill.extend({
        skillId: z.enum(ids),
        level: z.number().describe("The level their answers showed: a whole number from 0 to 4."),
      }),
    ),
  });
}

/**
 * Accept a submission only if it covers every checked skill. A premature
 * call would otherwise save zeros over estimates after one question. A
 * learner who stops early still gets through: the Assessor submits the
 * unchecked skills explicitly at level 0.
 */
export function checkSubmission(
  results: AssessedSkill[],
  ids: string[],
): { ok: true; results: AssessedSkill[] } | { ok: false; missing: string[] } {
  const byId = new Map(results.map((r) => [r.skillId, r]));
  const missing = ids.filter((id) => !byId.has(id));
  if (missing.length > 0) return { ok: false, missing };
  // One result per skill, in order; if a skill was repeated, the last wins.
  return {
    ok: true,
    results: ids.map((id) => {
      const r = byId.get(id)!;
      return { ...r, level: Math.min(4, Math.max(0, Math.round(r.level))) };
    }),
  };
}

/** What `submit_assessment` tells the Assessor about an incomplete submission. */
export function incompleteReply(missing: string[]) {
  return {
    status: "incomplete" as const,
    missing,
    message: `Not saved. Check these skills first, or if the learner wants to stop, submit them at level 0 with low confidence: ${missing.join(", ")}.`,
  };
}

/** Stop streaming once a submission has been accepted, not on a rejected one. */
export function assessmentAccepted({
  steps,
}: {
  steps: { toolResults: { toolName: string; output: unknown }[] }[];
}): boolean {
  return steps.some((step) =>
    step.toolResults.some(
      (r) =>
        r.toolName === "submit_assessment" &&
        (r.output as { status?: string } | undefined)?.status !== "incomplete",
    ),
  );
}

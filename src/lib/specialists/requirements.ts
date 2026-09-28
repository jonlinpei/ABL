import { generateStructured } from "@/lib/ai/structured";
import type { GoalBrief } from "@/lib/goals/schema";

import { REQUIREMENTS_ANALYST_SKILL } from "./requirements-analyst.generated";
import { TargetRequirementsSchema, type TargetRequirements } from "./schemas";

/**
 * Cache key for a target. Learners whose briefs name the same role, market and
 * industry share one requirements set. Differently worded targets miss the
 * cache; matching near-duplicates is a later improvement.
 */
export function targetKey(target: GoalBrief["target"]): string {
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
  return [target.role, target.market, target.industry].map(norm).join(" | ");
}

export function requirementsPrompt(brief: GoalBrief): string {
  const t = brief.target;
  return `Target:
- Role: ${t.role}
- What the role involves: ${t.work}
- Market: ${t.market}
- Industry: ${t.industry}

For context, the learner aiming here is moving from: ${brief.current.role} (${brief.current.industry}), ${brief.current.experience}. Write requirements for the target itself, not for this learner.`;
}

/** Build the requirements for a brief's target. */
export async function buildRequirements(brief: GoalBrief, userId: string): Promise<TargetRequirements> {
  const { output } = await generateStructured({
    task: "requirements_build",
    userId,
    instructions: REQUIREMENTS_ANALYST_SKILL,
    prompt: requirementsPrompt(brief),
    schema: TargetRequirementsSchema,
  });
  return withUniqueSkillIds(output);
}

/** Slug the ids and drop repeats, so profiles and gaps can key on them. */
export function withUniqueSkillIds(req: TargetRequirements): TargetRequirements {
  const seen = new Set<string>();
  const skills = [];
  for (const skill of req.skills) {
    const id = skill.id
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
    if (!id || seen.has(id)) continue;
    seen.add(id);
    skills.push({ ...skill, id });
  }
  return { ...req, skills };
}

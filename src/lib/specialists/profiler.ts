import { generateStructured } from "@/lib/ai/structured";
import type { GoalBrief } from "@/lib/goals/schema";

import { PROFILER_SKILL } from "./profiler.generated";
import { LearnerProfileSchema, type LearnerProfile, type TargetRequirements } from "./schemas";

export function profilePrompt(brief: GoalBrief, requirements: TargetRequirements): string {
  const c = brief.current;
  const skills = requirements.skills
    .map((s) => `- ${s.id}: ${s.name} (${s.category}; needs level ${s.level}, ${s.importance})`)
    .join("\n");
  return `Learner's career brief:
- Now: ${c.role}. ${c.work}
- Market and industry now: ${c.market}; ${c.industry}
- Experience: ${c.experience}
- Strengths they bring: ${c.strengths.join("; ") || "none listed"}
- Starting point toward the target: ${brief.startingPoint}
- Tried before: ${brief.pastAttempts ?? "nothing"}
- Moving to: ${brief.target.role}. ${brief.target.work} (${brief.target.market}; ${brief.target.industry})

Required skills for the target, in order:
${skills}`;
}

/** Estimate the learner's level on each required skill. */
export async function buildProfile(
  brief: GoalBrief,
  requirements: TargetRequirements,
  userId: string,
): Promise<LearnerProfile> {
  const { output } = await generateStructured({
    task: "profile_extract",
    userId,
    instructions: PROFILER_SKILL,
    prompt: profilePrompt(brief, requirements),
    schema: LearnerProfileSchema,
  });
  return alignToRequirements(output, requirements);
}

/**
 * Exactly one entry per required skill, in requirement order. Unknown ids are
 * dropped; skills the model skipped count as level 0, inferred.
 */
export function alignToRequirements(
  profile: LearnerProfile,
  requirements: TargetRequirements,
): LearnerProfile {
  const byId = new Map(profile.skills.map((s) => [s.skillId, s]));
  return {
    ...profile,
    skills: requirements.skills.map(
      (req) =>
        byId.get(req.id) ?? {
          skillId: req.id,
          level: 0,
          basis: "inferred" as const,
          evidence: "Nothing in the brief speaks to this skill.",
        },
    ),
  };
}

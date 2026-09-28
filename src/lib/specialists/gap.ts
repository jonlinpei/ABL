import type { Gap, LearnerProfile, TargetRequirements } from "./schemas";

/**
 * Requirements minus profile, per required skill. Deterministic, so the plan
 * and the learner can see exactly why a skill is on the list. Must-haves come
 * first, then the biggest shortfalls.
 */
export function computeGap(requirements: TargetRequirements, profile: LearnerProfile): Gap {
  const byId = new Map(profile.skills.map((s) => [s.skillId, s]));
  const items = requirements.skills.map((req) => {
    const has = byId.get(req.id);
    const current = has?.level ?? 0;
    const shortfall = Math.max(0, req.level - current);
    return {
      skillId: req.id,
      name: req.name,
      category: req.category,
      importance: req.importance,
      required: req.level,
      current,
      shortfall,
      status: shortfall === 0 ? ("met" as const) : current === 0 ? ("missing" as const) : ("partial" as const),
      basis: has?.basis ?? ("inferred" as const),
      // Anything the plan would skip or shorten on the strength of a claim.
      verify: current > 0 && has?.basis !== "work_history",
    };
  });
  items.sort(
    (a, b) =>
      Number(b.importance === "must") - Number(a.importance === "must") || b.shortfall - a.shortfall,
  );
  return {
    items,
    credentials: requirements.credentials,
    proofOfSkill: requirements.proofOfSkill,
    counts: {
      met: items.filter((i) => i.status === "met").length,
      partial: items.filter((i) => i.status === "partial").length,
      missing: items.filter((i) => i.status === "missing").length,
    },
  };
}

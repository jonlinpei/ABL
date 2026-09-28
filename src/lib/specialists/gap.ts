import type { Gap, LearnerProfile, TargetRequirements } from "./schemas";

type GapItem = Gap["items"][number];

/**
 * Requirements minus profile, per required skill. Deterministic, so the plan
 * and the learner can see exactly why a skill is on the list. Must-haves come
 * first, then the biggest shortfalls.
 */
export function computeGap(requirements: TargetRequirements, profile: LearnerProfile): Gap {
  const byId = new Map(profile.skills.map((s) => [s.skillId, s]));
  const items = requirements.skills.map((req) => {
    const has = byId.get(req.id);
    return scoreItem({
      skillId: req.id,
      name: req.name,
      category: req.category,
      importance: req.importance,
      required: req.level,
      current: has?.level ?? 0,
      basis: has?.basis ?? "inferred",
    });
  });
  return finishGap(items, requirements.credentials, requirements.proofOfSkill);
}

/** Shortfall, status and whether the Assessor should verify the level. */
export function scoreItem(item: Omit<GapItem, "shortfall" | "status" | "verify">): GapItem {
  const shortfall = Math.max(0, item.required - item.current);
  return {
    ...item,
    shortfall,
    status: shortfall === 0 ? "met" : item.current === 0 ? "missing" : "partial",
    // Anything the plan would skip or shorten on the strength of a claim.
    verify:
      item.current > 0 &&
      item.basis !== "work_history" &&
      item.basis !== "assessed" &&
      item.basis !== "practiced",
  };
}

/** Sort (must-haves, then biggest shortfall) and count. */
export function finishGap(
  items: GapItem[],
  credentials: Gap["credentials"],
  proofOfSkill: string[],
): Gap {
  const sorted = [...items].sort(
    (a, b) =>
      Number(b.importance === "must") - Number(a.importance === "must") || b.shortfall - a.shortfall,
  );
  return {
    items: sorted,
    credentials,
    proofOfSkill,
    counts: {
      met: sorted.filter((i) => i.status === "met").length,
      partial: sorted.filter((i) => i.status === "partial").length,
      missing: sorted.filter((i) => i.status === "missing").length,
    },
  };
}

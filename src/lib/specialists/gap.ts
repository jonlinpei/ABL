import type { Gap, LearnerProfile, RequiredSkill, TargetRequirements } from "./schemas";

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
    return requiredItem(req, has?.level ?? 0, has?.basis ?? "inferred");
  });
  return finishGap(items, requirements.credentials, requirements.proofOfSkill);
}

function requiredItem(req: RequiredSkill, current: number, basis: GapItem["basis"]): GapItem {
  return scoreItem({
    skillId: req.id,
    name: req.name,
    category: req.category,
    importance: req.importance,
    required: req.level,
    current,
    basis,
    ...(req.frequency && { frequency: req.frequency }),
    ...(req.howToShow && { howToShow: req.howToShow }),
  });
}

/**
 * A learner's gap against refreshed requirements for their target. Skills
 * keep the learner's known level; new ones start unknown. What's needed
 * (level, must or nice, how to show it) comes from the new requirements.
 * Skills the target no longer lists stay, as nice-to-haves, so nothing the
 * learner is working on disappears from under them.
 */
export function rebaseGap(gap: Gap, requirements: TargetRequirements): Gap {
  const known = new Map(gap.items.map((i) => [i.skillId, i]));
  const listed = new Set(requirements.skills.map((r) => r.id));
  const items = [
    ...requirements.skills.map((req) => {
      const had = known.get(req.id);
      return requiredItem(req, had?.current ?? 0, had?.basis ?? "inferred");
    }),
    ...gap.items
      .filter((i) => !listed.has(i.skillId))
      // No longer in the postings, so no posting frequency either.
      .map((i) => scoreItem({ ...i, importance: "nice", frequency: undefined })),
  ];
  return finishGap(items, requirements.credentials, requirements.proofOfSkill);
}

/** Open must-haves (not yet met) that a rebase added and dropped, as the learner should hear it. */
export function openMustHaveChanges(before: Gap, after: Gap) {
  const open = (g: Gap) =>
    new Map(g.items.filter((i) => i.importance === "must" && i.status !== "met").map((i) => [i.skillId, i.name]));
  const [was, now] = [open(before), open(after)];
  const pick = (from: Map<string, string>, notIn: Map<string, string>) =>
    [...from].filter(([id]) => !notIn.has(id)).map(([skillId, name]) => ({ skillId, name }));
  return { added: pick(now, was), dropped: pick(was, now) };
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

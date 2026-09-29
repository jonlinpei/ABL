import type { Gap } from "./schemas";

/** A glossary sense as the app works with it. */
export interface GlossarySense {
  id: string;
  headword: string;
  headKey: string;
  domain: string;
  definition: string;
  skillId: string | null;
  briefId: string | null;
  source: "sidekick" | "session" | "learner";
  timesSeen: number;
  struggled: boolean;
  known: boolean;
}

export type Familiarity = "new" | "shaky" | "solid";

/** Matching key for a headword or field: "  Left JOIN " and "left join" are the same. */
export function glossaryKey(text: string): string {
  return text
    .toLowerCase()
    .replace(/[“”"'`]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}+#)]+$/gu, "");
}

/**
 * How well they know a sense. Solid when they've marked it known or its skill
 * has reached the target level; shaky when they struggled with it, or it keeps
 * coming up (three times or more) before its skill is there; new otherwise.
 */
export function familiarity(sense: Pick<GlossarySense, "known" | "struggled" | "timesSeen" | "skillId">, gap: Gap | null): Familiarity {
  if (sense.known) return "solid";
  const skill = sense.skillId ? gap?.items.find((i) => i.skillId === sense.skillId) : undefined;
  if (skill?.status === "met") return "solid";
  if (sense.struggled || sense.timesSeen >= 3) return "shaky";
  return "new";
}

/** Senses grouped under their headword, alphabetically; a headword with several fields is a possible false friend. */
export function groupByHeadword<T extends Pick<GlossarySense, "headKey" | "headword" | "domain">>(senses: T[]) {
  const groups = new Map<string, { headword: string; senses: T[] }>();
  for (const s of senses) {
    const g = groups.get(s.headKey) ?? { headword: s.headword, senses: [] };
    g.senses.push(s);
    groups.set(s.headKey, g);
  }
  return [...groups.values()]
    .map((g) => ({ ...g, senses: g.senses.sort((a, b) => a.domain.localeCompare(b.domain)) }))
    .sort((a, b) => a.headword.localeCompare(b.headword, undefined, { sensitivity: "base" }));
}

/** The fields already in their glossary, so new terms reuse the same labels. */
export function glossaryDomains(senses: Pick<GlossarySense, "domain">[]): string[] {
  const byKey = new Map<string, string>();
  for (const s of senses) if (!byKey.has(glossaryKey(s.domain))) byKey.set(glossaryKey(s.domain), s.domain);
  return [...byKey.values()].sort();
}

/**
 * The tutor's per-turn glossary note: the fields to reuse when it records
 * terms, the shaky terms for this milestone's skills, and other senses of
 * those terms the learner knows from another field (a bridge, or a false
 * friend to flag). Null when there's nothing useful.
 */
export function glossaryNotes(senses: GlossarySense[], milestoneSkillIds: string[], gap: Gap | null): string | null {
  const domains = glossaryDomains(senses);
  const skills = new Set(milestoneSkillIds);
  const shaky = senses.filter((s) => s.skillId && skills.has(s.skillId) && familiarity(s, gap) === "shaky").slice(0, 5);
  const lines: string[] = [];
  for (const s of shaky) {
    const others = senses.filter((o) => o.headKey === s.headKey && o.id !== s.id);
    const other = others.length ? ` They also know it from ${others.map((o) => `${o.domain} ("${o.definition}")`).join(" and ")}: use that as a bridge, or flag the difference.` : "";
    lines.push(`- ${s.headword} (${s.domain}) is still shaky.${other}`);
  }
  if (!domains.length && !lines.length) return null;
  return `[Glossary: ${domains.length ? `fields in use: ${domains.join(", ")}. Reuse one when recording terms.` : ""}${lines.length ? `\n${lines.join("\n")}` : ""}]`;
}

/** What the glossary writer needs to define a term the learner added. */
export function definePrompt({
  term,
  note,
  learner,
  existing,
}: {
  term: string;
  note: string | null;
  learner: { currentRole: string; goal: string };
  existing: GlossarySense[];
}): string {
  const same = existing.filter((s) => s.headKey === glossaryKey(term));
  const fields = glossaryDomains(existing);
  return `Term they added: ${term}
${note ? `What they said about it: ${note}\n` : ""}
The learner: ${learner.currentRole}, learning toward: ${learner.goal}

Fields already in their glossary: ${fields.join(", ") || "none yet"}
Senses of this term they already have: ${same.length ? same.map((s) => `\n- ${s.domain}: ${s.definition}`).join("") : "none"}`;
}

import { and, eq, sql } from "drizzle-orm";

import { getDb, schema } from "@/db";

import { glossaryKey, type GlossarySense } from "./glossary";
import type { GlossaryEntry } from "./schemas";

const { glossaryTerms } = schema;

/** Everything in a learner's glossary. */
export async function loadGlossary(userId: string): Promise<GlossarySense[]> {
  const rows = await getDb().select().from(glossaryTerms).where(eq(glossaryTerms.userId, userId));
  return rows.map((r) => ({
    id: r.id,
    headword: r.headword,
    headKey: r.headKey,
    domain: r.domain,
    definition: r.definition,
    skillId: r.skillId,
    briefId: r.briefId,
    source: r.source,
    timesSeen: r.timesSeen,
    struggled: r.struggled,
    known: r.known,
  }));
}

/**
 * Add terms to a learner's glossary. A sense they already have (same term,
 * same field) counts as seen again, keeps its first definition, and becomes
 * shaky if they struggled this time; anything else is a new sense.
 */
export async function recordTerms(...args: Parameters<typeof termsInsert>) {
  const insert = termsInsert(...args);
  if (insert) await insert;
}

/** The insert behind `recordTerms`, for callers that batch it with other writes. Null when there's nothing to add. */
export function termsInsert(
  userId: string,
  briefId: string | null,
  source: GlossarySense["source"],
  entries: (GlossaryEntry & { skillId?: string | null; struggled?: boolean })[],
) {
  // One row per sense: a batch can't touch the same row twice.
  const bySense = new Map<string, (typeof entries)[number] & { headKey: string; domainKey: string }>();
  for (const e of entries) {
    const headKey = glossaryKey(e.term);
    const domainKey = glossaryKey(e.domain);
    if (headKey && domainKey && e.definition.trim()) bySense.set(`${headKey}|${domainKey}`, { ...e, headKey, domainKey });
  }
  const rows = [...bySense.values()];
  if (!rows.length) return null;
  const now = new Date();
  return getDb()
    .insert(glossaryTerms)
    .values(
      rows.map((e) => ({
        userId,
        headword: e.term.trim(),
        headKey: e.headKey,
        domain: e.domain.trim().toLowerCase(),
        domainKey: e.domainKey,
        definition: e.definition.trim(),
        skillId: e.skillId ?? null,
        briefId,
        source,
        struggled: !!e.struggled,
        firstSeenAt: now,
        lastSeenAt: now,
      })),
    )
    .onConflictDoUpdate({
      target: [glossaryTerms.userId, glossaryTerms.headKey, glossaryTerms.domainKey],
      set: {
        timesSeen: sql`${glossaryTerms.timesSeen} + 1`,
        lastSeenAt: now,
        struggled: sql`${glossaryTerms.struggled} or excluded.struggled`,
        skillId: sql`coalesce(${glossaryTerms.skillId}, excluded.skill_id)`,
      },
    });
}

/** Mark a sense known, or back to learning. */
export async function setTermKnown(userId: string, id: string, known: boolean) {
  const [row] = await getDb()
    .update(glossaryTerms)
    .set({ known })
    .where(and(eq(glossaryTerms.id, id), eq(glossaryTerms.userId, userId)))
    .returning({ id: glossaryTerms.id });
  return !!row;
}

/** Remove a sense from the glossary. */
export async function deleteTerm(userId: string, id: string) {
  const [row] = await getDb()
    .delete(glossaryTerms)
    .where(and(eq(glossaryTerms.id, id), eq(glossaryTerms.userId, userId)))
    .returning({ id: glossaryTerms.id });
  return !!row;
}

import { and, eq, inArray, sql } from "drizzle-orm";

import { getDb, schema } from "@/db";

import { applyEvidence, applyMasteryToGap, type MasteryRecord } from "./mastery";

const { gaps, learnerEvents, plans, sessions, skillMastery } = schema;

/** The learner's mastery records, optionally limited to some skills. */
export async function loadMastery(userId: string, skillIds?: string[]): Promise<MasteryRecord[]> {
  const where = skillIds
    ? and(eq(skillMastery.userId, userId), inArray(skillMastery.skillId, skillIds.length ? skillIds : [""]))
    : eq(skillMastery.userId, userId);
  const rows = await getDb().select().from(skillMastery).where(where);
  return rows.map((r) => ({ skillId: r.skillId, name: r.name, level: r.level, evidence: r.evidence, card: r.card }));
}

/**
 * Apply a finished session's evidence: update the learner's mastery and
 * review schedule, carry the new levels into the gap, and log
 * `mastery_updated`, together. Each session is applied at most once.
 */
export async function applySessionEvidence(
  sessionId: string,
  now = new Date(),
): Promise<{ applied: boolean; skills: string[] }> {
  const db = getDb();
  const [session] = await db.select().from(sessions).where(eq(sessions.id, sessionId));
  if (!session?.report || session.masteryAppliedAt) return { applied: false, skills: [] };
  const evidence = session.report.evidence;
  const userId = session.userId;

  const [plan] = await db.select({ briefId: plans.briefId }).from(plans).where(eq(plans.id, session.planId));
  const [gapRow] = plan ? await db.select().from(gaps).where(eq(gaps.briefId, plan.briefId)) : [];
  const gapItems = new Map(gapRow?.gap.items.map((i) => [i.skillId, i]));
  const existing = new Map((await loadMastery(userId, evidence.map((e) => e.skillId))).map((r) => [r.skillId, r]));

  const records = evidence.map((e) =>
    applyEvidence({
      record: existing.get(e.skillId),
      skillId: e.skillId,
      name: gapItems.get(e.skillId)?.name ?? e.skillId,
      startingLevel: gapItems.get(e.skillId)?.current ?? 0,
      entry: { level: e.level, evidence: e.evidence, source: "session", at: now.toISOString() },
      now,
    }),
  );

  const markApplied = db.update(sessions).set({ masteryAppliedAt: now }).where(eq(sessions.id, sessionId));
  const event = db.insert(learnerEvents).values({
    userId,
    type: "mastery_updated",
    payload: { sessionId, skills: records.map((r) => ({ skillId: r.skillId, level: r.level, due: r.card.due })) },
  });
  const upserts = records.map((r) =>
    db
      .insert(skillMastery)
      .values({ userId, skillId: r.skillId, name: r.name, level: r.level, evidence: r.evidence, card: r.card, due: new Date(r.card.due) })
      .onConflictDoUpdate({
        target: [skillMastery.userId, skillMastery.skillId],
        set: {
          name: sql`excluded.name`,
          level: sql`excluded.level`,
          evidence: sql`excluded.evidence`,
          card: sql`excluded.card`,
          due: sql`excluded.due`,
          updatedAt: now,
        },
      }),
  );
  const gapUpdate = gapRow
    ? [db.update(gaps).set({ gap: applyMasteryToGap(gapRow.gap, records) }).where(eq(gaps.id, gapRow.id))]
    : [];

  await db.batch([markApplied, event, ...upserts, ...gapUpdate]);
  return { applied: true, skills: records.map((r) => r.skillId) };
}

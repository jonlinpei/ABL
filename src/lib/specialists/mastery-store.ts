import { and, eq, inArray, isNull, sql } from "drizzle-orm";

import { getDb, schema } from "@/db";

import { termsInsert } from "./glossary-store";
import { applyEvidence, spreadMastery, type MasteryRecord } from "./mastery";

const { careerBriefs, gaps, goals, learnerEvents, plans, sessions, skillMastery } = schema;

/** The learner's mastery records, optionally limited to some skills. */
export async function loadMastery(userId: string, skillIds?: string[]): Promise<MasteryRecord[]> {
  const where = skillIds
    ? and(eq(skillMastery.userId, userId), inArray(skillMastery.skillId, skillIds.length ? skillIds : [""]))
    : eq(skillMastery.userId, userId);
  const rows = await getDb().select().from(skillMastery).where(where);
  return rows.map((r) => ({ skillId: r.skillId, name: r.name, level: r.level, evidence: r.evidence, card: r.card }));
}

/**
 * The gaps of each of the learner's live goals (active or paused): the
 * current version's, and a pending new version's while one is being set up.
 * These follow the learner's skills.
 */
export async function loadLiveGaps(userId: string) {
  const db = getDb();
  const rows = await db
    .select({ id: gaps.id, briefId: gaps.briefId, goalId: careerBriefs.goalId, version: careerBriefs.version, gap: gaps.gap })
    .from(gaps)
    .innerJoin(careerBriefs, eq(careerBriefs.id, gaps.briefId))
    .innerJoin(goals, eq(goals.id, careerBriefs.goalId))
    .where(and(eq(careerBriefs.userId, userId), isNull(careerBriefs.declinedAt), inArray(goals.status, ["active", "paused"])));
  if (!rows.length) return [];
  const active = new Set(
    (
      await db
        .select({ briefId: plans.briefId })
        .from(plans)
        .where(and(inArray(plans.briefId, rows.map((r) => r.briefId)), eq(plans.status, "active")))
    ).map((p) => p.briefId),
  );
  const newest = new Map<string, number>();
  for (const r of rows) newest.set(r.goalId, Math.max(newest.get(r.goalId) ?? 0, r.version));
  return rows
    .filter((r) => active.has(r.briefId) || newest.get(r.goalId) === r.version)
    .map(({ id, briefId, goalId, gap }) => ({ id, briefId, goalId, gap }));
}

/**
 * Apply a finished session's evidence: update the learner's mastery and
 * review schedule, carry the new levels into the session's gap and every
 * other live goal's gap with those skills, and log `mastery_updated`,
 * together. Each session is applied at most once.
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
  const upserts = masteryUpserts(userId, records, now);
  // The session's own gap, even on an older brief or a paused goal, plus every live goal's.
  const live = await loadLiveGaps(userId);
  const toUpdate = [...(gapRow ? [{ id: gapRow.id, gap: gapRow.gap }] : []), ...live.filter((g) => g.id !== gapRow?.id)];
  const gapUpdate = spreadMastery(toUpdate, records).map((g) => db.update(gaps).set({ gap: g.gap }).where(eq(gaps.id, g.id)));

  // Key terms the tutor recorded go to the glossary in the same batch, so they're added exactly once.
  const terms = termsInsert(userId, plan?.briefId ?? null, "session", session.report.terms ?? []);
  await db.batch([markApplied, event, ...upserts, ...gapUpdate, ...(terms ? [terms] : [])]);
  return { applied: true, skills: records.map((r) => r.skillId) };
}

/** Writes that save mastery records, inserting or replacing each skill's row. */
export function masteryUpserts(userId: string, records: MasteryRecord[], now: Date) {
  const db = getDb();
  return records.map((r) =>
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
}

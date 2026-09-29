import { and, desc, eq } from "drizzle-orm";

import { getDb, schema } from "@/db";
import type { GoalBrief } from "@/lib/goals/schema";

import type { EditableBriefField } from "./corrections";
import type { MasteryRecord } from "./mastery";
import type { Gap } from "./schemas";

const { assessments, careerBriefs, gaps, learnerEvents, learnerProfiles, plans, skillMastery, users } = schema;

/**
 * What ABL holds about a learner, for them to see: their newest brief, the
 * profile and gap built from it, and their skills check. Undefined before
 * any brief.
 */
export async function loadLearnerRecord(userId: string) {
  const db = getDb();
  const [brief] = await db
    .select()
    .from(careerBriefs)
    .where(eq(careerBriefs.userId, userId))
    .orderBy(desc(careerBriefs.version))
    .limit(1);
  if (!brief) return undefined;
  const [[profile], [gap], [assessment], [plan], corrected] = await Promise.all([
    db.select({ profile: learnerProfiles.profile }).from(learnerProfiles).where(eq(learnerProfiles.briefId, brief.id)),
    db.select({ gap: gaps.gap, assessedAt: gaps.assessedAt }).from(gaps).where(eq(gaps.briefId, brief.id)),
    db.select({ results: assessments.results }).from(assessments).where(eq(assessments.briefId, brief.id)),
    db
      .select({ plan: plans.plan })
      .from(plans)
      .where(and(eq(plans.briefId, brief.id), eq(plans.status, "active")))
      .limit(1),
    db
      .select({ payload: learnerEvents.payload })
      .from(learnerEvents)
      .where(and(eq(learnerEvents.userId, userId), eq(learnerEvents.type, "skill_corrected")))
      .orderBy(learnerEvents.createdAt),
  ]);
  // The learner's latest correction per skill on this brief, with what they said.
  const corrections = new Map<string, string | null>();
  for (const { payload } of corrected) {
    const p = payload as { briefId: string; skillId: string; note: string | null };
    if (p.briefId === brief.id) corrections.set(p.skillId, p.note);
  }
  return {
    briefId: brief.id,
    brief: brief.brief,
    profile: profile?.profile ?? null,
    gap: gap?.gap ?? null,
    assessedAt: gap?.assessedAt ?? null,
    assessment: assessment?.results ?? [],
    hasPlan: !!plan,
    /** The week the current plan is built for (a replan can change it without changing the brief). */
    week: plan ? { weeklyHours: plan.plan.weeklyHours, sessionMinutes: plan.plan.sessionMinutes } : null,
    corrections: [...corrections].map(([skillId, note]) => ({ skillId, note })),
  };
}

/** Save in-place brief edits and log which fields changed. */
export async function saveBriefDetails(userId: string, briefId: string, brief: GoalBrief, fields: EditableBriefField[]) {
  const db = getDb();
  await db.batch([
    db.update(careerBriefs).set({ brief }).where(and(eq(careerBriefs.id, briefId), eq(careerBriefs.userId, userId))),
    db.insert(learnerEvents).values({ userId, type: "brief_edited", payload: { briefId, fields } }),
  ]);
}

/** Save a learner's correction to a skill level: the gap, their mastery record if they have one, and the event. */
export async function saveSkillCorrection(
  userId: string,
  briefId: string,
  gap: Gap,
  mastery: MasteryRecord | null,
  change: { skillId: string; from: number; to: number; note: string | null },
) {
  const db = getDb();
  const saveGap = db.update(gaps).set({ gap }).where(and(eq(gaps.briefId, briefId), eq(gaps.userId, userId)));
  const logIt = db.insert(learnerEvents).values({ userId, type: "skill_corrected", payload: { briefId, ...change } });
  await (mastery
    ? db.batch([
        saveGap,
        logIt,
        db
          .update(skillMastery)
          .set({ level: mastery.level, evidence: mastery.evidence, updatedAt: new Date() })
          .where(and(eq(skillMastery.userId, userId), eq(skillMastery.skillId, mastery.skillId))),
      ])
    : db.batch([saveGap, logIt]));
}

/** Delete everything ABL holds about a learner: every learner table cascades from their user row. */
export async function deleteLearner(userId: string) {
  await getDb().delete(users).where(eq(users.id, userId));
}

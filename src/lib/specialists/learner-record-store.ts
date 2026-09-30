import { and, eq } from "drizzle-orm";

import { getDb, schema } from "@/db";
import type { GoalBrief } from "@/lib/goals/schema";

import { correctGap, type EditableBriefField } from "./corrections";
import type { MasteryRecord } from "./mastery";
import { loadLiveGaps } from "./mastery-store";
import { loadGoalState } from "./store";
import type { Gap } from "./schemas";

const { assessments, careerBriefs, gaps, learnerEvents, learnerProfiles, plans, skillMastery, users } = schema;

/**
 * What ABL holds about a learner for one goal, for them to see: the goal's
 * current brief (the one their plan follows), the profile and gap built from
 * it, and their skills check. Undefined before the goal has a brief.
 */
export async function loadLearnerRecord(userId: string, goalId: string) {
  const db = getDb();
  const brief = (await loadGoalState(userId, goalId))?.brief;
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
    goalId,
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

/**
 * Save a learner's correction to a skill level: this goal's gap, the gap of
 * every other live goal with the skill (their skills are shared), their
 * mastery record if they have one, and the event.
 */
export async function saveSkillCorrection(
  userId: string,
  briefId: string,
  gap: Gap,
  mastery: MasteryRecord | null,
  change: { skillId: string; from: number; to: number; note: string | null },
) {
  const db = getDb();
  const saveGap = db.update(gaps).set({ gap }).where(and(eq(gaps.briefId, briefId), eq(gaps.userId, userId)));
  const others = (await loadLiveGaps(userId)).flatMap((g) => {
    const corrected = g.briefId !== briefId && correctGap(g.gap, change.skillId, change.to);
    return corrected ? [db.update(gaps).set({ gap: corrected }).where(eq(gaps.id, g.id))] : [];
  });
  const logIt = db.insert(learnerEvents).values({ userId, type: "skill_corrected", payload: { briefId, ...change } });
  const saveMastery = mastery
    ? [
        db
          .update(skillMastery)
          .set({ level: mastery.level, evidence: mastery.evidence, updatedAt: new Date() })
          .where(and(eq(skillMastery.userId, userId), eq(skillMastery.skillId, mastery.skillId))),
      ]
    : [];
  await db.batch([saveGap, logIt, ...others, ...saveMastery]);
}

/** Delete everything ABL holds about a learner: every learner table cascades from their user row. */
export async function deleteLearner(userId: string) {
  await getDb().delete(users).where(eq(users.id, userId));
}

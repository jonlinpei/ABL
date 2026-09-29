import { and, count, desc, eq, isNotNull, isNull, ne } from "drizzle-orm";

import { getDb, schema } from "@/db";

import type {
  AssessedSkill,
  Gap,
  LearnerProfile,
  Plan,
  PlanReview,
  SessionReport,
  TargetRequirements,
} from "./schemas";

const {
  assessments,
  careerBriefs,
  targetRequirements,
  learnerProfiles,
  gaps,
  learnerEvents,
  plans,
  sessions,
} = schema;

/** Cached requirements for a target, if another learner already needed them. */
export async function findRequirements(targetKey: string) {
  const [row] = await getDb()
    .select({ id: targetRequirements.id, requirements: targetRequirements.requirements })
    .from(targetRequirements)
    .where(eq(targetRequirements.targetKey, targetKey));
  return row;
}

/**
 * Cache requirements for a target and return the row id. If another learner
 * cached the same target first, theirs wins and is returned.
 */
export async function saveRequirements(targetKey: string, requirements: TargetRequirements) {
  const [inserted] = await getDb()
    .insert(targetRequirements)
    .values({ targetKey, requirements })
    .onConflictDoNothing({ target: targetRequirements.targetKey })
    .returning({ id: targetRequirements.id, requirements: targetRequirements.requirements });
  return inserted ?? (await findRequirements(targetKey))!;
}

/** Save the profile for a brief. A retried step returns the row already saved. */
export async function saveProfile(
  userId: string,
  briefId: string,
  requirementsId: string,
  profile: LearnerProfile,
): Promise<{ id: string }> {
  const db = getDb();
  const [inserted] = await db
    .insert(learnerProfiles)
    .values({ userId, briefId, requirementsId, profile })
    .onConflictDoNothing({ target: learnerProfiles.briefId })
    .returning({ id: learnerProfiles.id });
  if (inserted) return inserted;
  const [existing] = await db
    .select({ id: learnerProfiles.id })
    .from(learnerProfiles)
    .where(eq(learnerProfiles.briefId, briefId));
  return existing!;
}

/** Save the gap for a brief and log `gap_ready`, together. Safe to retry. */
export async function saveGap(userId: string, briefId: string, profileId: string, gap: Gap) {
  const db = getDb();
  const [existing] = await db.select({ id: gaps.id }).from(gaps).where(eq(gaps.briefId, briefId));
  if (existing) return existing;
  const id = crypto.randomUUID();
  await db.batch([
    db.insert(gaps).values({ id, userId, briefId, profileId, gap }),
    db.insert(learnerEvents).values({
      userId,
      type: "gap_ready",
      payload: { briefId, gapId: id, ...gap.counts },
    }),
  ]);
  return { id };
}

/**
 * The learner's newest brief and, once the lifecycle has built them, its gap
 * and newest plan.
 * The skills check always works on the newest brief.
 */
export async function loadLatestBriefAndGap(userId: string) {
  const db = getDb();
  const [brief] = await db
    .select()
    .from(careerBriefs)
    .where(eq(careerBriefs.userId, userId))
    .orderBy(desc(careerBriefs.version))
    .limit(1);
  if (!brief) return undefined;
  const [gap] = await db.select().from(gaps).where(eq(gaps.briefId, brief.id));
  const [plan] = await db
    .select()
    .from(plans)
    // The learner's plan is the newest active one; a proposed replan isn't theirs until accepted.
    .where(and(eq(plans.briefId, brief.id), eq(plans.status, "active")))
    .orderBy(desc(plans.version))
    .limit(1);
  return { brief, gap, plan };
}

/**
 * Save a skills check: the results, the gap with assessed levels, and an
 * `assessment_done` event, together. A brief is checked once; a second
 * submission is ignored and reported as such.
 */
export async function saveAssessment(
  userId: string,
  briefId: string,
  results: AssessedSkill[],
  assessedGap: Gap,
): Promise<{ saved: boolean }> {
  const db = getDb();
  const [existing] = await db
    .select({ id: assessments.id })
    .from(assessments)
    .where(eq(assessments.briefId, briefId));
  if (existing) return { saved: false };
  await db.batch([
    db.insert(assessments).values({ userId, briefId, results }),
    db.update(gaps).set({ gap: assessedGap, assessedAt: new Date() }).where(eq(gaps.briefId, briefId)),
    db.insert(learnerEvents).values({
      userId,
      type: "assessment_done",
      payload: { briefId, skills: results.length, ...assessedGap.counts },
    }),
  ]);
  return { saved: true };
}

/** The gap for a brief as it stands now, assessed levels included. */
export async function loadGap(briefId: string): Promise<Gap> {
  const [row] = await getDb().select({ gap: gaps.gap }).from(gaps).where(eq(gaps.briefId, briefId));
  if (!row) throw new Error(`No gap for brief ${briefId}`);
  return row.gap;
}

/**
 * Save the first plan for a brief and log `plan_published`, together. A
 * retried step finds the plan already saved and returns it.
 */
export async function saveFirstPlan(
  userId: string,
  briefId: string,
  plan: Plan,
  review: PlanReview,
): Promise<{ id: string }> {
  const db = getDb();
  const [existing] = await db
    .select({ id: plans.id })
    .from(plans)
    .where(eq(plans.briefId, briefId))
    .limit(1);
  if (existing) return existing;
  const id = crypto.randomUUID();
  await db.batch([
    db.insert(plans).values({ id, userId, briefId, version: 1, plan, review }),
    db.insert(learnerEvents).values({
      userId,
      type: "plan_published",
      payload: { briefId, planId: id, version: 1, openIssues: review.issues.length },
    }),
  ]);
  return { id };
}

/** A plan's sessions, oldest first: the ended ones are history, an unended one is active. */
export async function loadSessions(planId: string) {
  return getDb().select().from(sessions).where(eq(sessions.planId, planId)).orderBy(sessions.startedAt);
}

/** Start a session on a milestone, or return the one already active for this plan. */
export async function startSession(userId: string, planId: string, milestoneIndex: number) {
  const db = getDb();
  // The partial unique index allows one active session per plan, so a
  // concurrent start inserts nothing and both callers get the same session.
  await db.insert(sessions).values({ userId, planId, milestoneIndex }).onConflictDoNothing();
  const [active] = await db
    .select()
    .from(sessions)
    .where(and(eq(sessions.planId, planId), isNull(sessions.endedAt)))
    .limit(1);
  return active!;
}

/** Keep the transcript current, so a reload resumes where the learner was. */
export async function saveSessionMessages(sessionId: string, userId: string, messages: unknown[]) {
  await getDb()
    .update(sessions)
    .set({ messages })
    .where(and(eq(sessions.id, sessionId), eq(sessions.userId, userId), isNull(sessions.endedAt)));
}

/**
 * End a session with the tutor's report and log `session_completed`,
 * together. Ending twice is a no-op.
 */
export async function endSession(
  sessionId: string,
  userId: string,
  report: SessionReport,
): Promise<{ ended: boolean }> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(sessions)
    .where(and(eq(sessions.id, sessionId), eq(sessions.userId, userId)));
  if (!row || row.endedAt) return { ended: false };
  await db.batch([
    db.update(sessions).set({ report, endedAt: new Date() }).where(eq(sessions.id, sessionId)),
    db.insert(learnerEvents).values({
      userId,
      type: "session_completed",
      payload: {
        sessionId,
        planId: row.planId,
        milestoneIndex: row.milestoneIndex,
        milestoneComplete: report.milestoneComplete,
        endedEarly: report.endedEarly,
        evidence: report.evidence,
      },
    }),
  ]);
  return { ended: true };
}

/**
 * The learner's most recent ended sessions on earlier plans, newest last.
 * A reworked plan starts its own history; these carry homework and context
 * across the change.
 */
export async function loadEarlierSessions(userId: string, currentPlanId: string, limit = 3) {
  const rows = await getDb()
    .select()
    .from(sessions)
    .where(and(eq(sessions.userId, userId), ne(sessions.planId, currentPlanId), isNotNull(sessions.endedAt)))
    .orderBy(desc(sessions.endedAt))
    .limit(limit);
  return rows.filter((r) => r.report).reverse();
}

/** How many sessions the learner has finished, across all their plans. */
export async function countEndedSessions(userId: string): Promise<number> {
  const [row] = await getDb()
    .select({ n: count() })
    .from(sessions)
    .where(and(eq(sessions.userId, userId), isNotNull(sessions.endedAt)));
  return row?.n ?? 0;
}

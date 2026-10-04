import { and, count, desc, eq, gt, inArray, isNotNull, isNull, max, ne, sql } from "drizzle-orm";
import { z } from "zod";

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
import { applyEvidence, spreadMastery } from "./mastery";
import { loadLiveGaps, loadMastery, masteryUpserts } from "./mastery-store";
import type { RequirementsChange } from "./signals";

const {
  assessments,
  careerBriefs,
  goals,
  targetRequirements,
  learnerProfiles,
  gaps,
  learnerEvents,
  plans,
  huddles,
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

/**
 * Cached targets a new learner picked since `since`, with when each was last
 * built or refreshed and whether it's grounded in postings.
 */
export async function loadRefreshCandidates(since: Date) {
  return getDb()
    .selectDistinct({
      id: targetRequirements.id,
      lastBuilt: sql<Date>`coalesce(${targetRequirements.refreshedAt}, ${targetRequirements.createdAt})`.mapWith(
        (v) => new Date(v),
      ),
      grounded: sql<boolean>`${targetRequirements.requirements}->>'groundedAt' is not null`,
    })
    .from(targetRequirements)
    .innerJoin(learnerProfiles, eq(learnerProfiles.requirementsId, targetRequirements.id))
    .where(gt(learnerProfiles.createdAt, since));
}

/** A cached target's requirements, and the newest brief that chose it (for the research prompt). */
export async function loadRequirementsForRefresh(requirementsId: string) {
  const [row] = await getDb()
    .select({ requirements: targetRequirements.requirements, brief: careerBriefs.brief })
    .from(targetRequirements)
    .innerJoin(learnerProfiles, eq(learnerProfiles.requirementsId, targetRequirements.id))
    .innerJoin(careerBriefs, eq(careerBriefs.id, learnerProfiles.briefId))
    .where(eq(targetRequirements.id, requirementsId))
    .orderBy(desc(learnerProfiles.createdAt))
    .limit(1);
  return row;
}

/**
 * Record a refresh attempt, replacing the requirements when there are new
 * ones. Learners' gaps are snapshots, so only learners who start later see
 * the change.
 */
export async function saveRefreshedRequirements(requirementsId: string, requirements: TargetRequirements | null) {
  await getDb()
    .update(targetRequirements)
    .set({ refreshedAt: new Date(), ...(requirements && { requirements }) })
    .where(eq(targetRequirements.id, requirementsId));
}

/**
 * The current gaps built on a cached target: one per live goal (active or
 * paused) whose newest brief chose it, with whether it has an active plan.
 */
export async function loadGapsOnRequirements(requirementsId: string) {
  const db = getDb();
  const rows = await db
    .select({
      gapId: gaps.id,
      userId: gaps.userId,
      briefId: gaps.briefId,
      goalId: careerBriefs.goalId,
      version: careerBriefs.version,
      gap: gaps.gap,
    })
    .from(gaps)
    .innerJoin(learnerProfiles, eq(learnerProfiles.id, gaps.profileId))
    .innerJoin(careerBriefs, eq(careerBriefs.id, gaps.briefId))
    .innerJoin(goals, eq(goals.id, careerBriefs.goalId))
    .where(and(eq(learnerProfiles.requirementsId, requirementsId), inArray(goals.status, ["active", "paused"])));
  if (rows.length === 0) return [];
  const goalIds = [...new Set(rows.map((r) => r.goalId))];
  const newest = new Map(
    (
      await db
        .select({ goalId: careerBriefs.goalId, version: max(careerBriefs.version) })
        .from(careerBriefs)
        .where(inArray(careerBriefs.goalId, goalIds))
        .groupBy(careerBriefs.goalId)
    ).map((r) => [r.goalId, r.version]),
  );
  const current = rows.filter((r) => newest.get(r.goalId) === r.version);
  const active = new Set(
    current.length
      ? (
          await db
            .select({ briefId: plans.briefId })
            .from(plans)
            .where(and(inArray(plans.briefId, current.map((r) => r.briefId)), eq(plans.status, "active")))
        ).map((p) => p.briefId)
      : [],
  );
  return current.map((r) => ({
    gapId: r.gapId,
    userId: r.userId,
    goalId: r.goalId,
    briefId: r.briefId,
    gap: r.gap,
    hasActivePlan: active.has(r.briefId),
  }));
}

/** Save a learner's gap rebased on refreshed requirements, and log the change when they should hear about it. */
export async function saveRebasedGap(
  gapId: string,
  userId: string,
  gap: Gap,
  change: (RequirementsChange & { requirementsId: string; goalId: string }) | null,
) {
  const db = getDb();
  const update = db.update(gaps).set({ gap }).where(eq(gaps.id, gapId));
  await (change
    ? db.batch([update, db.insert(learnerEvents).values({ userId, type: "requirements_changed", payload: { ...change } })])
    : update);
}

/** Requirement changes logged for one of a learner's goals after `since`, oldest first. */
export async function loadRequirementsChanges(userId: string, goalId: string, since: Date | null): Promise<RequirementsChange[]> {
  const rows = await getDb()
    .select({ payload: learnerEvents.payload })
    .from(learnerEvents)
    .where(
      and(
        eq(learnerEvents.userId, userId),
        eq(learnerEvents.type, "requirements_changed"),
        sql`${learnerEvents.payload}->>'goalId' = ${goalId}`,
        ...(since ? [gt(learnerEvents.createdAt, since)] : []),
      ),
    )
    .orderBy(learnerEvents.createdAt);
  return rows.map((r) => r.payload as unknown as RequirementsChange);
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
 * A goal's current state, and any pending version of it.
 *
 * The **current** version is the one the learner is working from: the brief
 * of the goal's newest active plan, with that brief's gap. Before the goal
 * has a plan, it's the newest brief. A newer brief confirmed since then is
 * **pending**: it's being built or reworked, or waiting for the learner to
 * choose between its plan and the current one. Declined versions are
 * history and never current or pending.
 */
export async function loadGoalState(userId: string, goalId: string) {
  const db = getDb();
  const briefs = await db
    .select()
    .from(careerBriefs)
    .where(and(eq(careerBriefs.goalId, goalId), eq(careerBriefs.userId, userId), isNull(careerBriefs.declinedAt)))
    .orderBy(desc(careerBriefs.version));
  if (!briefs.length) return undefined;
  const [plan] = await db
    .select()
    .from(plans)
    // The learner's plan is the newest active one; a proposed plan isn't theirs until accepted.
    .where(and(inArray(plans.briefId, briefs.map((b) => b.id)), eq(plans.status, "active")))
    .orderBy(desc(plans.createdAt))
    .limit(1);
  const brief = (plan && briefs.find((b) => b.id === plan.briefId)) || briefs[0]!;
  const newest = briefs[0]!;
  const gapRows = await db
    .select()
    .from(gaps)
    .where(inArray(gaps.briefId, [...new Set([brief.id, newest.id])]));
  const gapOf = (briefId: string) => gapRows.find((g) => g.briefId === briefId);
  const pending = newest.id !== brief.id ? { brief: newest, gap: gapOf(newest.id) } : null;
  return { brief, gap: gapOf(brief.id), plan, pending };
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
  const now = new Date();
  const writes = await checkMasteryWrites(userId, results, assessedGap, briefId, now);
  await db.batch([
    db.insert(assessments).values({ userId, briefId, results }),
    db.update(gaps).set({ gap: assessedGap, assessedAt: now }).where(eq(gaps.briefId, briefId)),
    db.insert(learnerEvents).values({
      userId,
      type: "assessment_done",
      payload: { briefId, skills: results.length, ...assessedGap.counts },
    }),
    ...writes,
  ]);
  return { saved: true };
}

/**
 * Writes that make a skills check's results mastery evidence: each checked
 * skill's record (a first record starts at the level shown; practised skills
 * weigh it as more evidence), and every other live goal's gap with those
 * skills. Results then follow the learner into other goals and later
 * versions, instead of being checked again.
 */
export async function checkMasteryWrites(userId: string, results: AssessedSkill[], gap: Gap, exceptBriefId: string | null, now: Date) {
  const db = getDb();
  const known = new Map((await loadMastery(userId, results.map((r) => r.skillId))).map((r) => [r.skillId, r]));
  const records = results.map((r) =>
    applyEvidence({
      record: known.get(r.skillId),
      skillId: r.skillId,
      name: gap.items.find((i) => i.skillId === r.skillId)?.name ?? r.skillId,
      startingLevel: r.level,
      entry: { level: r.level, evidence: r.evidence, source: "assessment", at: now.toISOString() },
      now,
    }),
  );
  const others = spreadMastery(
    (await loadLiveGaps(userId)).filter((g) => g.briefId !== exceptBriefId),
    records,
  ).map((g) => db.update(gaps).set({ gap: g.gap }).where(eq(gaps.id, g.id)));
  return [...masteryUpserts(userId, records, now), ...others];
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

/** Plans built for a goal, across its brief versions: sessions on them are that goal's history. */
function goalPlanIds(goalId: string) {
  return getDb()
    .select({ id: plans.id })
    .from(plans)
    .innerJoin(careerBriefs, eq(careerBriefs.id, plans.briefId))
    .where(eq(careerBriefs.goalId, goalId));
}

/**
 * The learner's most recent ended sessions on this goal's earlier plans,
 * newest last. A reworked plan starts its own history; these carry homework
 * and context across the change. Other goals' sessions never carry over.
 */
export async function loadEarlierSessions(userId: string, goalId: string, currentPlanId: string, limit = 3) {
  const rows = await getDb()
    .select()
    .from(sessions)
    .where(
      and(
        eq(sessions.userId, userId),
        inArray(sessions.planId, goalPlanIds(goalId)),
        ne(sessions.planId, currentPlanId),
        isNotNull(sessions.endedAt),
      ),
    )
    .orderBy(desc(sessions.endedAt))
    .limit(limit);
  return rows.filter((r) => r.report).reverse();
}

/** How many sessions the learner has finished on this goal, across its plans. */
export async function countEndedSessions(userId: string, goalId: string): Promise<number> {
  const [row] = await getDb()
    .select({ n: count() })
    .from(sessions)
    .where(and(eq(sessions.userId, userId), inArray(sessions.planId, goalPlanIds(goalId)), isNotNull(sessions.endedAt)));
  return row?.n ?? 0;
}

/** The goal a learner's session belongs to, through its plan and brief. */
export async function goalOfSession(userId: string, sessionId: string): Promise<string | undefined> {
  if (!z.uuid().safeParse(sessionId).success) return undefined;
  const [row] = await getDb()
    .select({ goalId: careerBriefs.goalId })
    .from(sessions)
    .innerJoin(plans, eq(plans.id, sessions.planId))
    .innerJoin(careerBriefs, eq(careerBriefs.id, plans.briefId))
    .where(and(eq(sessions.id, sessionId), eq(sessions.userId, userId)));
  return row?.goalId;
}

/** When the learner accepted reworks of this goal's plan (not new versions of the goal), oldest first. */
export async function loadAcceptedReworks(goalId: string): Promise<Date[]> {
  const rows = await getDb()
    .select({ at: huddles.decidedAt })
    .from(huddles)
    .where(and(inArray(huddles.fromPlanId, goalPlanIds(goalId)), eq(huddles.status, "accepted"), isNull(huddles.toBriefId)))
    .orderBy(huddles.decidedAt);
  return rows.flatMap((r) => (r.at ? [r.at] : []));
}

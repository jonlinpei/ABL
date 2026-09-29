import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { sql } from "drizzle-orm";

import type { GoalBrief } from "@/lib/goals/schema";
import type { EvidenceEntry, StoredCard } from "@/lib/specialists/mastery";
import type { Signal } from "@/lib/specialists/signals";
import type {
  AssessedSkill,
  Gap,
  LearnerProfile,
  Plan,
  HuddleMessage,
  PlanReview,
  ReplanRequest,
  SessionReport,
  TargetRequirements,
} from "@/lib/specialists/schemas";

/**
 * App-side user record. Clerk owns identity (email, name, sessions); this row
 * exists so domain tables have a local foreign key. Keyed by the Clerk user id
 * (e.g. "user_2abc...").
 *
 * The learner record grows one specialist at a time (docs/architecture.md,
 * "Agent architecture"). It starts with confirmed briefs and the event log.
 */
export const users = pgTable("users", {
  id: text("id").primaryKey(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;

/**
 * Every career brief the learner confirmed, newest version last. A changed
 * goal adds a version rather than editing the old one, so plans can say which
 * brief they were built from.
 */
export const careerBriefs = pgTable(
  "career_briefs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    brief: jsonb("brief").$type<GoalBrief>().notNull(),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("career_briefs_user_version").on(t.userId, t.version)],
);

export type CareerBriefRow = typeof careerBriefs.$inferSelect;

/** Event types on the learner record. Specialists and the orchestrator react to these. */
export const LEARNER_EVENT_TYPES = [
  "brief_confirmed",
  "gap_ready",
  "assessment_done",
  "plan_published",
  "session_completed",
  "mastery_updated",
  "coach_noted",
  "replan_suggested",
  "replan_requested",
  "plan_proposed",
  "plan_accepted",
  "plan_declined",
] as const;
export type LearnerEventType = (typeof LEARNER_EVENT_TYPES)[number];

/**
 * Append-only log of what happened to a learner. The orchestrator and the
 * adaptation loop's signal detectors read it; nothing edits past rows.
 */
export const learnerEvents = pgTable(
  "learner_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").$type<LearnerEventType>().notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("learner_events_user_created").on(t.userId, t.createdAt)],
);

export type LearnerEvent = typeof learnerEvents.$inferSelect;

/**
 * What a target role, market and industry require. Shared: one row per
 * target key, reused by every learner aiming there (the requirements
 * analyst's cache).
 */
export const targetRequirements = pgTable("target_requirements", {
  id: uuid("id").primaryKey().defaultRandom(),
  targetKey: text("target_key").notNull().unique(),
  requirements: jsonb("requirements").$type<TargetRequirements>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  /** Last refresh attempt, successful or not (see `refreshRequirements`). */
  refreshedAt: timestamp("refreshed_at", { withTimezone: true }),
});

/** The profiler's estimate of a learner's skills, for one brief version. */
export const learnerProfiles = pgTable("learner_profiles", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  briefId: uuid("brief_id")
    .notNull()
    .unique()
    .references(() => careerBriefs.id, { onDelete: "cascade" }),
  requirementsId: uuid("requirements_id")
    .notNull()
    .references(() => targetRequirements.id),
  profile: jsonb("profile").$type<LearnerProfile>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Requirements minus profile for one brief version: what the plan has to close. */
export const gaps = pgTable("gaps", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  briefId: uuid("brief_id")
    .notNull()
    .unique()
    .references(() => careerBriefs.id, { onDelete: "cascade" }),
  profileId: uuid("profile_id")
    .notNull()
    .references(() => learnerProfiles.id, { onDelete: "cascade" }),
  gap: jsonb("gap").$type<Gap>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  /** Set when the skills check replaced estimates with assessed levels. */
  assessedAt: timestamp("assessed_at", { withTimezone: true }),
});

/** A skills check: what the Assessor recorded for each skill it checked. */
export const assessments = pgTable("assessments", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  briefId: uuid("brief_id")
    .notNull()
    .unique()
    .references(() => careerBriefs.id, { onDelete: "cascade" }),
  results: jsonb("results").$type<AssessedSkill[]>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Learning plans for a brief, newest version last. Replans add a version, so
 * the learner's history and the reasons for each change stay visible.
 */
export const plans = pgTable(
  "plans",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    briefId: uuid("brief_id")
      .notNull()
      .references(() => careerBriefs.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    plan: jsonb("plan").$type<Plan>().notNull(),
    /** The final review: code checks plus the reviewer, with anything still open. */
    review: jsonb("review").$type<PlanReview>().notNull(),
    /**
     * Only the newest active plan is the learner's. A replan is "proposed"
     * until they accept it (the old one becomes "superseded") or keep their
     * current plan ("declined").
     */
    status: text("status").$type<"active" | "proposed" | "superseded" | "declined">().notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("plans_brief_version").on(t.briefId, t.version)],
);

export type PlanRow = typeof plans.$inferSelect;

/**
 * Tutoring sessions on a plan. One is active (not ended) at a time. The
 * transcript is kept so a reload or a closed tab doesn't lose the session;
 * the report is what the tutor recorded when it ended.
 */
export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    planId: uuid("plan_id")
      .notNull()
      .references(() => plans.id, { onDelete: "cascade" }),
    milestoneIndex: integer("milestone_index").notNull(),
    messages: jsonb("messages").$type<unknown[]>().notNull().default([]),
    report: jsonb("report").$type<SessionReport>(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    /** Set when the mastery keeper applied this session's evidence, so it's applied once. */
    masteryAppliedAt: timestamp("mastery_applied_at", { withTimezone: true }),
  },
  (t) => [
    index("sessions_user_started").on(t.userId, t.startedAt),
    // At most one active session per plan, even if Start is clicked twice.
    uniqueIndex("sessions_one_active_per_plan").on(t.planId).where(sql`${t.endedAt} is null`),
  ],
);

export type SessionRow = typeof sessions.$inferSelect;

/**
 * What the learner knows, skill by skill, across goals: the current level,
 * recent evidence and the FSRS review card. `due` mirrors the card's due
 * date so "due for review" is a simple indexed query.
 */
export const skillMastery = pgTable(
  "skill_mastery",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    skillId: text("skill_id").notNull(),
    name: text("name").notNull(),
    level: integer("level").notNull(),
    evidence: jsonb("evidence").$type<EvidenceEntry[]>().notNull(),
    card: jsonb("card").$type<StoredCard>().notNull(),
    due: timestamp("due", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex("skill_mastery_user_skill").on(t.userId, t.skillId),
    index("skill_mastery_user_due").on(t.userId, t.due),
  ],
);

export type SkillMasteryRow = typeof skillMastery.$inferSelect;

/**
 * What the coach decided about a set of signals: a check-in for the learner
 * (with the options they can tap), a note for the tutor's next session,
 * and whether to suggest a replan.
 */
export const coachNotes = pgTable(
  "coach_notes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    planId: uuid("plan_id")
      .notNull()
      .references(() => plans.id, { onDelete: "cascade" }),
    signals: jsonb("signals").$type<Signal[]>().notNull(),
    message: text("message"),
    options: jsonb("options").$type<string[]>().notNull().default([]),
    tutorNote: text("tutor_note"),
    suggestReplan: boolean("suggest_replan").notNull().default(false),
    reason: text("reason").notNull(),
    /** The option the learner tapped, if any. */
    response: text("response"),
    respondedAt: timestamp("responded_at", { withTimezone: true }),
    dismissedAt: timestamp("dismissed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("coach_notes_user_created").on(t.userId, t.createdAt)],
);

export type CoachNoteRow = typeof coachNotes.$inferSelect;

/**
 * A replan huddle: what triggered it, every typed message the specialists
 * exchanged, and the plan it proposed. Kept so any change can be explained.
 */
export const huddles = pgTable(
  "huddles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    fromPlanId: uuid("from_plan_id")
      .notNull()
      .references(() => plans.id, { onDelete: "cascade" }),
    proposedPlanId: uuid("proposed_plan_id").references(() => plans.id, { onDelete: "set null" }),
    request: jsonb("request").$type<ReplanRequest>().notNull(),
    messages: jsonb("messages").$type<HuddleMessage[]>().notNull().default([]),
    status: text("status").$type<"running" | "proposed" | "accepted" | "declined" | "failed">().notNull().default("running"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
  },
  (t) => [
    index("huddles_user_created").on(t.userId, t.createdAt),
    // One huddle at a time per plan: a second request waits for the first to be decided.
    uniqueIndex("huddles_one_open_per_plan").on(t.fromPlanId).where(sql`${t.status} in ('running', 'proposed')`),
  ],
);

export type HuddleRow = typeof huddles.$inferSelect;

import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  real,
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

export const GOAL_STATUSES = ["active", "paused", "completed", "removed"] as const;
export type GoalStatus = (typeof GOAL_STATUSES)[number];

/**
 * One thing the learner is working toward, like a course on Duolingo. A
 * learner can pursue several at once and switch between them; their skills
 * (`skill_mastery`) are shared across all of them. A goal's title comes from
 * its newest brief.
 *
 * A removed goal waits 30 days before it's purged (with everything built for
 * it), so it can be restored. Purging never touches skills.
 */
export const goals = pgTable(
  "goals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    status: text("status").$type<GoalStatus>().notNull().default("active"),
    /** What a removed goal was before, so restoring puts it back. */
    statusBefore: text("status_before").$type<Exclude<GoalStatus, "removed">>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastOpenedAt: timestamp("last_opened_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    removedAt: timestamp("removed_at", { withTimezone: true }),
  },
  (t) => [
    index("goals_user_opened").on(t.userId, t.lastOpenedAt),
    index("goals_status_removed").on(t.status, t.removedAt),
  ],
);

export type GoalRow = typeof goals.$inferSelect;

/**
 * Every career brief the learner confirmed for a goal, newest version last.
 * Changing a goal adds a version rather than editing the old one, so plans
 * can say which brief they were built from.
 */
export const careerBriefs = pgTable(
  "career_briefs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    goalId: uuid("goal_id")
      .notNull()
      .references(() => goals.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    brief: jsonb("brief").$type<GoalBrief>().notNull(),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }).notNull().defaultNow(),
    /**
     * Set when the learner kept their current plan instead of this version's,
     * or confirmed a newer version before this one was ready. A declined
     * version is history, never the goal's current or pending brief.
     */
    declinedAt: timestamp("declined_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("career_briefs_goal_version").on(t.goalId, t.version)],
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
  "requirements_changed",
  "brief_edited",
  "skill_corrected",
  "goal_status_changed",
  "goal_purged",
  "side_quest_started",
  "side_quest_done",
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
    /** Set for a side-quest session: it teaches the quest, not a milestone, and doesn't advance the plan. */
    sideQuestId: uuid("side_quest_id"),
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
    /** Set when the proposal is for a new version of the goal's brief, not a rework of the same one. */
    toBriefId: uuid("to_brief_id").references(() => careerBriefs.id, { onDelete: "cascade" }),
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

/**
 * Sidekicks (PRD F3): quick side questions during a session, kept out of the
 * lesson's transcript. When one closes it's summarized for the tutor, with
 * the term it explained (for the glossary later) and whether they struggled.
 */
export const sidekicks = pgTable(
  "sidekicks",
  {
    /** The client's chat id. */
    id: uuid("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    messages: jsonb("messages").$type<unknown[]>().notNull().default([]),
    summary: text("summary"),
    term: text("term"),
    definition: text("definition"),
    skillId: text("skill_id"),
    struggled: boolean("struggled"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    closedAt: timestamp("closed_at", { withTimezone: true }),
  },
  (t) => [index("sidekicks_session_created").on(t.sessionId, t.createdAt)],
);

export type SidekickRow = typeof sidekicks.$inferSelect;

/**
 * The learner's glossary (PRD F6): one row per sense, a term in a field, so
 * "leverage (finance)" and "leverage (physics)" are separate entries under
 * one headword. Filled from sidekicks, session reports and terms the learner
 * adds.
 */
export const glossaryTerms = pgTable(
  "glossary_terms",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** As first written, e.g. "LEFT JOIN". */
    headword: text("headword").notNull(),
    /** Normalized for matching, e.g. "left join". */
    headKey: text("head_key").notNull(),
    /** A broad field in a few words, e.g. "finance" or "data analysis". */
    domain: text("domain").notNull(),
    domainKey: text("domain_key").notNull(),
    definition: text("definition").notNull(),
    skillId: text("skill_id"),
    /** The brief (goal) the term first came up under. */
    briefId: uuid("brief_id").references(() => careerBriefs.id, { onDelete: "set null" }),
    source: text("source").$type<"sidekick" | "session" | "learner">().notNull(),
    timesSeen: integer("times_seen").notNull().default(1),
    struggled: boolean("struggled").notNull().default(false),
    /** The learner marked it as known. */
    known: boolean("known").notNull().default(false),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("glossary_terms_sense").on(t.userId, t.headKey, t.domainKey)],
);

export type GlossaryTermRow = typeof glossaryTerms.$inferSelect;

/**
 * A short skills check after a milestone (PRD story 12): the learner proves
 * to themselves they've improved. Offered once per milestone on a plan;
 * taken (results) or skipped. `before` holds their levels as the check began,
 * for the before-and-after.
 */
export const milestoneChecks = pgTable(
  "milestone_checks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    planId: uuid("plan_id")
      .notNull()
      .references(() => plans.id, { onDelete: "cascade" }),
    milestoneIndex: integer("milestone_index").notNull(),
    before: jsonb("before").$type<{ skillId: string; level: number }[]>().notNull().default([]),
    results: jsonb("results").$type<AssessedSkill[]>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    skippedAt: timestamp("skipped_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("milestone_checks_plan_milestone").on(t.planId, t.milestoneIndex)],
);

/**
 * A side quest (PRD story 13): a short detour into a related topic, in a
 * few sessions of its own. The learner chooses before starting whether it
 * uses their plan time (the finish moves by `planWeeks`) or extra time (it
 * doesn't). One open at a time per goal.
 */
export const sideQuests = pgTable(
  "side_quests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    goalId: uuid("goal_id")
      .notNull()
      .references(() => goals.id, { onDelete: "cascade" }),
    topic: text("topic").notNull(),
    title: text("title").notNull(),
    why: text("why").notNull(),
    outline: jsonb("outline").$type<string[]>().notNull(),
    sessions: integer("sessions").notNull(),
    /** The skill it builds: one from the goal's gap, or a new related one. */
    skillId: text("skill_id").notNull(),
    skillName: text("skill_name").notNull(),
    relevance: text("relevance").$type<"core" | "related" | "tangent">().notNull(),
    /** Weeks the finish moves if it uses plan time, from their session length and hours. */
    planWeeks: real("plan_weeks").notNull(),
    mode: text("mode").$type<"plan_time" | "extra">(),
    status: text("status").$type<"proposed" | "active" | "done" | "dropped">().notNull().default("proposed"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    endedAt: timestamp("ended_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("side_quests_one_open_per_goal").on(t.goalId).where(sql`${t.status} in ('proposed', 'active')`)],
);
export type SideQuestRow = typeof sideQuests.$inferSelect;

/**
 * When a learner wants reminders (PRD story 11): on these days, at this
 * local time, ABL runs their coach check and emails their next step and any
 * check-in. Off until they turn it on; unsubscribing turns it off.
 */
export const reminderPrefs = pgTable("reminder_prefs", {
  userId: text("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  enabled: boolean("enabled").notNull().default(false),
  /** Local weekdays, 0 (Sunday) to 6. */
  days: integer("days").array().notNull().default([]),
  /** Local time, "HH:MM". */
  time: text("time").notNull().default("19:00"),
  /** IANA time zone, e.g. "America/Los_Angeles". */
  timeZone: text("time_zone").notNull().default("America/Los_Angeles"),
  /** The local date of the last reminder sent, so one goes out a day at most. */
  lastSentOn: text("last_sent_on"),
  unsubscribedAt: timestamp("unsubscribed_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
export type ReminderPrefs = typeof reminderPrefs.$inferSelect;

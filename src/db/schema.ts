import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import type { GoalBrief } from "@/lib/goals/schema";
import type { Gap, LearnerProfile, TargetRequirements } from "@/lib/specialists/schemas";

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
export const LEARNER_EVENT_TYPES = ["brief_confirmed", "gap_ready"] as const;
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
});

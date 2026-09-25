import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * App-side user record. Clerk owns identity (email, name, sessions); this row
 * exists so domain tables have a local foreign key. Keyed by the Clerk user id
 * (e.g. "user_2abc...").
 *
 * The learning domain (goals, roadmap, mastery graph, glossary) is deliberately
 * not modelled yet: content sourcing is still undecided. See docs/architecture.md.
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

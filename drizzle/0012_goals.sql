CREATE TABLE "goals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"status_before" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"removed_at" timestamp with time zone
);
--> statement-breakpoint
DROP INDEX "career_briefs_user_version";--> statement-breakpoint
ALTER TABLE "career_briefs" ADD COLUMN "goal_id" uuid;--> statement-breakpoint
-- Backfill: each learner's existing briefs become one active goal, so nothing changes for them.
INSERT INTO "goals" ("user_id", "created_at", "last_opened_at")
SELECT "user_id", min("confirmed_at"), max("confirmed_at") FROM "career_briefs" GROUP BY "user_id";--> statement-breakpoint
UPDATE "career_briefs" SET "goal_id" = "goals"."id" FROM "goals" WHERE "goals"."user_id" = "career_briefs"."user_id";--> statement-breakpoint
ALTER TABLE "career_briefs" ALTER COLUMN "goal_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "goals" ADD CONSTRAINT "goals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "goals_user_opened" ON "goals" USING btree ("user_id","last_opened_at");--> statement-breakpoint
CREATE INDEX "goals_status_removed" ON "goals" USING btree ("status","removed_at");--> statement-breakpoint
ALTER TABLE "career_briefs" ADD CONSTRAINT "career_briefs_goal_id_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."goals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "career_briefs_goal_version" ON "career_briefs" USING btree ("goal_id","version");
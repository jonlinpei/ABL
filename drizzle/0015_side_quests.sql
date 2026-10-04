CREATE TABLE "side_quests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"goal_id" uuid NOT NULL,
	"topic" text NOT NULL,
	"title" text NOT NULL,
	"why" text NOT NULL,
	"outline" jsonb NOT NULL,
	"sessions" integer NOT NULL,
	"skill_id" text NOT NULL,
	"skill_name" text NOT NULL,
	"relevance" text NOT NULL,
	"plan_weeks" real NOT NULL,
	"mode" text,
	"status" text DEFAULT 'proposed' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "side_quest_id" uuid;--> statement-breakpoint
ALTER TABLE "side_quests" ADD CONSTRAINT "side_quests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "side_quests" ADD CONSTRAINT "side_quests_goal_id_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."goals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "side_quests_one_open_per_goal" ON "side_quests" USING btree ("goal_id") WHERE "side_quests"."status" in ('proposed', 'active');
CREATE TABLE "skill_mastery" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"skill_id" text NOT NULL,
	"name" text NOT NULL,
	"level" integer NOT NULL,
	"evidence" jsonb NOT NULL,
	"card" jsonb NOT NULL,
	"due" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "mastery_applied_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "skill_mastery" ADD CONSTRAINT "skill_mastery_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "skill_mastery_user_skill" ON "skill_mastery" USING btree ("user_id","skill_id");--> statement-breakpoint
CREATE INDEX "skill_mastery_user_due" ON "skill_mastery" USING btree ("user_id","due");
CREATE TABLE "milestone_checks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"plan_id" uuid NOT NULL,
	"milestone_index" integer NOT NULL,
	"before" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"results" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"skipped_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "milestone_checks" ADD CONSTRAINT "milestone_checks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "milestone_checks" ADD CONSTRAINT "milestone_checks_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "milestone_checks_plan_milestone" ON "milestone_checks" USING btree ("plan_id","milestone_index");
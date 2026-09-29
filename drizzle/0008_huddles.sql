CREATE TABLE "huddles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"from_plan_id" uuid NOT NULL,
	"proposed_plan_id" uuid,
	"request" jsonb NOT NULL,
	"messages" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "status" text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "huddles" ADD CONSTRAINT "huddles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "huddles" ADD CONSTRAINT "huddles_from_plan_id_plans_id_fk" FOREIGN KEY ("from_plan_id") REFERENCES "public"."plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "huddles" ADD CONSTRAINT "huddles_proposed_plan_id_plans_id_fk" FOREIGN KEY ("proposed_plan_id") REFERENCES "public"."plans"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "huddles_user_created" ON "huddles" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "huddles_one_open_per_plan" ON "huddles" USING btree ("from_plan_id") WHERE "huddles"."status" in ('running', 'proposed');
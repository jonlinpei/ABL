CREATE TABLE "coach_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"plan_id" uuid NOT NULL,
	"signals" jsonb NOT NULL,
	"message" text,
	"options" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"tutor_note" text,
	"suggest_replan" boolean DEFAULT false NOT NULL,
	"reason" text NOT NULL,
	"response" text,
	"responded_at" timestamp with time zone,
	"dismissed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "coach_notes" ADD CONSTRAINT "coach_notes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coach_notes" ADD CONSTRAINT "coach_notes_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "coach_notes_user_created" ON "coach_notes" USING btree ("user_id","created_at");
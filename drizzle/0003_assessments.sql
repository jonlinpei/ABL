CREATE TABLE "assessments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"brief_id" uuid NOT NULL,
	"results" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assessments_brief_id_unique" UNIQUE("brief_id")
);
--> statement-breakpoint
ALTER TABLE "gaps" ADD COLUMN "assessed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "assessments" ADD CONSTRAINT "assessments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessments" ADD CONSTRAINT "assessments_brief_id_career_briefs_id_fk" FOREIGN KEY ("brief_id") REFERENCES "public"."career_briefs"("id") ON DELETE cascade ON UPDATE no action;
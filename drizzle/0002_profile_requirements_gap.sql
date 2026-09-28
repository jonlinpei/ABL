CREATE TABLE "gaps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"brief_id" uuid NOT NULL,
	"profile_id" uuid NOT NULL,
	"gap" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gaps_brief_id_unique" UNIQUE("brief_id")
);
--> statement-breakpoint
CREATE TABLE "learner_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"brief_id" uuid NOT NULL,
	"requirements_id" uuid NOT NULL,
	"profile" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "learner_profiles_brief_id_unique" UNIQUE("brief_id")
);
--> statement-breakpoint
CREATE TABLE "target_requirements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"target_key" text NOT NULL,
	"requirements" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "target_requirements_target_key_unique" UNIQUE("target_key")
);
--> statement-breakpoint
ALTER TABLE "gaps" ADD CONSTRAINT "gaps_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gaps" ADD CONSTRAINT "gaps_brief_id_career_briefs_id_fk" FOREIGN KEY ("brief_id") REFERENCES "public"."career_briefs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gaps" ADD CONSTRAINT "gaps_profile_id_learner_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."learner_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learner_profiles" ADD CONSTRAINT "learner_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learner_profiles" ADD CONSTRAINT "learner_profiles_brief_id_career_briefs_id_fk" FOREIGN KEY ("brief_id") REFERENCES "public"."career_briefs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learner_profiles" ADD CONSTRAINT "learner_profiles_requirements_id_target_requirements_id_fk" FOREIGN KEY ("requirements_id") REFERENCES "public"."target_requirements"("id") ON DELETE no action ON UPDATE no action;
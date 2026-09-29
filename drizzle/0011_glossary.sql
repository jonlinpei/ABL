CREATE TABLE "glossary_terms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"headword" text NOT NULL,
	"head_key" text NOT NULL,
	"domain" text NOT NULL,
	"domain_key" text NOT NULL,
	"definition" text NOT NULL,
	"skill_id" text,
	"brief_id" uuid,
	"source" text NOT NULL,
	"times_seen" integer DEFAULT 1 NOT NULL,
	"struggled" boolean DEFAULT false NOT NULL,
	"known" boolean DEFAULT false NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "glossary_terms" ADD CONSTRAINT "glossary_terms_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "glossary_terms" ADD CONSTRAINT "glossary_terms_brief_id_career_briefs_id_fk" FOREIGN KEY ("brief_id") REFERENCES "public"."career_briefs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "glossary_terms_sense" ON "glossary_terms" USING btree ("user_id","head_key","domain_key");
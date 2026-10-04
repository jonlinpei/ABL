CREATE TABLE "reminder_prefs" (
	"user_id" text PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"days" integer[] DEFAULT '{}' NOT NULL,
	"time" text DEFAULT '19:00' NOT NULL,
	"time_zone" text DEFAULT 'America/Los_Angeles' NOT NULL,
	"last_sent_on" text,
	"unsubscribed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "reminder_prefs" ADD CONSTRAINT "reminder_prefs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
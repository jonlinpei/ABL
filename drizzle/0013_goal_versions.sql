ALTER TABLE "career_briefs" ADD COLUMN "declined_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "huddles" ADD COLUMN "to_brief_id" uuid;--> statement-breakpoint
ALTER TABLE "huddles" ADD CONSTRAINT "huddles_to_brief_id_career_briefs_id_fk" FOREIGN KEY ("to_brief_id") REFERENCES "public"."career_briefs"("id") ON DELETE cascade ON UPDATE no action;
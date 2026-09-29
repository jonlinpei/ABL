import { auth } from "@clerk/nextjs/server";
import { z } from "zod";

import { isDatabaseConfigured } from "@/db";
import { GoalBriefSchema } from "@/lib/goals/schema";
import { editBrief, type EditableBriefField } from "@/lib/specialists/corrections";
import { loadLearnerRecord, saveBriefDetails } from "@/lib/specialists/learner-record-store";

/** Only fields that shape how ABL teaches; hours, deadline and the goal itself change through a replan or a new goal. */
const Details = GoalBriefSchema.pick({
  interests: true,
  priority: true,
  preferredTimes: true,
  motivation: true,
  successLooksLike: true,
  pastAttempts: true,
})
  .extend({ strengths: GoalBriefSchema.shape.current.shape.strengths })
  .partial()
  .strict()
  .refine((d) => Object.keys(d).length > 0, "Nothing to change.");

const Body = z.object({ details: Details });

/** The learner edits details of their brief in place. The tutor and coach use them from the next session. */
export async function PATCH(req: Request) {
  const { userId } = await auth();
  if (!userId) return new Response("Unauthorized", { status: 401 });
  if (!isDatabaseConfigured()) return Response.json({ error: "No database is configured." }, { status: 503 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid request", issues: parsed.error.issues }, { status: 400 });

  const record = await loadLearnerRecord(userId);
  if (!record) return Response.json({ error: "No goal yet." }, { status: 409 });
  const brief = GoalBriefSchema.parse(editBrief(record.brief, parsed.data.details));
  await saveBriefDetails(userId, record.briefId, brief, Object.keys(parsed.data.details) as EditableBriefField[]);
  return Response.json({ brief });
}

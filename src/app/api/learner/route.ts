import { auth } from "@clerk/nextjs/server";
import { z } from "zod";

import { isDatabaseConfigured } from "@/db";
import { inngest } from "@/inngest/client";
import { learnerDataDeleted } from "@/inngest/events";
import { deleteLearner, loadLearnerRecord } from "@/lib/specialists/learner-record-store";
import type { MasteryRecord } from "@/lib/specialists/mastery";
import { loadMastery } from "@/lib/specialists/mastery-store";

export type LearnerRecord = NonNullable<Awaited<ReturnType<typeof loadLearnerRecord>>> & {
  /** Evidence from sessions and corrections, per skill; review schedules left out. */
  mastery: Pick<MasteryRecord, "skillId" | "name" | "level" | "evidence">[];
};

/** Everything ABL holds about the learner, for "What ABL knows about me". */
export async function GET() {
  const { userId } = await auth();
  if (!userId) return new Response("Unauthorized", { status: 401 });
  if (!isDatabaseConfigured()) return Response.json({ error: "No database is configured." }, { status: 503 });
  const record = await loadLearnerRecord(userId);
  if (!record) return Response.json({ error: "No goal yet." }, { status: 404 });
  const mastery = (await loadMastery(userId)).map(({ skillId, name, level, evidence }) => ({ skillId, name, level, evidence }));
  return Response.json({ ...record, mastery } satisfies LearnerRecord);
}

const DeleteBody = z.object({ confirm: z.literal("delete") });

/**
 * Delete everything ABL holds about the learner. Their sign-in account stays.
 * Background work for them is cancelled first, so nothing recreates rows.
 */
export async function DELETE(req: Request) {
  const { userId } = await auth();
  if (!userId) return new Response("Unauthorized", { status: 401 });
  if (!isDatabaseConfigured()) return Response.json({ error: "No database is configured." }, { status: 503 });
  const parsed = DeleteBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: 'Confirm with "delete".' }, { status: 400 });
  try {
    await inngest.send(learnerDataDeleted.create({ userId }));
  } catch (err) {
    // Deleting matters more than cancelling: runs for a deleted learner find no rows and stop.
    console.error("[learner] couldn't cancel background work", err);
  }
  await deleteLearner(userId);
  return Response.json({ deleted: true });
}

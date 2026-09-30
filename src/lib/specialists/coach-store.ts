import { and, desc, eq, gt, isNull, isNotNull } from "drizzle-orm";

import { getDb, schema } from "@/db";

import type { CoachDecision } from "./coach";
import type { Signal } from "./signals";

const { coachNotes, learnerEvents } = schema;

/** The learner's coach notes on a plan, oldest first. */
export async function loadCoachNotes(planId: string) {
  return getDb().select().from(coachNotes).where(eq(coachNotes.planId, planId)).orderBy(coachNotes.createdAt);
}

/** Save the coach's decision and log it; a suggested replan is its own event for the replan step. */
export async function saveCoachNote(
  userId: string,
  planId: string,
  signals: Signal[],
  decision: CoachDecision,
): Promise<{ id: string }> {
  const db = getDb();
  const id = crypto.randomUUID();
  const events = [
    db.insert(learnerEvents).values({
      userId,
      type: "coach_noted",
      payload: { noteId: id, planId, signals: signals.map((s) => s.kind), checkIn: !!decision.message, tutorNote: !!decision.tutorNote },
    }),
    ...(decision.suggestReplan
      ? [db.insert(learnerEvents).values({ userId, type: "replan_suggested", payload: { noteId: id, planId, reason: decision.reason } })]
      : []),
  ];
  await db.batch([
    db.insert(coachNotes).values({
      id,
      userId,
      planId,
      signals,
      message: decision.message,
      options: decision.options,
      tutorNote: decision.tutorNote,
      suggestReplan: decision.suggestReplan,
      reason: decision.reason,
    }),
    ...events,
  ]);
  return { id };
}

/** The newest check-in on this plan the learner hasn't answered or dismissed. */
export async function openCheckIn(userId: string, planId: string) {
  const [row] = await getDb()
    .select()
    .from(coachNotes)
    .where(
      and(
        eq(coachNotes.userId, userId),
        eq(coachNotes.planId, planId),
        isNotNull(coachNotes.message),
        isNull(coachNotes.respondedAt),
        isNull(coachNotes.dismissedAt),
      ),
    )
    .orderBy(desc(coachNotes.createdAt))
    .limit(1);
  return row;
}

/** Record the option the learner tapped, or a dismissal (`choice` null). Only their own open note. */
export async function respondToCheckIn(userId: string, noteId: string, choice: string | null) {
  const now = new Date();
  const [row] = await getDb()
    .update(coachNotes)
    .set(choice ? { response: choice, respondedAt: now } : { dismissedAt: now })
    .where(and(eq(coachNotes.id, noteId), eq(coachNotes.userId, userId), isNull(coachNotes.respondedAt), isNull(coachNotes.dismissedAt)))
    .returning({ id: coachNotes.id });
  return { updated: !!row };
}

/** Tutor notes written since the learner's last session: they're for the next one. */
export async function tutorNotesSince(planId: string, since: Date | null) {
  const rows = await getDb()
    .select({ tutorNote: coachNotes.tutorNote, createdAt: coachNotes.createdAt })
    .from(coachNotes)
    .where(and(eq(coachNotes.planId, planId), isNotNull(coachNotes.tutorNote), since ? gt(coachNotes.createdAt, since) : undefined));
  return rows.map((r) => r.tutorNote!);
}

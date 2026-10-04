import { eq } from "drizzle-orm";

import { getDb, schema } from "@/db";

const { reminderPrefs, users } = schema;

export type ReminderSettings = { enabled: boolean; days: number[]; time: string; timeZone: string };

export async function loadReminderPrefs(userId: string) {
  const [row] = await getDb().select().from(reminderPrefs).where(eq(reminderPrefs.userId, userId));
  return row;
}

/** Every learner who has reminders on. */
export async function enabledReminderPrefs() {
  return getDb().select().from(reminderPrefs).where(eq(reminderPrefs.enabled, true));
}

/** Save a learner's reminder settings. */
export async function saveReminderPrefs(userId: string, settings: ReminderSettings) {
  const db = getDb();
  await db.insert(users).values({ id: userId }).onConflictDoNothing();
  await db
    .insert(reminderPrefs)
    .values({ userId, ...settings, updatedAt: new Date(), unsubscribedAt: null })
    .onConflictDoUpdate({ target: reminderPrefs.userId, set: { ...settings, updatedAt: new Date(), ...(settings.enabled && { unsubscribedAt: null }) } });
}

/** Today's reminder went out (or was skipped), so no second one today. */
export async function markReminderSent(userId: string, localDate: string) {
  await getDb().update(reminderPrefs).set({ lastSentOn: localDate }).where(eq(reminderPrefs.userId, userId));
}

/** The learner unsubscribed from a reminder email. */
export async function unsubscribeReminders(userId: string) {
  await getDb().update(reminderPrefs).set({ enabled: false, unsubscribedAt: new Date() }).where(eq(reminderPrefs.userId, userId));
}

import { auth } from "@clerk/nextjs/server";
import { z } from "zod";

import { isDatabaseConfigured } from "@/db";
import { loadReminderPrefs, saveReminderPrefs, type ReminderSettings } from "@/lib/reminders/reminder-store";

export type RemindersResponse = ReminderSettings & { unsubscribed: boolean; emailReady: boolean };

const Settings = z.object({
  enabled: z.boolean(),
  days: z.array(z.number().int().min(0).max(6)).max(7),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  timeZone: z.string().refine((tz) => {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: tz });
      return true;
    } catch {
      return false;
    }
  }, "Unknown time zone"),
});

async function signedIn() {
  const { userId } = await auth();
  if (!userId) return { error: new Response("Unauthorized", { status: 401 }) };
  if (!isDatabaseConfigured()) return { error: Response.json({ error: "No database is configured." }, { status: 503 }) };
  return { userId };
}

async function view(userId: string): Promise<RemindersResponse> {
  const p = await loadReminderPrefs(userId);
  return {
    enabled: p?.enabled ?? false,
    days: p?.days ?? [1, 2, 3, 4],
    time: p?.time ?? "19:00",
    timeZone: p?.timeZone ?? "America/Los_Angeles",
    unsubscribed: !!p?.unsubscribedAt,
    emailReady: !!process.env.RESEND_API_KEY && !!process.env.REMINDER_SECRET,
  };
}

/** The learner's reminder settings. */
export async function GET() {
  const s = await signedIn();
  if (s.error) return s.error;
  return Response.json(await view(s.userId));
}

/** Save the learner's reminder settings: days, local time and time zone. */
export async function PUT(req: Request) {
  const s = await signedIn();
  if (s.error) return s.error;
  const parsed = Settings.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid reminder settings", issues: parsed.error.issues }, { status: 400 });
  if (parsed.data.enabled && parsed.data.days.length === 0) return Response.json({ error: "Pick at least one day." }, { status: 400 });
  await saveReminderPrefs(s.userId, { ...parsed.data, days: [...new Set(parsed.data.days)].sort() });
  return Response.json(await view(s.userId));
}

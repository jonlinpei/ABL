import { createHmac, timingSafeEqual } from "node:crypto";

/** A reminder goes out at the chosen time, or up to this late if a run was missed. */
export const LATE_WINDOW_MINUTES = 180;

/** The local weekday (0 = Sunday), date ("YYYY-MM-DD") and minutes after midnight in a time zone. */
export function localNow(now: Date, timeZone: string): { weekday: number; date: string; minutes: number } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      weekday: "short",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts.weekday!);
  return { weekday, date: `${parts.year}-${parts.month}-${parts.day}`, minutes: Number(parts.hour) * 60 + Number(parts.minute) };
}

/** Whether a learner's reminder is due now: a chosen day, at or just after their time, not sent today. */
export function reminderDue(
  prefs: { enabled: boolean; days: number[]; time: string; timeZone: string; lastSentOn: string | null },
  now: Date,
): { due: boolean; localDate: string } {
  let local;
  try {
    local = localNow(now, prefs.timeZone);
  } catch {
    return { due: false, localDate: "" };
  }
  const [h, m] = prefs.time.split(":").map(Number);
  const at = (h ?? 0) * 60 + (m ?? 0);
  const due =
    prefs.enabled &&
    prefs.days.includes(local.weekday) &&
    local.minutes >= at &&
    local.minutes < at + LATE_WINDOW_MINUTES &&
    prefs.lastSentOn !== local.date;
  return { due, localDate: local.date };
}

/** A signed token for one-click unsubscribe links, so they work without signing in. */
export function unsubscribeToken(userId: string, secret: string): string {
  return createHmac("sha256", secret).update(`unsubscribe:${userId}`).digest("base64url");
}

export function validUnsubscribeToken(userId: string, token: string, secret: string): boolean {
  const expected = Buffer.from(unsubscribeToken(userId, secret));
  const given = Buffer.from(token);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

const escape = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** The reminder email: their next step, any check-in from their coach, a link back, and how to stop. */
export function reminderEmail({
  goalTitle,
  nextStep,
  sessionMinutes,
  checkIn,
  goalUrl,
  unsubscribeUrl,
  settingsUrl,
}: {
  goalTitle: string;
  nextStep: string;
  sessionMinutes: number;
  checkIn: string | null;
  goalUrl: string;
  unsubscribeUrl: string;
  settingsUrl: string;
}): { subject: string; text: string; html: string } {
  const subject = checkIn ? `A note from your coach, and your next step` : `Your next ${sessionMinutes} minutes: ${nextStep}`;
  const text = [
    checkIn ? `${checkIn}\n` : null,
    `Next up on your path to ${goalTitle}: ${nextStep} (${sessionMinutes} min).`,
    `Pick up where you left off: ${goalUrl}`,
    "",
    `You're getting this because you asked ABL for reminders. Change them: ${settingsUrl}`,
    `Stop reminders: ${unsubscribeUrl}`,
  ]
    .filter((l) => l !== null)
    .join("\n");
  const html = `<div style="font-family:system-ui,-apple-system,sans-serif;max-width:520px;color:#171717;line-height:1.5">
${checkIn ? `<p style="background:#fef3c7;border-radius:8px;padding:12px 14px;margin:0 0 16px">${escape(checkIn)}</p>` : ""}
<p style="margin:0 0 4px;color:#737373;font-size:13px">Next up on your path to ${escape(goalTitle)}</p>
<p style="margin:0 0 16px;font-size:18px;font-weight:600">${escape(nextStep)}</p>
<p style="margin:0 0 24px"><a href="${escape(goalUrl)}" style="background:#171717;color:#fff;text-decoration:none;padding:10px 16px;border-radius:8px;display:inline-block">Start your ${sessionMinutes}-minute session</a></p>
<p style="margin:0;color:#737373;font-size:12px">You're getting this because you asked ABL for reminders. <a href="${escape(settingsUrl)}" style="color:#737373">Change them</a> · <a href="${escape(unsubscribeUrl)}" style="color:#737373">Stop reminders</a></p>
</div>`;
  return { subject, text, html };
}

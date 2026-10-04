import { isDatabaseConfigured } from "@/db";
import { unsubscribeReminders } from "@/lib/reminders/reminder-store";
import { validUnsubscribeToken } from "@/lib/reminders/reminders";

/**
 * Stop reminders from a link in a reminder email, without signing in: the
 * link carries a token signed for that learner. GET is the link; POST is
 * mail apps' one-click unsubscribe (RFC 8058).
 */
async function unsubscribe(req: Request): Promise<boolean> {
  const url = new URL(req.url);
  const userId = url.searchParams.get("u") ?? "";
  const token = url.searchParams.get("t") ?? "";
  const secret = process.env.REMINDER_SECRET;
  if (!secret || !userId || !validUnsubscribeToken(userId, token, secret) || !isDatabaseConfigured()) return false;
  await unsubscribeReminders(userId);
  return true;
}

const page = (title: string, body: string) =>
  new Response(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} · ABL</title>
<body style="font-family:system-ui,-apple-system,sans-serif;max-width:480px;margin:15vh auto;padding:0 16px;color:#171717;line-height:1.5">
<h1 style="font-size:22px">${title}</h1><p>${body}</p><p><a href="/app/about-me" style="color:#171717">Reminder settings</a></p></body>`,
    { headers: { "Content-Type": "text/html; charset=utf-8" } },
  );

export async function GET(req: Request) {
  return (await unsubscribe(req))
    ? page("You won't get reminders", "ABL won't email you reminders any more. You can turn them back on any time in your settings.")
    : page("That link didn't work", "It may be old or incomplete. You can turn reminders off in your settings.");
}

export async function POST(req: Request) {
  return (await unsubscribe(req)) ? new Response(null, { status: 200 }) : new Response(null, { status: 400 });
}

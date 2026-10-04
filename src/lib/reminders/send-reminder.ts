import { clerkClient } from "@clerk/nextjs/server";

import { currentGoal } from "@/lib/goals/goal-store";
import { openCheckIn } from "@/lib/specialists/coach-store";
import { loadSessionState } from "@/lib/specialists/session-state";

import { reminderEmail, unsubscribeToken } from "./reminders";
import { sendEmail } from "./send-email";

const appUrl = () => (process.env.APP_URL ?? "https://iamabl.com").replace(/\/$/, "");

/**
 * Compose and send one learner's reminder: their current goal's next step and
 * any check-in from their coach. Called after the coach has run, so a
 * check-in made for this moment is included.
 */
export async function sendReminder(userId: string): Promise<{ outcome: "sent" | "skipped"; reason?: string }> {
  const goal = await currentGoal(userId);
  const state = goal && (await loadSessionState(userId, goal.id));
  if (!goal || !state) return { outcome: "skipped", reason: "no_plan" };
  const plan = state.plan.plan;
  const milestone = plan.milestones[state.milestoneIndex];
  if (!milestone && !state.active) return { outcome: "skipped", reason: "plan_done" };
  const secret = process.env.REMINDER_SECRET;
  if (!secret) return { outcome: "skipped", reason: "no_secret" };

  const user = await (await clerkClient()).users.getUser(userId);
  const to = user.primaryEmailAddress?.emailAddress;
  if (!to) return { outcome: "skipped", reason: "no_email" };

  const note = await openCheckIn(userId, state.plan.id);
  const unsubscribeUrl = `${appUrl()}/api/reminders/unsubscribe?u=${encodeURIComponent(userId)}&t=${unsubscribeToken(userId, secret)}`;
  const email = reminderEmail({
    goalTitle: state.brief.brief.target.role,
    nextStep: state.active ? "Finish the session you started" : milestone!.title,
    sessionMinutes: plan.sessionMinutes,
    checkIn: note?.message ?? null,
    goalUrl: `${appUrl()}/app/goals/${goal.id}`,
    unsubscribeUrl,
    settingsUrl: `${appUrl()}/app/about-me`,
  });
  const result = await sendEmail({ to, ...email, unsubscribeUrl });
  return result.sent ? { outcome: "sent" } : { outcome: "skipped", reason: result.reason };
}

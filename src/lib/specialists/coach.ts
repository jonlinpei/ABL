import { z } from "zod";

import { generateStructured } from "@/lib/ai/structured";
import type { GoalBrief } from "@/lib/goals/schema";

import { COACH_SKILL } from "./coach.generated";
import type { Plan, SessionReport } from "./schemas";
import type { Signal } from "./signals";

const DAY = 86_400_000;

export const CoachDecisionSchema = z.object({
  message: z.string().nullable().describe("A short check-in to the learner, or null if one wouldn't help now."),
  options: z.array(z.string()).describe("2 or 3 next steps they can tap, written from their side. Empty when there's no message."),
  tutorNote: z.string().nullable().describe("What the tutor should try differently next session, or null."),
  suggestReplan: z.boolean().describe("True only when the plan no longer fits: the deadline will clearly be missed, or a long lapse."),
  reason: z.string().describe("One sentence on why."),
});
export type CoachDecision = z.infer<typeof CoachDecisionSchema>;

/** A past coach note, as the coach needs to see it. */
export interface PastNote {
  createdAt: Date;
  message: string | null;
  response: string | null;
}

/**
 * Whether a check-in may be sent now. No more than one every 3 days, and if
 * the learner hasn't had a session since the last one, wait a week: a
 * second nudge into silence is nagging.
 */
export function mayCheckIn(lastCheckIn: Date | null, lastSessionEnd: Date | null, now: Date): boolean {
  if (!lastCheckIn) return true;
  const days = (now.getTime() - lastCheckIn.getTime()) / DAY;
  const hadSessionSince = !!lastSessionEnd && lastSessionEnd > lastCheckIn;
  return hadSessionSince ? days >= 3 : days >= 7;
}

export function coachContext({
  brief,
  plan,
  milestoneIndex,
  signals,
  recentSessions,
  notes,
  allowCheckIn,
  today,
}: {
  brief: GoalBrief;
  plan: Plan;
  milestoneIndex: number;
  signals: Signal[];
  recentSessions: { endedAt: Date; report: SessionReport }[];
  notes: PastNote[];
  allowCheckIn: boolean;
  today: string;
}): string {
  const m = plan.milestones[milestoneIndex];
  const sessions = recentSessions
    .slice(-3)
    .map((s) => `- ${s.endedAt.toISOString().slice(0, 10)}: ${s.report.recap}${s.report.endedEarly ? " (ended early)" : ""}`)
    .join("\n");
  const past = notes
    .slice(-3)
    .map((n) => `- ${n.createdAt.toISOString().slice(0, 10)}: ${n.message ?? "(tutor note only)"}${n.response ? ` They chose: "${n.response}"` : " No response."}`)
    .join("\n");
  return `Today is ${today}.

## The learner
${brief.current.role} working toward: ${brief.restatedGoal}
Why: ${brief.motivation}
Deadline: ${brief.deadline ?? "none"}. Time: ${brief.weeklyHours} h/week in ${brief.sessionMinutes}-minute sessions${brief.preferredTimes ? `, ${brief.preferredTimes}` : ""}.
Tried before: ${brief.pastAttempts ?? "nothing"}

## Their plan: "${plan.title}"
${m ? `Milestone ${milestoneIndex + 1} of ${plan.milestones.length}: ${m.title} (visible win: ${m.visibleWin})` : "All milestones complete."}

## Recent sessions
${sessions || "- None yet."}

## Your earlier check-ins
${past || "- None."}

## Signals
${signals.map((s) => `- ${JSON.stringify(s)}`).join("\n")}
${allowCheckIn ? "" : "\nDon't send a check-in right now: you checked in recently. A tutor note is still fine."}`;
}

/**
 * The coach's decision on a set of signals. Code enforces what the model
 * mustn't decide: no message when check-ins are paused, and no options
 * without a message.
 */
export async function decide(context: string, allowCheckIn: boolean, userId: string): Promise<CoachDecision> {
  const { output } = await generateStructured({
    task: "coach_decide",
    userId,
    instructions: COACH_SKILL,
    prompt: context,
    schema: CoachDecisionSchema,
  });
  return enforce(output, allowCheckIn);
}

export function enforce(decision: CoachDecision, allowCheckIn: boolean): CoachDecision {
  const message = allowCheckIn ? decision.message : null;
  return { ...decision, message, options: message ? decision.options.slice(0, 3) : [] };
}

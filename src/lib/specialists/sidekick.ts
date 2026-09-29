import { z } from "zod";

import { generateStructured } from "@/lib/ai/structured";
import type { GoalBrief } from "@/lib/goals/schema";

import type { Plan } from "./schemas";
import { SIDEKICK_SKILL } from "./sidekick.generated";

/** Learner messages a sidekick allows before it's time to take the question back to the lesson. */
export const MAX_SIDEKICK_TURNS = 8;
/** Lesson messages the sidekick sees, so it knows what they were just doing. */
const RECENT_LESSON_MESSAGES = 6;

type UIMessageLike = { role?: string; parts?: { type?: string; text?: string }[] };

/** The text of UI messages, one line per message, newest last. */
export function messageLines(messages: unknown[], limit = Infinity): string[] {
  return (messages as UIMessageLike[])
    .map((m) => {
      const text = (m.parts ?? [])
        .filter((p) => p.type === "text" && p.text?.trim())
        .map((p) => p.text!.trim())
        .join(" ");
      return text ? `${m.role === "user" ? "Learner" : "Tutor"}: ${text}` : "";
    })
    .filter(Boolean)
    .slice(-limit);
}

/** How many messages the learner has sent in a chat. */
export function learnerTurns(messages: unknown[]): number {
  return (messages as UIMessageLike[]).filter((m) => m.role === "user").length;
}

/** What the sidekick needs: who they are, what the lesson is on, and what just happened in it. */
export function sidekickContext({
  brief,
  plan,
  milestoneIndex,
  lesson,
}: {
  brief: GoalBrief;
  plan: Plan;
  milestoneIndex: number;
  lesson: unknown[];
}): string {
  const m = plan.milestones[milestoneIndex];
  const recent = messageLines(lesson, RECENT_LESSON_MESSAGES)
    .map((l) => `- ${l.length > 400 ? `${l.slice(0, 400)}…` : l}`)
    .join("\n");
  return `## The learner
${brief.current.role} (${brief.current.industry}) moving to ${brief.target.role}. ${brief.current.work}
Interests: ${brief.interests.join(", ") || "none listed"}.

## The lesson
${m ? `Milestone: ${m.title}. Topics: ${m.topics.join("; ")}.` : "Their roadmap is complete."}

## The last few messages of the lesson
${recent || "- The lesson has just started."}`;
}

/** The note on a finished sidekick, for the tutor and the glossary. */
export function sidekickSummarySchema(skillIds: string[]) {
  return z.object({
    summary: z.string().describe("One sentence: what they asked and whether the answer landed."),
    term: z.string().nullable().describe("The term or concept explained, or null."),
    definition: z.string().nullable().describe("A one-sentence plain-English definition of the term, or null."),
    skillId: (skillIds.length ? z.enum(skillIds as [string, ...string[]]) : z.string())
      .nullable()
      .describe("The session skill the question was about, or null."),
    struggled: z.boolean().describe("True if they seemed confused or needed several tries."),
  });
}
export type SidekickSummary = z.infer<ReturnType<typeof sidekickSummarySchema>>;

/** Summarize a finished sidekick. Null when nothing was asked. */
export async function summarizeSidekick(messages: unknown[], skillIds: string[], userId: string): Promise<SidekickSummary | null> {
  const transcript = messageLines(messages).join("\n").replaceAll("Tutor:", "Sidekick:");
  if (!transcript) return null;
  const { output } = await generateStructured({
    task: "gap_detect",
    userId,
    instructions: SIDEKICK_SKILL,
    prompt: `Summarize this finished sidekick for the tutor, as described under "After the sidekick".\n\nSession skill ids: ${skillIds.join(", ") || "none"}\n\n${transcript}`,
    schema: sidekickSummarySchema(skillIds),
  });
  // Only ids from the session count, even from a model that ignored the list.
  return { ...output, skillId: output.skillId && skillIds.includes(output.skillId) ? output.skillId : null };
}

/**
 * The tutor's view of this session's sidekicks, riding on the newest learner
 * message: summaries where they're closed, the first question where not.
 */
export function sidekickNotes(sidekicks: { summary: string | null; struggled: boolean | null; messages: unknown[] }[]): string | null {
  const lines = sidekicks
    .map((s) => {
      if (s.summary) return `- ${s.summary}${s.struggled ? " (they struggled with it)" : ""}`;
      const first = messageLines(s.messages).find((l) => l.startsWith("Learner:"));
      return first ? `- Asked: "${first.slice("Learner: ".length)}" (still open)` : null;
    })
    .filter(Boolean);
  return lines.length ? `[Side questions they asked this session, in a separate panel:\n${lines.join("\n")}]` : null;
}

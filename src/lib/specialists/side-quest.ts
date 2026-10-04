import { z } from "zod";

import { generateStructured } from "@/lib/ai/structured";
import type { GoalBrief } from "@/lib/goals/schema";

import type { Gap, Plan } from "./schemas";
import { SIDE_QUEST_SKILL } from "./side-quest.generated";

export const SideQuestDraftSchema = z.object({
  title: z.string(),
  why: z.string().describe("One sentence to the learner on how this connects to their goal, honestly."),
  outline: z.array(z.string()).describe("Two to four things the sessions would cover."),
  sessions: z.number().describe("Sessions it takes, 1 to 4."),
  skillId: z.string().describe("A skill id from their goal's list, or a new short lowercase slug."),
  skillName: z.string(),
  relevance: z.enum(["core", "related", "tangent"]),
});
export type SideQuestDraft = z.infer<typeof SideQuestDraftSchema>;

/** A drafted quest, cleaned up: 1 to 4 sessions, 2 to 4 outline items, a slug id. */
export function normalizeDraft(draft: SideQuestDraft, gap: Gap): SideQuestDraft {
  const known = gap.items.find((i) => i.skillId === draft.skillId);
  const slug = draft.skillId.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "side-quest";
  return {
    ...draft,
    sessions: Math.min(4, Math.max(1, Math.round(draft.sessions))),
    outline: draft.outline.filter((o) => o.trim()).slice(0, 4),
    skillId: known ? known.skillId : slug,
    skillName: known ? known.name : draft.skillName,
  };
}

/**
 * Weeks the finish moves if the quest uses plan time: its sessions at their
 * session length, over their weekly hours, rounded up to the half week.
 */
export function planWeeksFor(sessions: number, plan: Pick<Plan, "sessionMinutes" | "weeklyHours">): number {
  const weeks = (sessions * plan.sessionMinutes) / (plan.weeklyHours * 60);
  return Math.max(0.5, Math.ceil(weeks * 2) / 2);
}

export function sideQuestPrompt({ brief, plan, milestoneIndex, gap, topic }: { brief: GoalBrief; plan: Plan; milestoneIndex: number; gap: Gap; topic: string }) {
  const m = plan.milestones[milestoneIndex];
  return `## The learner
${brief.current.role} (${brief.current.industry}) working toward: ${brief.restatedGoal}
Interests: ${brief.interests.join(", ") || "none listed"}. Sessions are ${plan.sessionMinutes} minutes.

## Where they are
${m ? `Milestone ${milestoneIndex + 1} of ${plan.milestones.length}: ${m.title}` : "Their roadmap is complete."}
Milestones ahead: ${plan.milestones.slice(milestoneIndex + 1).map((x) => x.title).join("; ") || "none"}

## Skills their goal needs (ids to reuse)
${gap.items.map((i) => `- ${i.skillId}: ${i.name}`).join("\n")}

## The topic they want to explore
${topic}`;
}

export async function draftSideQuest(input: Parameters<typeof sideQuestPrompt>[0], userId: string): Promise<SideQuestDraft> {
  const { output } = await generateStructured({
    task: "side_quest_draft",
    userId,
    instructions: SIDE_QUEST_SKILL,
    prompt: sideQuestPrompt(input),
    schema: SideQuestDraftSchema,
  });
  return normalizeDraft(output, input.gap);
}

/** The tutor's brief for a side-quest session, in place of the milestone. */
export function sideQuestContext(quest: { title: string; why: string; outline: string[]; sessions: number; skillId: string; skillName: string }, sessionNumber: number): string {
  return `## This is a side quest, not a milestone
They chose a short detour from their roadmap: "${quest.title}". ${quest.why}
- Cover, over ${quest.sessions} session${quest.sessions === 1 ? "" : "s"}: ${quest.outline.join("; ")}
- This is side-quest session ${sessionNumber} of ${quest.sessions}.
- Skill it builds: ${quest.skillId}: ${quest.skillName}.
Teach the quest, not their current milestone. Mark \`milestoneComplete\` true only when they've covered the whole outline; it ends the side quest, not a milestone.`;
}

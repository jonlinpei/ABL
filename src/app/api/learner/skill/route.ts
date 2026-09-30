import { auth } from "@clerk/nextjs/server";
import { z } from "zod";

import { isDatabaseConfigured } from "@/db";
import { correctGap, correctMastery, planAffected } from "@/lib/specialists/corrections";
import { loadLearnerRecord, saveSkillCorrection } from "@/lib/specialists/learner-record-store";
import { loadMastery } from "@/lib/specialists/mastery-store";
import { loadSessionState } from "@/lib/specialists/session-state";
import { goalForRequest } from "@/lib/goals/request-goal";

// Levels are 0 to 4 (none to can lead).
const Body = z.object({
  skillId: z.string().min(1),
  level: z.number().int().min(0).max(4),
  note: z.string().trim().max(500).nullable().default(null),
  goalId: z.string().optional(),
});

export interface SkillCorrectionResponse {
  /** The plan teaches what they now say they know, or assumed more than they have: offer a rework. */
  planAffected: boolean;
}

/**
 * The learner corrects ABL's level for one of their skills. It counts right
 * away as their own estimate; the tutor confirms it early in the next session.
 */
export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return new Response("Unauthorized", { status: 401 });
  if (!isDatabaseConfigured()) return Response.json({ error: "No database is configured." }, { status: 503 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid request", issues: parsed.error.issues }, { status: 400 });
  const { skillId, level, note } = parsed.data;

  const resolved = await goalForRequest(userId, parsed.data.goalId);
  if ("error" in resolved) return resolved.error;
  const goalId = resolved.goal.id;
  const record = await loadLearnerRecord(userId, goalId);
  const gap = record?.gap && correctGap(record.gap, skillId, level);
  if (!record || !gap) return Response.json({ error: "That skill isn't in your skills picture." }, { status: 409 });
  const from = record.gap!.items.find((i) => i.skillId === skillId)!.current;
  const [mastery] = await loadMastery(userId, [skillId]);
  await saveSkillCorrection(userId, record.briefId, gap, mastery ? correctMastery(mastery, level, note, new Date()) : null, {
    skillId,
    from,
    to: level,
    note,
  });

  const state = record.hasPlan ? await loadSessionState(userId, goalId) : undefined;
  const affected = !!state && planAffected(state.plan.plan, state.milestoneIndex, skillId, level);
  return Response.json({ planAffected: affected } satisfies SkillCorrectionResponse);
}

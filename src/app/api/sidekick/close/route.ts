import { auth } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, isDatabaseConfigured, schema } from "@/db";
import { summarizeSidekick } from "@/lib/specialists/sidekick";
import { closeSidekick, loadSidekick } from "@/lib/specialists/sidekick-store";

export const maxDuration = 30;

const Body = z.object({ id: z.uuid() });

/**
 * The learner went back to the lesson: summarize the sidekick for the tutor
 * (what they asked, the term, whether they struggled) and close it.
 */
export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return new Response("Unauthorized", { status: 401 });
  if (!isDatabaseConfigured()) return Response.json({ error: "No database is configured." }, { status: 503 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid request", issues: parsed.error.issues }, { status: 400 });

  const sidekick = await loadSidekick(parsed.data.id, userId);
  // Opened and closed without asking anything: there's no row, and nothing to note.
  if (!sidekick) return Response.json({ closed: false });
  if (sidekick.closedAt) return Response.json({ closed: true, term: sidekick.term });

  const skillIds = await sessionSkillIds(sidekick.sessionId);
  let summary = null;
  try {
    summary = await summarizeSidekick(sidekick.messages, skillIds, userId);
  } catch (err) {
    // The tutor then sees the question itself instead of a summary.
    console.error("[sidekick] couldn't summarize", err);
  }
  await closeSidekick(sidekick.id, userId, summary);
  return Response.json({ closed: true, term: summary?.term ?? null });
}

/** The skills the session's milestone works on. */
async function sessionSkillIds(sessionId: string): Promise<string[]> {
  const db = getDb();
  const [row] = await db
    .select({ milestoneIndex: schema.sessions.milestoneIndex, plan: schema.plans.plan })
    .from(schema.sessions)
    .innerJoin(schema.plans, eq(schema.plans.id, schema.sessions.planId))
    .where(eq(schema.sessions.id, sessionId));
  return row?.plan.milestones[row.milestoneIndex]?.skills.map((s) => s.skillId) ?? [];
}

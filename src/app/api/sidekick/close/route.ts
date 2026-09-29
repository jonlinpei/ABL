import { auth } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, isDatabaseConfigured, schema } from "@/db";
import { glossaryDomains } from "@/lib/specialists/glossary";
import { loadGlossary, recordTerms } from "@/lib/specialists/glossary-store";
import { summarizeSidekick } from "@/lib/specialists/sidekick";
import { closeSidekick, loadSidekick } from "@/lib/specialists/sidekick-store";

export const maxDuration = 30;

const Body = z.object({ id: z.uuid() });

/**
 * The learner went back to the lesson: summarize the sidekick for the tutor
 * (what they asked, the term, whether they struggled), close it, and add the
 * term to their glossary.
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

  const [session, glossary] = await Promise.all([sessionContext(sidekick.sessionId), loadGlossary(userId)]);
  let summary = null;
  try {
    summary = await summarizeSidekick(sidekick.messages, session.skillIds, userId, {
      domains: glossaryDomains(glossary),
      goal: session.goal,
    });
  } catch (err) {
    // The tutor then sees the question itself instead of a summary.
    console.error("[sidekick] couldn't summarize", err);
  }
  await closeSidekick(sidekick.id, userId, summary);
  if (summary?.term && summary.definition && summary.domain) {
    try {
      const { term, definition, domain, skillId, struggled } = summary;
      await recordTerms(userId, session.briefId, "sidekick", [{ term, definition, domain, skillId, struggled }]);
    } catch (err) {
      console.error("[sidekick] couldn't add the term to the glossary", err);
    }
  }
  return Response.json({ closed: true, term: summary?.term ?? null });
}

/** The session's milestone skills, and the goal (brief) it's working toward. */
async function sessionContext(sessionId: string) {
  const [row] = await getDb()
    .select({ milestoneIndex: schema.sessions.milestoneIndex, plan: schema.plans.plan, briefId: schema.plans.briefId, brief: schema.careerBriefs.brief })
    .from(schema.sessions)
    .innerJoin(schema.plans, eq(schema.plans.id, schema.sessions.planId))
    .innerJoin(schema.careerBriefs, eq(schema.careerBriefs.id, schema.plans.briefId))
    .where(eq(schema.sessions.id, sessionId));
  return {
    skillIds: row?.plan.milestones[row.milestoneIndex]?.skills.map((s) => s.skillId) ?? [],
    briefId: row?.briefId ?? null,
    goal: row ? `${row.brief.target.role} (${row.brief.target.industry})` : "",
  };
}

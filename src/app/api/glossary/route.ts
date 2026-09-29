import { auth } from "@clerk/nextjs/server";
import { z } from "zod";

import { isDatabaseConfigured } from "@/db";
import { familiarity, glossaryKey, groupByHeadword, type Familiarity, type GlossarySense } from "@/lib/specialists/glossary";
import { defineTerm } from "@/lib/specialists/glossary-define";
import { deleteTerm, loadGlossary, recordTerms, setTermKnown } from "@/lib/specialists/glossary-store";
import { loadLatestBriefAndGap } from "@/lib/specialists/store";

export const maxDuration = 30;

export interface GlossaryView {
  /** The goal they're working toward now, for the "this goal" filter. */
  currentBriefId: string | null;
  headwords: {
    headword: string;
    senses: (Pick<GlossarySense, "id" | "domain" | "definition" | "source" | "known"> & {
      familiarity: Familiarity;
      skillName: string | null;
      inCurrentGoal: boolean;
    })[];
  }[];
}

async function view(userId: string): Promise<GlossaryView> {
  const [senses, state] = await Promise.all([loadGlossary(userId), loadLatestBriefAndGap(userId)]);
  const gap = state?.gap?.gap ?? null;
  const currentBriefId = state?.brief.id ?? null;
  const names = new Map(gap?.items.map((i) => [i.skillId, i.name]));
  return {
    currentBriefId,
    headwords: groupByHeadword(senses).map((g) => ({
      headword: g.headword,
      senses: g.senses.map((s) => ({
        id: s.id,
        domain: s.domain,
        definition: s.definition,
        source: s.source,
        known: s.known,
        familiarity: familiarity(s, gap),
        skillName: s.skillId ? (names.get(s.skillId) ?? null) : null,
        inCurrentGoal: !!currentBriefId && s.briefId === currentBriefId,
      })),
    })),
  };
}

async function signedIn() {
  const { userId } = await auth();
  if (!userId) return { error: new Response("Unauthorized", { status: 401 }) };
  if (!isDatabaseConfigured())
    return {
      error: Response.json({ error: "No database is configured." }, { status: 503 }),
    };
  return { userId };
}

/** The learner's glossary, grouped by headword, with how well they know each sense. */
export async function GET() {
  const s = await signedIn();
  if (s.error) return s.error;
  return Response.json((await view(s.userId)) satisfies GlossaryView);
}

const AddBody = z.object({
  term: z.string().trim().min(1).max(80),
  note: z.string().trim().max(300).nullable().default(null),
});

/** The learner adds a term: ABL defines it in the field it belongs to. */
export async function POST(req: Request) {
  const s = await signedIn();
  if (s.error) return s.error;
  const parsed = AddBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success || !glossaryKey(parsed.data.term)) {
    return Response.json({ error: "Enter a term to add." }, { status: 400 });
  }
  const [existing, state] = await Promise.all([loadGlossary(s.userId), loadLatestBriefAndGap(s.userId)]);
  const brief = state?.brief.brief;
  let entry;
  try {
    entry = await defineTerm(
      {
        term: parsed.data.term,
        note: parsed.data.note,
        learner: {
          currentRole: brief ? `${brief.current.role} (${brief.current.industry})` : "not given",
          goal: brief ? `${brief.target.role} (${brief.target.industry})` : "not given",
        },
        existing,
      },
      s.userId,
    );
  } catch (err) {
    console.error("[glossary] couldn't define the term", err);
    return Response.json({ error: "Couldn't define that term right now. Please try again." }, { status: 502 });
  }
  await recordTerms(s.userId, state?.brief.id ?? null, "learner", [entry]);
  return Response.json((await view(s.userId)) satisfies GlossaryView);
}

const PatchBody = z.object({ id: z.uuid(), known: z.boolean() });

/** Mark a sense known, or back to learning. */
export async function PATCH(req: Request) {
  const s = await signedIn();
  if (s.error) return s.error;
  const parsed = PatchBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid request" }, { status: 400 });
  if (!(await setTermKnown(s.userId, parsed.data.id, parsed.data.known)))
    return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json((await view(s.userId)) satisfies GlossaryView);
}

const DeleteBody = z.object({ id: z.uuid() });

/** Remove a sense from the glossary. */
export async function DELETE(req: Request) {
  const s = await signedIn();
  if (s.error) return s.error;
  const parsed = DeleteBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid request" }, { status: 400 });
  if (!(await deleteTerm(s.userId, parsed.data.id))) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json((await view(s.userId)) satisfies GlossaryView);
}

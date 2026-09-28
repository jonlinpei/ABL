import { auth } from "@clerk/nextjs/server";
import { z } from "zod";

import { isDatabaseConfigured } from "@/db";
import { respondToCheckIn } from "@/lib/specialists/coach-store";

const Body = z.object({
  noteId: z.string().uuid(),
  /** The option tapped, or null to dismiss. */
  choice: z.string().max(200).nullable(),
});

/** The learner answers (or dismisses) a coach check-in. */
export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return new Response("Unauthorized", { status: 401 });
  if (!isDatabaseConfigured()) return Response.json({ error: "No database is configured." }, { status: 503 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid request" }, { status: 400 });
  const { updated } = await respondToCheckIn(userId, parsed.data.noteId, parsed.data.choice);
  if (!updated) return Response.json({ error: "That check-in isn't open." }, { status: 409 });
  return Response.json({ ok: true });
}

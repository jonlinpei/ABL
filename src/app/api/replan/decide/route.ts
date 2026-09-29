import { auth } from "@clerk/nextjs/server";
import { z } from "zod";

import { isDatabaseConfigured } from "@/db";
import { decideHuddle } from "@/lib/specialists/huddle-store";

const Body = z.object({ huddleId: z.string().uuid(), accept: z.boolean() });

/** The learner accepts the proposed plan, or keeps their current one. */
export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return new Response("Unauthorized", { status: 401 });
  if (!isDatabaseConfigured()) return Response.json({ error: "No database is configured." }, { status: 503 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid request" }, { status: 400 });
  const { decided } = await decideHuddle(userId, parsed.data.huddleId, parsed.data.accept);
  if (!decided) return Response.json({ error: "There's no proposal waiting for you." }, { status: 409 });
  return Response.json({ ok: true });
}

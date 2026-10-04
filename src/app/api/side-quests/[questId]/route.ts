import { auth } from "@clerk/nextjs/server";
import { z } from "zod";

import { isDatabaseConfigured } from "@/db";
import { dropSideQuest, startSideQuest } from "@/lib/specialists/side-quest-store";

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("start"), mode: z.enum(["plan_time", "extra"]) }),
  z.object({ action: z.literal("drop") }),
]);

/** Start a proposed side quest, on plan time or extra time, or drop one. */
export async function POST(req: Request, { params }: RouteContext<"/api/side-quests/[questId]">) {
  const { userId } = await auth();
  if (!userId) return new Response("Unauthorized", { status: 401 });
  if (!isDatabaseConfigured()) return Response.json({ error: "No database is configured." }, { status: 503 });
  const { questId } = await params;
  if (!z.uuid().safeParse(questId).success) return Response.json({ error: "That side quest wasn't found." }, { status: 404 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid request" }, { status: 400 });
  const ok =
    parsed.data.action === "start" ? !!(await startSideQuest(userId, questId, parsed.data.mode)) : await dropSideQuest(userId, questId);
  if (!ok) return Response.json({ error: "That side quest isn't open." }, { status: 409 });
  return Response.json({ ok: true });
}

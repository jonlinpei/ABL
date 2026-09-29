import { and, eq, isNull } from "drizzle-orm";

import { getDb, schema } from "@/db";

import type { SidekickSummary } from "./sidekick";

const { sidekicks } = schema;

/** A learner's sidekick, if it's theirs. */
export async function loadSidekick(id: string, userId: string) {
  const [row] = await getDb()
    .select()
    .from(sidekicks)
    .where(and(eq(sidekicks.id, id), eq(sidekicks.userId, userId)));
  return row;
}

/** The session's sidekicks, oldest first. */
export async function loadSessionSidekicks(sessionId: string) {
  return getDb().select().from(sidekicks).where(eq(sidekicks.sessionId, sessionId)).orderBy(sidekicks.createdAt);
}

/**
 * Save a sidekick's messages, creating it on its first turn. Only the owner
 * can write to it, and a closed sidekick stays as it was.
 */
export async function saveSidekickMessages(id: string, userId: string, sessionId: string, messages: unknown[]) {
  await getDb()
    .insert(sidekicks)
    .values({ id, userId, sessionId, messages })
    .onConflictDoUpdate({
      target: sidekicks.id,
      set: { messages },
      setWhere: and(eq(sidekicks.userId, userId), isNull(sidekicks.closedAt)),
    });
}

/** Close a sidekick with its summary (null when nothing was asked). Closing twice is a no-op. */
export async function closeSidekick(id: string, userId: string, summary: SidekickSummary | null) {
  await getDb()
    .update(sidekicks)
    .set({ closedAt: new Date(), ...(summary ?? {}) })
    .where(and(eq(sidekicks.id, id), eq(sidekicks.userId, userId), isNull(sidekicks.closedAt)));
}

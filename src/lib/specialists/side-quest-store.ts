import { and, eq, inArray, isNotNull } from "drizzle-orm";

import { getDb, schema } from "@/db";

import type { SideQuestDraft } from "./side-quest";

const { learnerEvents, sessions, sideQuests } = schema;

/** The goal's open side quest, proposed or active, if any. */
export async function openSideQuest(goalId: string) {
  const [row] = await getDb()
    .select()
    .from(sideQuests)
    .where(and(eq(sideQuests.goalId, goalId), inArray(sideQuests.status, ["proposed", "active"])))
    .limit(1);
  return row;
}

export async function loadSideQuest(userId: string, id: string) {
  const [row] = await getDb()
    .select()
    .from(sideQuests)
    .where(and(eq(sideQuests.id, id), eq(sideQuests.userId, userId)));
  return row;
}

/**
 * Save a drafted quest as the goal's proposal, replacing an earlier proposal
 * the learner didn't take up. Null if a quest is already under way.
 */
export async function proposeSideQuest(userId: string, goalId: string, topic: string, draft: SideQuestDraft, planWeeks: number) {
  const db = getDb();
  const open = await openSideQuest(goalId);
  if (open?.status === "active") return null;
  if (open) await db.update(sideQuests).set({ status: "dropped", endedAt: new Date() }).where(eq(sideQuests.id, open.id));
  const [row] = await db
    .insert(sideQuests)
    .values({ userId, goalId, topic, ...draft, planWeeks })
    .returning();
  return row!;
}

/** The learner chooses plan time or extra time, and the quest starts. */
export async function startSideQuest(userId: string, id: string, mode: "plan_time" | "extra") {
  const db = getDb();
  const [row] = await db
    .update(sideQuests)
    .set({ status: "active", mode, startedAt: new Date() })
    .where(and(eq(sideQuests.id, id), eq(sideQuests.userId, userId), eq(sideQuests.status, "proposed")))
    .returning();
  if (row) await db.insert(learnerEvents).values({ userId, type: "side_quest_started", payload: { questId: id, mode, planWeeks: row.planWeeks } });
  return row;
}

/** Drop a proposed or active quest. */
export async function dropSideQuest(userId: string, id: string) {
  const [row] = await getDb()
    .update(sideQuests)
    .set({ status: "dropped", endedAt: new Date() })
    .where(and(eq(sideQuests.id, id), eq(sideQuests.userId, userId), inArray(sideQuests.status, ["proposed", "active"])))
    .returning({ id: sideQuests.id });
  return !!row;
}

/** The quest is done: its last session covered the outline. */
export async function finishSideQuest(userId: string, id: string) {
  const db = getDb();
  const [row] = await db
    .update(sideQuests)
    .set({ status: "done", endedAt: new Date() })
    .where(and(eq(sideQuests.id, id), eq(sideQuests.userId, userId), eq(sideQuests.status, "active")))
    .returning({ id: sideQuests.id });
  if (row) await db.insert(learnerEvents).values({ userId, type: "side_quest_done", payload: { questId: id } });
}

/** How many of the quest's sessions have ended. */
export async function endedQuestSessions(questId: string): Promise<number> {
  const rows = await getDb()
    .select({ id: sessions.id })
    .from(sessions)
    .where(and(eq(sessions.sideQuestId, questId), isNotNull(sessions.endedAt)));
  return rows.length;
}

import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { beforeEach, describe, expect, it, vi } from "vitest";

import * as schema from "@/db/schema";

import { sampleBrief } from "./test-fixtures";

// A real Drizzle client over a placeholder URL builds real SQL without
// connecting; batch() is replaced to capture the queries instead of running them.
const db = drizzle({ client: neon("postgresql://user:pass@localhost/abl"), schema });
const captured: { sql: string; params: unknown[] }[] = [];
db.batch = (async (queries: { toSQL: () => { sql: string; params: unknown[] } }[]) => {
  captured.push(...queries.map((q) => q.toSQL()));
  return [[], [], [{ id: "brief-id", version: 3 }], []];
}) as unknown as typeof db.batch;

vi.mock("@/db", () => ({ getDb: () => db, schema }));

const { saveConfirmedBrief } = await import("./brief-store");

const GOAL_ID = "8b1c2f7e-3d4a-4e5f-9a6b-7c8d9e0f1a2b";

beforeEach(() => {
  captured.length = 0;
});

describe("saveConfirmedBrief", () => {
  it("starts a new goal: the user, a goals insert, the goal's first brief version and a brief_confirmed event in one batch", async () => {
    const saved = await saveConfirmedBrief("user_1", sampleBrief);
    expect(saved).toMatchObject({ id: "brief-id", version: 3 });
    expect(saved.goalId).toMatch(/^[0-9a-f-]{36}$/);

    expect(captured).toHaveLength(4);
    const [user, goal, brief, event] = captured;
    expect(user!.sql).toMatch(/insert into "users".*on conflict do nothing/i);

    expect(goal!.sql).toMatch(/insert into "goals"/i);
    expect(goal!.params).toContain(saved.goalId);
    expect(goal!.params).toContain("user_1");

    expect(brief!.sql).toMatch(/insert into "career_briefs"/i);
    expect(brief!.sql).toMatch(/coalesce\(max\("career_briefs"\."version"\), 0\) \+ 1/i);
    // The version is per goal, not per learner.
    expect(brief!.sql).toMatch(/where "career_briefs"\."goal_id" = \$\d+/i);
    expect(brief!.params).toContain("user_1");
    expect(brief!.params).toContain(saved.goalId);
    expect(brief!.params).toContain(JSON.stringify(sampleBrief));

    expect(event!.sql).toMatch(/insert into "learner_events"/i);
    const briefId = brief!.params[0];
    expect(event!.params).toContain("brief_confirmed");
    expect(event!.params).toContain(JSON.stringify({ briefId, goalId: saved.goalId }));
  });

  it("revises an existing goal: updates that goal's lastOpenedAt instead of inserting one", async () => {
    const saved = await saveConfirmedBrief("user_1", sampleBrief, GOAL_ID);
    expect(saved).toEqual({ id: "brief-id", version: 3, goalId: GOAL_ID });

    const [, goal, brief, event] = captured;
    expect(goal!.sql).toMatch(/^update "goals" set "last_opened_at"/i);
    expect(goal!.sql).toMatch(/"goals"\."id" = \$\d+ and "goals"\."user_id" = \$\d+/i);
    expect(goal!.params).toContain(GOAL_ID);
    expect(goal!.params).toContain("user_1");
    expect(captured.some((q) => /insert into "goals"/i.test(q.sql))).toBe(false);

    expect(brief!.sql).toMatch(/where "career_briefs"\."goal_id" = \$\d+/i);
    expect(brief!.params.filter((p) => p === GOAL_ID).length).toBeGreaterThanOrEqual(2);

    expect(event!.params).toContain(JSON.stringify({ briefId: brief!.params[0], goalId: GOAL_ID }));
  });
});

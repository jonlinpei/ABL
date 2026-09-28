import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { describe, expect, it, vi } from "vitest";

import * as schema from "@/db/schema";

import { sampleBrief } from "./test-fixtures";

// A real Drizzle client over a placeholder URL builds real SQL without
// connecting; batch() is replaced to capture the queries instead of running them.
const db = drizzle({ client: neon("postgresql://user:pass@localhost/abl"), schema });
const captured: { sql: string; params: unknown[] }[] = [];
db.batch = (async (queries: { toSQL: () => { sql: string; params: unknown[] } }[]) => {
  captured.push(...queries.map((q) => q.toSQL()));
  return [[], [{ id: "brief-id", version: 3 }], []];
}) as unknown as typeof db.batch;

vi.mock("@/db", () => ({ getDb: () => db, schema }));

const { saveConfirmedBrief } = await import("./brief-store");

describe("saveConfirmedBrief", () => {
  it("writes the user, the next brief version and a brief_confirmed event in one batch", async () => {
    const saved = await saveConfirmedBrief("user_1", sampleBrief);
    expect(saved).toEqual({ id: "brief-id", version: 3 });

    const [user, brief, event] = captured;
    expect(user!.sql).toMatch(/insert into "users".*on conflict do nothing/i);

    expect(brief!.sql).toMatch(/insert into "career_briefs"/i);
    expect(brief!.sql).toMatch(/coalesce\(max\("career_briefs"\."version"\), 0\) \+ 1/i);
    expect(brief!.params).toContain("user_1");
    expect(brief!.params).toContain(JSON.stringify(sampleBrief));

    expect(event!.sql).toMatch(/insert into "learner_events"/i);
    const briefId = brief!.params[0];
    expect(event!.params).toContain("brief_confirmed");
    expect(event!.params).toContain(JSON.stringify({ briefId }));
  });
});

import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { it } from "vitest";
import { getDb, schema } from "@/db";
import { saveConfirmedBrief } from "@/lib/goals/brief-store";
import { GoalBriefSchema } from "@/lib/goals/schema";
import { computeGap } from "@/lib/specialists/gap";
import { PlanSchema } from "@/lib/specialists/schemas";
it("seed", async () => {
  const db = getDb();
  const userId = process.env.E2E_USER_ID!;
  await db.delete(schema.users).where(eq(schema.users.id, userId));
  await db.delete(schema.targetRequirements).where(eq(schema.targetRequirements.targetKey, "e2e-seed"));
  if (process.env.CLEAN_ONLY) return process.stdout.write("CLEANED\n");
  const read = (s: string) => JSON.parse(readFileSync(`src/lib/specialists/fixtures/marketing-ops-to-data-analyst.${s}.json`, "utf8"));
  const { requirements, profile } = read("specialists");
  const [r] = await db.insert(schema.targetRequirements).values({ targetKey: "e2e-seed", requirements }).returning();
  const v1 = await saveConfirmedBrief(userId, GoalBriefSchema.parse(read("brief")));
  const [p] = await db.insert(schema.learnerProfiles).values({ userId, briefId: v1.id, requirementsId: r!.id, profile }).returning();
  await db.insert(schema.gaps).values({ userId, briefId: v1.id, profileId: p!.id, gap: computeGap(requirements, profile), assessedAt: new Date() });
  const [pl] = await db.insert(schema.plans).values({ userId, briefId: v1.id, version: 1, plan: PlanSchema.parse(read("plan")), review: { verdict: "approve", issues: [] } }).returning();
  // The latest session just finished milestone 1.
  await db.insert(schema.sessions).values({ userId, planId: pl!.id, milestoneIndex: 0, endedAt: new Date(),
    report: { summary: "s", recap: "You rebuilt your leads-by-source pivot in SQL.", covered: [], evidence: [], homework: null, milestoneComplete: true, endedEarly: false } });
  process.stdout.write(`SEEDED ${v1.goalId}\n`);
});

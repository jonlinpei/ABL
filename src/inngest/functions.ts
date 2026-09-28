import { and, eq } from "drizzle-orm";
import { NonRetriableError } from "inngest";

import { getDb, schema } from "@/db";
import { computeGap } from "@/lib/specialists/gap";
import { buildProfile } from "@/lib/specialists/profiler";
import { buildRequirements, targetKey } from "@/lib/specialists/requirements";
import {
  findRequirements,
  saveGap,
  saveProfile,
  saveRequirements,
} from "@/lib/specialists/store";

import { inngest } from "./client";
import { briefConfirmed } from "./events";

/**
 * The learner lifecycle after discovery (docs/architecture.md, "Agent
 * architecture"). Each specialist is a step; step results are memoized, so a
 * retry resumes after the last step that finished instead of re-running
 * (and re-paying for) earlier model calls.
 */
export const learnerLifecycle = inngest.createFunction(
  { id: "learner-lifecycle", triggers: [briefConfirmed] },
  async ({ event, step }) => {
    const { userId, briefId } = event.data;

    const { brief } = await step.run("load-brief", async () => {
      const [row] = await getDb()
        .select()
        .from(schema.careerBriefs)
        .where(and(eq(schema.careerBriefs.id, briefId), eq(schema.careerBriefs.userId, userId)));
      if (!row) throw new NonRetriableError(`Brief ${briefId} not found for ${userId}`);
      return row;
    });

    // Requirements analyst: shared by every learner with the same target.
    const key = targetKey(brief.target);
    const cached = await step.run("find-requirements", () => findRequirements(key));
    const requirementsRow =
      cached ??
      (await step.run("build-requirements", async () =>
        saveRequirements(key, await buildRequirements(brief, userId)),
      ));
    const { requirements } = requirementsRow;

    // Profiler: this learner against those requirements.
    const profile = await step.run("build-profile", () => buildProfile(brief, requirements, userId));
    const profileRow = await step.run("save-profile", () =>
      saveProfile(userId, briefId, requirementsRow.id, profile),
    );

    // Gap: deterministic, so it's computed and saved in one step.
    const gap = computeGap(requirements, profile);
    const gapRow = await step.run("save-gap", () => saveGap(userId, briefId, profileRow.id, gap));

    return {
      briefId,
      requirementsCached: !!cached,
      gapId: gapRow.id,
      counts: gap.counts,
    };
  },
);

export const functions = [learnerLifecycle];

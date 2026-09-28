import { and, eq } from "drizzle-orm";
import { NonRetriableError } from "inngest";

import { getDb, schema } from "@/db";

import { inngest } from "./client";
import { briefConfirmed } from "./events";

/**
 * The learner lifecycle after discovery. Each specialist becomes a step here
 * as it's built: profile, requirements and gap next (build step 2), then
 * assessment and planning.
 */
export const learnerLifecycle = inngest.createFunction(
  { id: "learner-lifecycle", triggers: [briefConfirmed] },
  async ({ event, step }) => {
    const { userId, briefId } = event.data;

    const brief = await step.run("load-brief", async () => {
      const [row] = await getDb()
        .select()
        .from(schema.careerBriefs)
        .where(and(eq(schema.careerBriefs.id, briefId), eq(schema.careerBriefs.userId, userId)));
      if (!row) throw new NonRetriableError(`Brief ${briefId} not found for ${userId}`);
      return row;
    });

    return { briefId: brief.id, version: brief.version, headline: brief.brief.headline };
  },
);

export const functions = [learnerLifecycle];

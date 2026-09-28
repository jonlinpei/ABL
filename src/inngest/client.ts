import { Inngest } from "inngest";

/**
 * The job runner for the specialists that follow discovery (docs/architecture.md,
 * "Agent architecture"). Locally, set INNGEST_DEV=1 and run the dev server
 * (`pnpm inngest:dev`); in production it uses INNGEST_EVENT_KEY and
 * INNGEST_SIGNING_KEY.
 */
export const inngest = new Inngest({ id: "abl" });

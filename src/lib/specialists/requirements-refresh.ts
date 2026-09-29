import type { StepRunner } from "./planner";
import {
  buildRequirements,
  mustHaveChanges,
  pickRefreshed,
  REFRESH_USER_ID,
  researchPostings,
} from "./requirements";
import { loadRequirementsForRefresh, saveRefreshedRequirements } from "./store";

/**
 * Rebuild one cached target's requirements from current postings, keeping
 * skill ids where it can. Each model call is a step, so a retry doesn't
 * search again.
 */
export async function refreshTarget(requirementsId: string, run: StepRunner) {
  const loaded = await run("load", () => loadRequirementsForRefresh(requirementsId));
  if (!loaded) return { skipped: true as const };
  const research = await run("research-postings", () => researchPostings(loaded.brief, REFRESH_USER_ID));
  return run("rebuild", async () => {
    const fresh = await buildRequirements(loaded.brief, REFRESH_USER_ID, research, loaded.requirements);
    const next = pickRefreshed(loaded.requirements, fresh);
    await saveRefreshedRequirements(requirementsId, next);
    return {
      replaced: !!next,
      grounded: !!fresh.groundedAt,
      postings: research.postings.length,
      mustHaves: mustHaveChanges(loaded.requirements, next ?? loaded.requirements),
    };
  });
}

import { openMustHaveChanges, rebaseGap } from "./gap";
import { applyMasteryToGap } from "./mastery";
import { loadMastery } from "./mastery-store";
import type { StepRunner } from "./planner";
import {
  buildRequirements,
  mustHaveChanges,
  pickRefreshed,
  REFRESH_USER_ID,
  researchPostings,
} from "./requirements";
import { loadGapsOnRequirements, loadRequirementsForRefresh, saveRebasedGap, saveRefreshedRequirements } from "./store";

/**
 * Rebuild one cached target's requirements from current postings, keeping
 * skill ids where it can, then rebase the gaps of learners on that target.
 * Each model call is a step, so a retry doesn't search again. Returns the
 * learners whose open must-haves changed, for the coach.
 */
export async function refreshTarget(requirementsId: string, run: StepRunner) {
  const loaded = await run("load", () => loadRequirementsForRefresh(requirementsId));
  if (!loaded) return { skipped: true as const };
  const research = await run("research-postings", () => researchPostings(loaded.brief, REFRESH_USER_ID));
  const result = await run("rebuild", async () => {
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
  if (!result.replaced) return { ...result, notify: [] };
  const notify = await run("rebase-gaps", () => rebaseLearnerGaps(requirementsId));
  return { ...result, notify };
}

/**
 * Rebase each learner's current gap on the target's refreshed requirements.
 * Their plan doesn't change: learners with an active plan whose open
 * must-haves changed get a `requirements_changed` event, and the coach
 * decides how to tell them. Returns those learners.
 */
export async function rebaseLearnerGaps(requirementsId: string): Promise<string[]> {
  const loaded = await loadRequirementsForRefresh(requirementsId);
  if (!loaded) return [];
  const notify: string[] = [];
  for (const learner of await loadGapsOnRequirements(requirementsId)) {
    const rebased = applyMasteryToGap(rebaseGap(learner.gap, loaded.requirements), await loadMastery(learner.userId));
    const change = openMustHaveChanges(learner.gap, rebased);
    const tell = learner.hasActivePlan && (change.added.length > 0 || change.dropped.length > 0);
    await saveRebasedGap(learner.gapId, learner.userId, rebased, tell ? { requirementsId, ...change } : null);
    if (tell) notify.push(learner.userId);
  }
  return notify;
}

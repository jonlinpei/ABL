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
 * goals whose open must-haves changed, for the coach.
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
 * Rebase each live goal's current gap on the target's refreshed requirements.
 * Its plan doesn't change: goals with an active plan whose open must-haves
 * changed get a `requirements_changed` event, and the coach decides how to
 * tell the learner. Returns those goals.
 */
export async function rebaseLearnerGaps(requirementsId: string): Promise<{ userId: string; goalId: string }[]> {
  const loaded = await loadRequirementsForRefresh(requirementsId);
  if (!loaded) return [];
  const notify: { userId: string; goalId: string }[] = [];
  for (const learner of await loadGapsOnRequirements(requirementsId)) {
    const rebased = applyMasteryToGap(rebaseGap(learner.gap, loaded.requirements), await loadMastery(learner.userId));
    const change = openMustHaveChanges(learner.gap, rebased);
    const tell = learner.hasActivePlan && (change.added.length > 0 || change.dropped.length > 0);
    await saveRebasedGap(learner.gapId, learner.userId, rebased, tell ? { requirementsId, goalId: learner.goalId, ...change } : null);
    if (tell) notify.push({ userId: learner.userId, goalId: learner.goalId });
  }
  return notify;
}

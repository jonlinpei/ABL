import { and, eq } from "drizzle-orm";
import { NonRetriableError } from "inngest";

import { getDb, schema } from "@/db";
import { selectSkillsToCheck } from "@/lib/specialists/assessment";
import { activeGoalPlans, purgeExpiredGoals } from "@/lib/goals/goal-store";
import { runCoach } from "@/lib/specialists/coach-run";
import { runHuddleById } from "@/lib/specialists/huddle-run";
import { failHuddle } from "@/lib/specialists/huddle-store";
import { computeGap } from "@/lib/specialists/gap";
import { applyMasteryToGap } from "@/lib/specialists/mastery";
import { applySessionEvidence, loadMastery } from "@/lib/specialists/mastery-store";
import { planWithReview } from "@/lib/specialists/planner";
import { buildProfile } from "@/lib/specialists/profiler";
import { buildRequirements, dueForRefresh, researchPostings, targetKey } from "@/lib/specialists/requirements";
import { refreshTarget } from "@/lib/specialists/requirements-refresh";
import {
  findRequirements,
  loadGap,
  loadRefreshCandidates,
  saveFirstPlan,
  saveGap,
  saveProfile,
  saveRequirements,
} from "@/lib/specialists/store";

import { currentPlanOfGoal, saveVersionProposal } from "@/lib/goals/version-store";

import { inngest } from "./client";
import {
  assessmentDone,
  briefConfirmed,
  coachCheck,
  learnerDataDeleted,
  replanRequested,
  requirementsRefreshRequested,
  sessionCompleted,
} from "./events";

/** Stop a learner's running or waiting work once they delete their data. */
const cancelOnDelete = [{ event: learnerDataDeleted, match: "data.userId" }];

/**
 * The learner lifecycle after discovery (docs/architecture.md, "Agent
 * architecture"). Each specialist is a step; step results are memoized, so a
 * retry resumes after the last step that finished instead of re-running
 * (and re-paying for) earlier model calls.
 */
export const learnerLifecycle = inngest.createFunction(
  { id: "learner-lifecycle", triggers: [briefConfirmed], cancelOn: cancelOnDelete },
  async ({ event, step }) => {
    const { userId, briefId, goalId } = event.data;

    const { brief } = await step.run("load-brief", async () => {
      const [row] = await getDb()
        .select()
        .from(schema.careerBriefs)
        .where(and(eq(schema.careerBriefs.id, briefId), eq(schema.careerBriefs.userId, userId)));
      if (!row) throw new NonRetriableError(`Brief ${briefId} not found for ${userId}`);
      return row;
    });

    // Requirements analyst: shared by every learner with the same target.
    // Researching postings takes minutes, so it's a step of its own.
    const key = targetKey(brief.target);
    const cached = await step.run("find-requirements", () => findRequirements(key));
    const requirementsRow =
      cached ??
      (await (async () => {
        const research = await step.run("research-postings", () => researchPostings(brief, userId));
        return step.run("build-requirements", async () =>
          saveRequirements(key, await buildRequirements(brief, userId, research)),
        );
      })());
    const { requirements } = requirementsRow;

    // Profiler: this learner against those requirements.
    const profile = await step.run("build-profile", () => buildProfile(brief, requirements, userId));
    const profileRow = await step.run("save-profile", () =>
      saveProfile(userId, briefId, requirementsRow.id, profile),
    );

    // Gap: deterministic, so it's computed and saved in one step. Skills the
    // learner already practised for another goal start at their mastery
    // level, so the skills check doesn't ask about them again.
    const { gap, gapRow } = await step.run("save-gap", async () => {
      const computed = computeGap(requirements, profile);
      const seeded = applyMasteryToGap(computed, await loadMastery(userId, computed.items.map((i) => i.skillId)));
      return { gap: seeded, gapRow: await saveGap(userId, briefId, profileRow.id, seeded) };
    });

    // Assessor: the learner takes the skills check in the app (/api/assess).
    // Wait for it before planning, unless there's nothing to check. After two
    // weeks, plan from the estimates rather than wait forever.
    const toCheck = selectSkillsToCheck(gap).length;
    const assessed =
      toCheck > 0
        ? await step.waitForEvent("wait-for-skills-check", {
            event: assessmentDone,
            timeout: "14d",
            match: "data.briefId",
          })
        : null;

    // Planner and reviewer, on the gap as it stands now: assessed levels if
    // the check happened, estimates if it timed out.
    const currentGap = await step.run("load-current-gap", () => loadGap(briefId));
    const { plan, review, revised } = await planWithReview({
      brief,
      gap: currentGap,
      userId,
      today: new Date().toISOString().slice(0, 10),
      // Step results come back JSON-serialized; plans and reviews are plain JSON.
      run: (name, fn) => step.run(name, fn) as never,
    });
    // A goal's first plan becomes theirs; a new version of a goal that has one
    // is proposed next to it, for the learner to compare and choose.
    const planRow = await step.run("save-plan", async () => {
      const current = await currentPlanOfGoal(goalId);
      if (!current || current.brief.id === briefId) return saveFirstPlan(userId, briefId, plan, review);
      return (await saveVersionProposal(userId, briefId, plan, review)) ?? { id: null };
    });

    return {
      briefId,
      requirementsCached: !!cached,
      gapId: gapRow.id,
      skillsToCheck: toCheck,
      assessed: !!assessed,
      planId: planRow.id,
      planRevised: revised,
      openIssues: review.issues.length,
    };
  },
);

/**
 * Mastery keeper: after each session, apply its evidence to the learner's
 * mastery, review schedule and gap. One at a time per learner, so two
 * sessions finishing close together don't overwrite each other.
 */
export const masteryKeeper = inngest.createFunction(
  {
    id: "mastery-keeper",
    triggers: [sessionCompleted],
    concurrency: { key: "event.data.userId", limit: 1 },
    cancelOn: cancelOnDelete,
  },
  async ({ event, step }) => step.run("apply-session-evidence", () => applySessionEvidence(event.data.sessionId)),
);

/**
 * Coach: looks at the signals on one of a learner's goals after each session
 * and on the daily check. Debounced per goal, so the mastery keeper has
 * applied the session first and a burst of events makes one decision.
 */
export const coach = inngest.createFunction(
  {
    id: "coach",
    triggers: [coachCheck, sessionCompleted],
    debounce: { key: "event.data.userId + '-' + event.data.goalId", period: "5m" },
    cancelOn: cancelOnDelete,
  },
  async ({ event, step }) => step.run("run-coach", () => runCoach(event.data.userId, event.data.goalId)),
);

/** Once a day, ask the coach to check on every active goal with a plan. */
export const dailyCoachCheck = inngest.createFunction(
  { id: "daily-coach-check", triggers: [{ cron: "TZ=America/Los_Angeles 0 17 * * *" }] },
  async ({ step }) => {
    const targets = await step.run("list-goals", () => activeGoalPlans());
    if (targets.length > 0) {
      await step.sendEvent("fan-out", targets.map((t) => coachCheck.create(t)));
    }
    return { goals: targets.length };
  },
);

/**
 * Once a day, purge goals the learner removed more than 30 days ago, with
 * everything built for them. Their skills stay.
 */
export const purgeRemovedGoals = inngest.createFunction(
  { id: "purge-removed-goals", triggers: [{ cron: "TZ=America/Los_Angeles 0 4 * * *" }] },
  async ({ step }) => ({ purged: await step.run("purge", () => purgeExpiredGoals()) }),
);

/**
 * Replan huddle: the specialists coordinate on a revised plan, saved as a
 * proposal the learner accepts or declines. If it fails after retries, the
 * huddle is marked failed so the learner can ask again.
 */
export const huddle = inngest.createFunction(
  {
    id: "replan-huddle",
    triggers: [replanRequested],
    concurrency: { key: "event.data.userId", limit: 1 },
    cancelOn: cancelOnDelete,
    onFailure: async ({ event }) => {
      await failHuddle(event.data.event.data.huddleId);
    },
  },
  async ({ event, step }) =>
    // Step results come back JSON-serialized; everything here is plain JSON.
    runHuddleById(event.data.huddleId, (name, fn) => step.run(name, fn) as never),
);

/** Targets a learner picked in the last half year are kept fresh; others wait until someone picks them again. */
const IN_USE_DAYS = 180;

/**
 * Weekly: find cached targets whose requirements are stale (grounded ones
 * after 90 days, ungrounded ones after a week) and refresh each.
 */
export const weeklyRequirementsRefresh = inngest.createFunction(
  { id: "weekly-requirements-refresh", triggers: [{ cron: "TZ=America/Los_Angeles 0 3 * * 1" }] },
  async ({ step }) => {
    const ids = await step.run("find-due", async () => {
      const since = new Date(Date.now() - IN_USE_DAYS * 24 * 60 * 60 * 1000);
      return dueForRefresh(await loadRefreshCandidates(since), new Date());
    });
    if (ids.length > 0) {
      await step.sendEvent("fan-out", ids.map((requirementsId) => requirementsRefreshRequested.create({ requirementsId })));
    }
    return { due: ids.length };
  },
);

/**
 * Rebuild one target's requirements from current postings, keeping skill ids
 * where it can. Two at a time, since each run searches the web for a minute.
 */
export const refreshRequirements = inngest.createFunction(
  { id: "refresh-requirements", triggers: [requirementsRefreshRequested], concurrency: { limit: 2 } },
  async ({ event, step }) => {
    // Step results come back JSON-serialized; everything here is plain JSON.
    const result = await refreshTarget(event.data.requirementsId, (name, fn) => step.run(name, fn) as never);
    if ("notify" in result && result.notify.length > 0) {
      await step.sendEvent("tell-coach", result.notify.map((t) => coachCheck.create(t)));
    }
    return result;
  },
);

export const functions = [
  learnerLifecycle,
  masteryKeeper,
  coach,
  dailyCoachCheck,
  purgeRemovedGoals,
  huddle,
  weeklyRequirementsRefresh,
  refreshRequirements,
];

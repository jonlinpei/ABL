import { eq } from "drizzle-orm";

import { getDb, schema } from "@/db";

import { runHuddle } from "./huddle";
import { loadHuddle, saveProposal } from "./huddle-store";
import { loadMastery } from "./mastery-store";
import type { StepRunner } from "./planner";
import { detectSignals } from "./signals";
import { loadSessions } from "./store";
import { currentMilestone } from "./tutor";

/** Run an open huddle from its plan and the learner's record, and save the proposal. */
export async function runHuddleById(huddleId: string, run: StepRunner, now = new Date()) {
  const huddle = await run("load-huddle", () => loadHuddle(huddleId));
  if (!huddle || huddle.status !== "running") return { outcome: "not_running" as const };
  const db = getDb();
  const state = await run("load-state", async () => {
    const [plan] = await db.select().from(schema.plans).where(eq(schema.plans.id, huddle.fromPlanId));
    const [brief] = await db.select().from(schema.careerBriefs).where(eq(schema.careerBriefs.id, plan!.briefId));
    const [gap] = await db.select().from(schema.gaps).where(eq(schema.gaps.briefId, plan!.briefId));
    const sessions = await loadSessions(plan!.id);
    return { plan: plan!, brief: brief!.brief, gap: gap!.gap, sessions, mastery: await loadMastery(huddle.userId) };
  });
  const ended = state.sessions.filter((s) => s.endedAt && s.report);
  const history = ended.map((s) => ({ milestoneIndex: s.milestoneIndex, report: s.report!, endedAt: new Date(s.endedAt!).toISOString() }));
  const milestoneIndex = currentMilestone(state.plan.plan, history);
  const signals = detectSignals({
    plan: state.plan.plan,
    planStartedAt: new Date(state.plan.createdAt),
    sessions: state.sessions.map((s) => ({ milestoneIndex: s.milestoneIndex, endedAt: s.endedAt ? new Date(s.endedAt) : null, report: s.report })),
    mastery: state.mastery,
    milestoneIndex,
    now,
  });
  const trigger = huddle.messages.find((m) => m.kind === "trigger");
  const outcome = await runHuddle({
    brief: state.brief,
    gap: state.gap,
    plan: state.plan.plan,
    milestoneIndex,
    sessions: ended.map((s) => ({ endedAt: new Date(s.endedAt!), report: s.report! })),
    mastery: state.mastery,
    signals,
    request: huddle.request,
    source: trigger?.kind === "trigger" ? trigger.source : "learner",
    reason: trigger?.kind === "trigger" ? trigger.reason : "",
    userId: huddle.userId,
    today: now.toISOString().slice(0, 10),
    run,
  });
  const { planId } = await run("save-proposal", () => saveProposal(huddleId, outcome.replan, outcome.review, outcome.messages));
  return { outcome: "proposed" as const, planId, changes: outcome.replan.whatChanged.length, openIssues: outcome.review.issues.length };
}

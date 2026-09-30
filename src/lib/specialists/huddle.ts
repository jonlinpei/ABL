import { generateStructured } from "@/lib/ai/structured";
import { changeFacts } from "@/lib/goals/plan-diff";
import type { GoalBrief } from "@/lib/goals/schema";

import { COACH_SKILL } from "./coach.generated";
import type { MasteryRecord } from "./mastery";
import { checkPlan, checkReplanWorkload } from "./plan-checks";
import { planContext, reviewPlan, type StepRunner } from "./planner";
import { PLANNER_SKILL } from "./planner.generated";
import {
  CoachInputSchema,
  CoachObjectionSchema,
  ReplanSchema,
  type Gap,
  type HuddleMessage,
  type Plan,
  type PlanReview,
  type Replan,
  type ReplanRequest,
  type SessionReport,
} from "./schemas";
import type { Signal } from "./signals";

type Messages = HuddleMessage[];

/** The learner's constraints for the new plan: what they asked for, else the current plan's. */
export function effectiveBrief(brief: GoalBrief, plan: Plan, request: ReplanRequest): GoalBrief {
  return {
    ...brief,
    weeklyHours: request.weeklyHours ?? plan.weeklyHours,
    sessionMinutes: request.sessionMinutes ?? plan.sessionMinutes,
    deadline: request.deadline ?? brief.deadline,
  };
}

/** Mastery's input, from data: what moved, what's stuck, and must-haves reached since the plan was made. */
export function masteryInput(gap: Gap, mastery: MasteryRecord[], stuck: Signal[]): Extract<HuddleMessage, { from: "mastery" }> {
  const practised = new Map(mastery.map((m) => [m.skillId, m]));
  return {
    from: "mastery",
    kind: "input",
    progressed: gap.items
      .filter((i) => i.basis === "practiced" && practised.has(i.skillId))
      .map((i) => `${i.name}: now ${i.current} of ${i.required}`),
    stuck: stuck.flatMap((s) => (s.kind === "stuck_topic" ? [`${s.name}: level ${s.level} after ${s.sessionsOnMilestone} sessions`] : [])),
    alreadyMet: gap.items.filter((i) => i.importance === "must" && i.status === "met" && i.basis === "practiced").map((i) => i.name),
  };
}

/** Requirements' input, from data: must-haves the plan still has to close. */
export function requirementsInput(gap: Gap): Extract<HuddleMessage, { from: "requirements" }> {
  return {
    from: "requirements",
    kind: "input",
    openMustHaves: gap.items.filter((i) => i.importance === "must" && i.status !== "met").map((i) => `${i.name} (to ${i.required})`),
  };
}

/** What the planner and coach see about the current plan and the learner's progress on it. */
export function progressContext(
  plan: Plan,
  milestoneIndex: number,
  sessions: { endedAt: Date; report: SessionReport }[],
  request: ReplanRequest,
  signals: Signal[],
): string {
  const done = plan.milestones.slice(0, milestoneIndex).map((m) => `- Done: ${m.title}`);
  // Projects are listed so a replan keeps them, or drops one in the open.
  const remaining = plan.milestones
    .slice(milestoneIndex)
    .map((m) => `- ${m.title} (${m.weeks} wk${m.project ? `; builds: ${m.project}` : ""})`);
  const recaps = sessions.slice(-4).map((s) => `- ${s.endedAt.toISOString().slice(0, 10)}: ${s.report.recap}${s.report.endedEarly ? " (ended early)" : ""}`);
  const asked = [
    request.weeklyHours != null ? `${request.weeklyHours} hours a week` : null,
    request.sessionMinutes != null ? `${request.sessionMinutes}-minute sessions` : null,
    request.deadline ? `deadline: ${request.deadline}` : null,
  ].filter(Boolean);
  return `## Current plan: "${plan.title}" (${plan.weeklyHours} h/week, ${plan.sessionMinutes}-minute sessions)
${[...done, ...remaining].join("\n")}

## Their sessions so far (${sessions.length})
${recaps.join("\n") || "- None yet."}

## What they asked for
${asked.length ? `- ${asked.join("; ")}` : "- No new numbers."}
${request.note ? `- In their words: "${request.note}"` : ""}

## Signals
${signals.map((s) => `- ${JSON.stringify(s)}`).join("\n") || "- None."}`;
}

function inputsText(messages: Messages): string {
  return messages
    .filter((m) => m.kind === "input")
    .map((m) => {
      if (m.from === "mastery") return `### Mastery\n- Progressed: ${m.progressed.join("; ") || "none yet"}\n- Stuck: ${m.stuck.join("; ") || "none"}\n- Must-haves now met: ${m.alreadyMet.join("; ") || "none"}`;
      if (m.from === "requirements") return `### Requirements\n- Must-haves still open: ${m.openMustHaves.join("; ") || "none"}`;
      if (m.from === "coach") return `### Coach\n- ${m.engagement}\n${m.mustRespect.map((r) => `- Must respect: ${r}`).join("\n")}`;
      return "";
    })
    .join("\n\n");
}

async function draftReplan(context: string, userId: string, revision?: { plan: Replan; issues: PlanReview["issues"] }): Promise<Replan> {
  const prompt = revision
    ? `${context}\n\n## Your draft\n${JSON.stringify(revision.plan, null, 2)}\n\n## Objections to address\n${revision.issues.map((i) => `- [${i.severity}] ${i.issue} Fix: ${i.fix}`).join("\n")}\n\nReturn the whole revised replan. The learner never saw your draft: whatChanged and deadlineFit compare against their current plan (above), never against the draft.`
    : `${context}\n\nThis is a replan: follow the Replanning section. Write the revised plan for the remaining work, with whatChanged.`;
  const { output } = await generateStructured({ task: "replan", userId, instructions: PLANNER_SKILL, prompt, schema: ReplanSchema });
  return output;
}

export interface HuddleOutcome {
  replan: Replan;
  review: PlanReview;
  messages: Messages;
}

/**
 * The replan huddle (docs/architecture.md, "Adapting the plan"):
 * inputs in parallel, a proposal, one objection each from the reviewer and
 * the coach (plus code checks), then at most one revision and a decision.
 * Every step is a typed message, returned for the record.
 */
export async function runHuddle({
  brief,
  gap,
  plan,
  milestoneIndex,
  sessions,
  mastery,
  signals,
  request,
  source,
  reason,
  userId,
  today,
  run = (_name, fn) => fn(),
}: {
  brief: GoalBrief;
  gap: Gap;
  plan: Plan;
  milestoneIndex: number;
  sessions: { endedAt: Date; report: SessionReport }[];
  mastery: MasteryRecord[];
  signals: Signal[];
  request: ReplanRequest;
  source: "learner" | "coach";
  reason: string;
  userId: string;
  today: string;
  run?: StepRunner;
}): Promise<HuddleOutcome> {
  const target = effectiveBrief(brief, plan, request);
  const base = `${planContext(target, gap, today)}\n\n${progressContext(plan, milestoneIndex, sessions, request, signals)}`;
  const messages: Messages = [{ from: "system", kind: "trigger", source, request, reason }];

  // 1. Inputs. Mastery and requirements come straight from data; only the coach needs a model.
  const coach = await run("coach-input", async () =>
    (await generateStructured({
      task: "coach_decide",
      userId,
      instructions: COACH_SKILL,
      prompt: `${base}\n\nYou're in a replan huddle. Give your input (the first task in "In a replan huddle").`,
      schema: CoachInputSchema,
    })).output,
  );
  messages.push(masteryInput(gap, mastery, signals), requirementsInput(gap), { from: "coach", kind: "input", ...coach });
  const context = `${base}\n\n## Huddle inputs\n${inputsText(messages)}`;

  // 2. Proposal.
  const draft = await run("draft-replan", () => draftReplan(context, userId));
  messages.push({ from: "planner", kind: "proposal", title: draft.title, weeks: sum(draft), weeklyHours: draft.weeklyHours });

  // 3. Objections, in parallel: code checks, the reviewer, the coach.
  const [review, objection] = await Promise.all([
    run("review-replan", () => reviewPlan(context, draft, userId)),
    run("coach-objection", async () =>
      (await generateStructured({
        task: "coach_decide",
        userId,
        instructions: COACH_SKILL,
        prompt: `${base}\n\n## Proposed plan\n${JSON.stringify(draft, null, 2)}\n\nYou're in a replan huddle. Give at most one objection (the second task in "In a replan huddle").`,
        schema: CoachObjectionSchema,
      })).output,
    ),
  ]);
  // Code checks and the reviewer both speak as the reviewer; the coach speaks for itself.
  const hardChecks = (p: Replan) => [...checkPlan(p, gap, target), ...checkReplanWorkload(plan, milestoneIndex, p)];
  const reviewerIssues = [...hardChecks(draft), ...review.issues];
  const coachIssues: PlanReview["issues"] =
    objection.objection && objection.severity
      ? [{ severity: objection.severity, issue: objection.objection, fix: objection.objection }]
      : [];
  for (const i of reviewerIssues) messages.push({ from: "reviewer", kind: "objection", severity: i.severity, issue: i.issue });
  for (const i of coachIssues) messages.push({ from: "coach", kind: "objection", severity: i.severity, issue: i.issue });
  const issues = [...reviewerIssues, ...coachIssues];

  // 4. At most one revision, then the decision. The revision is re-checked in code only.
  let final = draft;
  if (issues.some((i) => i.severity === "must_fix")) {
    final = await run("revise-replan", () => draftReplan(context, userId, { plan: draft, issues }));
    messages.push({ from: "planner", kind: "revision", title: final.title, weeks: sum(final), weeklyHours: final.weeklyHours });
  }
  const open = final === draft ? issues : hardChecks(final);
  // 5. Describe the change from facts computed in code, so the summary and
  // the list the learner reads before choosing can't misstate it.
  const described = await run("describe-changes", () => describeChanges(plan, milestoneIndex, final, request, userId));
  final = { ...final, ...described };
  messages.push({ from: "planner", kind: "decision", whatChanged: final.whatChanged, openIssues: open.length });
  return {
    replan: final,
    review: { verdict: open.some((i) => i.severity === "must_fix") ? "revise" : "approve", issues: open },
    messages,
  };
}

const ChangeDescriptionSchema = ReplanSchema.pick({ changeSummary: true, whatChanged: true });

/** The summary and "what changed" for a rework, written from the computed facts of the change. */
export async function describeChanges(current: Plan, milestonesDone: number, replan: Replan, request: ReplanRequest, userId: string) {
  const { output } = await generateStructured({
    task: "replan",
    userId,
    instructions: PLANNER_SKILL,
    prompt: `Describe this rework to the learner, as set out under "Describing a rework". Use only these facts.

## What they asked for
${JSON.stringify(request)}

## The change, computed from the two plans
${changeFacts(current, milestonesDone, replan)}

## The planner's own notes on why
${replan.whatChanged.map((c) => `- ${c.change} ${c.because}`).join("\n") || "- None."}`,
    schema: ChangeDescriptionSchema,
  });
  return output;
}

function sum(plan: Plan): number {
  return plan.milestones.reduce((n, m) => n + m.weeks, 0);
}

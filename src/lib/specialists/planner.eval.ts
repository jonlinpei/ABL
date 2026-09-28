import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import { GoalBriefSchema } from "@/lib/goals/schema";

import { checkPlan, totalWeeks } from "./plan-checks";
import { planContext, planWithReview, reviewPlan } from "./planner";
import { GapSchema, type Gap, type Plan } from "./schemas";

vi.mock("@/lib/ai/usage-events", () => ({ captureAiGeneration: async () => {} }));

const TODAY = "2026-09-28";
const OUT = path.resolve(__dirname, "../../../skills/specialists-workspace", `planner-${new Date().toISOString().slice(0, 16).replace(":", "")}`);

function load(name: string) {
  const brief = GoalBriefSchema.parse(JSON.parse(readFileSync(path.join(__dirname, "fixtures", `${name}.brief.json`), "utf8")));
  const { gap } = JSON.parse(readFileSync(path.join(__dirname, "fixtures", `${name}.specialists.json`), "utf8"));
  return { brief, gap: GapSchema.parse(gap) };
}

/** Index of the first milestone that works on a matching skill, or -1. */
function firstMilestoneFor(plan: Plan, gap: Gap, pattern: RegExp) {
  const ids = new Set(gap.items.filter((i) => pattern.test(`${i.skillId} ${i.name}`)).map((i) => i.skillId));
  return plan.milestones.findIndex((m) => m.skills.some((s) => ids.has(s.skillId)));
}

async function run(name: string) {
  const { brief, gap } = load(name);
  const started = Date.now();
  const outcome = await planWithReview({ brief, gap, userId: "eval", today: TODAY });
  mkdirSync(OUT, { recursive: true });
  writeFileSync(path.join(OUT, `${name}.json`), JSON.stringify({ ...outcome, seconds: (Date.now() - started) / 1000 }, null, 2));
  const issues = checkPlan(outcome.plan, gap, brief);
  console.log(
    `LOG ${name}: ${totalWeeks(outcome.plan)} wk, ${outcome.plan.milestones.length} milestones, revised ${outcome.revised}, open ${JSON.stringify(outcome.review.issues.map((i) => i.severity))}, ${Math.round((Date.now() - started) / 1000)}s`,
  );
  return { brief, gap, plan: outcome.plan, issues };
}

describe.concurrent("planner on real briefs and gaps", () => {
  it("marketer to data analyst: SQL early, no re-teaching Excel", async () => {
    const r = await run("marketing-ops-to-data-analyst");
    expect(r.issues.filter((i) => i.severity === "must_fix")).toEqual([]);
    expect(r.issues.map((i) => i.issue).join(" ")).not.toMatch(/already at the needed level/);
    expect(firstMilestoneFor(r.plan, r.gap, /sql/i)).toBeLessThanOrEqual(1);
    // She quit twice around week three: the first milestone should be short.
    expect(r.plan.milestones[0]!.weeks).toBeLessThanOrEqual(4);
  });

  it("engineer to grid software: energy domain early, no backend basics", async () => {
    const r = await run("backend-engineer-to-climate-tech");
    expect(r.issues.filter((i) => i.severity === "must_fix")).toEqual([]);
    expect(r.issues.map((i) => i.issue).join(" ")).not.toMatch(/already at the needed level/);
    expect(firstMilestoneFor(r.plan, r.gap, /electric|grid|power|energy/i)).toBeLessThanOrEqual(1);
  });

  it("teacher to instructional designer: builds portfolio pieces along the way", async () => {
    const r = await run("teacher-to-instructional-designer");
    expect(r.issues.filter((i) => i.severity === "must_fix")).toEqual([]);
    const projects = r.plan.milestones.map((m) => m.project).filter(Boolean);
    expect(projects.length).toBeGreaterThanOrEqual(2);
    const firstProject = r.plan.milestones.findIndex((m) => m.project);
    expect(firstProject).toBeLessThan(r.plan.milestones.length - 1);
  });

  it("auditor to FP&A: modeling and forecasting early", async () => {
    const r = await run("audit-to-fpa");
    expect(r.issues.filter((i) => i.severity === "must_fix")).toEqual([]);
    expect(firstMilestoneFor(r.plan, r.gap, /model|forecast|budget/i)).toBeLessThanOrEqual(1);
  });

  it("reviewer catches a plan that hides a missed deadline", async () => {
    const { brief, gap } = load("marketing-ops-to-data-analyst");
    const out = JSON.parse(readFileSync(path.join(__dirname, "fixtures", "marketing-ops-to-data-analyst.specialists.json"), "utf8"));
    void out;
    // Every must-have covered, but 90 weeks at her hours against a one-year goal, claimed to fit.
    const mustIds = gap.items.filter((i) => i.status !== "met" && i.importance === "must");
    const bad: Plan = {
      title: "Data analyst in a year",
      summary: "A thorough path.",
      weeklyHours: brief.weeklyHours,
      sessionMinutes: brief.sessionMinutes,
      milestones: mustIds.map((i) => ({
        title: `Master ${i.name}`,
        weeks: Math.ceil(90 / mustIds.length),
        whyItMatters: "Required.",
        skills: [{ skillId: i.skillId, toLevel: i.required }],
        topics: [i.name],
        project: null,
        visibleWin: "Done.",
      })),
      firstSession: { title: "Set up", minutes: 30, whatYouWillDo: "Install tools and read the syllabus.", outcome: "Ready to start." },
      notCovered: [],
      deadlineFit: "This fits comfortably within your one-year goal.",
      assumptions: [],
    };
    expect(checkPlan(bad, gap, brief).filter((i) => i.severity === "must_fix")).toEqual([]);
    const review = await reviewPlan(planContext(brief, gap, TODAY), bad, "eval");
    console.log(`LOG reviewer on hidden deadline miss: ${review.verdict}; ${review.issues.map((i) => `[${i.severity}] ${i.issue}`).join(" | ")}`);
    expect(review.verdict).toBe("revise");
    expect(review.issues.some((i) => i.severity === "must_fix" && /deadline|year|week/i.test(i.issue))).toBe(true);
  });
});

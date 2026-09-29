import { beforeEach, describe, expect, it, vi } from "vitest";

import { sampleBrief } from "@/lib/goals/test-fixtures";

const generateStructured = vi.fn();
vi.mock("@/lib/ai/structured", () => ({ generateStructured: (...a: unknown[]) => generateStructured(...a) }));

const { planContext, planWithReview } = await import("./planner");
const { computeGap } = await import("./gap");
const { samplePlan, sampleProfile, sampleRequirements } = await import("./test-fixtures");

const gap = computeGap(sampleRequirements, sampleProfile);
const brief = { ...sampleBrief, weeklyHours: 3, sessionMinutes: 45 };
const approve = { verdict: "approve", issues: [] };
const tasks = () => generateStructured.mock.calls.map((c) => c[0].task);

beforeEach(() => generateStructured.mockReset());

describe("planWithReview", () => {
  it("keeps an approved draft without revising", async () => {
    generateStructured.mockResolvedValueOnce({ output: samplePlan }).mockResolvedValueOnce({ output: approve });
    const out = await planWithReview({ brief, gap, userId: "u", today: "2026-09-28" });
    expect(out).toMatchObject({ plan: samplePlan, revised: false, review: { verdict: "approve" } });
    expect(tasks()).toEqual(["roadmap_generate", "plan_review"]);
  });

  it("revises once when code checks fail, even if the reviewer approved, and passes the issues on", async () => {
    const tooMuch = { ...samplePlan, weeklyHours: 6 };
    generateStructured
      .mockResolvedValueOnce({ output: tooMuch })
      .mockResolvedValueOnce({ output: approve })
      .mockResolvedValueOnce({ output: samplePlan });
    const out = await planWithReview({ brief, gap, userId: "u", today: "2026-09-28" });
    expect(out).toMatchObject({ plan: samplePlan, revised: true, review: { verdict: "approve", issues: [] } });
    expect(tasks()).toEqual(["roadmap_generate", "plan_review", "roadmap_generate"]);
    expect(generateStructured.mock.calls[2]![0].prompt).toMatch(/Plans 6 h\/week; the learner has 3/);
  });

  it("records must-fix issues that survive the one revision instead of looping", async () => {
    const tooMuch = { ...samplePlan, weeklyHours: 6 };
    generateStructured
      .mockResolvedValueOnce({ output: tooMuch })
      .mockResolvedValueOnce({ output: { verdict: "revise", issues: [{ severity: "must_fix", issue: "x", fix: "y" }] } })
      .mockResolvedValueOnce({ output: tooMuch });
    const out = await planWithReview({ brief, gap, userId: "u", today: "2026-09-28" });
    expect(out.review.verdict).toBe("revise");
    expect(out.review.issues[0]!.issue).toMatch(/Plans 6 h\/week/);
    expect(generateStructured).toHaveBeenCalledTimes(3);
  });

  it("runs each model call through the step runner, by name", async () => {
    generateStructured.mockResolvedValueOnce({ output: samplePlan }).mockResolvedValueOnce({ output: approve });
    const names: string[] = [];
    await planWithReview({ brief, gap, userId: "u", today: "2026-09-28", run: (name, fn) => (names.push(name), fn()) });
    expect(names).toEqual(["draft-plan", "review-plan"]);
  });
});

describe("planContext", () => {
  it("gives today's date, the learner's limits and every gap skill id", () => {
    const ctx = planContext(brief, gap, "2026-09-28");
    expect(ctx).toContain("Today is 2026-09-28.");
    expect(ctx).toContain("3 hours a week, sessions of 45 minutes");
    for (const i of gap.items) expect(ctx).toContain(`- ${i.skillId}:`);
  });

  it("says how often postings ask for a skill and how to show it, for skills still to close", () => {
    const grounded = {
      ...gap,
      items: gap.items.map((i) => ({ ...i, frequency: "core" as const, howToShow: `A project for ${i.name}` })),
    };
    const ctx = planContext(brief, grounded, "2026-09-28");
    expect(ctx).toMatch(/sql-querying: SQL querying \(technical, must, core in job postings\).*Show it: A project for SQL querying/);
    expect(ctx).not.toContain("Show it: A project for Spreadsheets");
  });
});

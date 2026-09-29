import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { createAnthropic } from "@ai-sdk/anthropic";
import { generateText, Output } from "ai";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { GoalBriefSchema } from "@/lib/goals/schema";

import { computeGap } from "./gap";
import { checkPlan } from "./plan-checks";
import { planWithReview } from "./planner";
import { buildProfile } from "./profiler";
import { buildRequirements, MIN_POSTINGS, researchPostings, withoutGonePostings } from "./requirements";

// Evals don't report usage to PostHog.
vi.mock("@/lib/ai/usage-events", () => ({ captureAiGeneration: async () => {} }));

const OUT = path.resolve(__dirname, "../../../skills/specialists-workspace", `grounded-${new Date().toISOString().slice(0, 16).replace(":", "")}`);
const brief = GoalBriefSchema.parse(
  JSON.parse(readFileSync(path.join(__dirname, "fixtures", "marketing-ops-to-data-analyst.brief.json"), "utf8")),
);

describe("requirements grounded in job postings", () => {
  it("marketing ops to data analyst: real postings, counted frequencies, SQL is core", async () => {
    const started = Date.now();
    const research = await researchPostings(brief, "eval");
    const researchSeconds = (Date.now() - started) / 1000;
    const requirements = await buildRequirements(brief, "eval", research);
    // Research already dropped gone pages; check again that none got through.
    const live = new Set((await withoutGonePostings(research.postings)).map((p) => p.url));
    const dead = research.postings.map((p) => p.url).filter((u) => !live.has(u));

    mkdirSync(OUT, { recursive: true });
    writeFileSync(path.join(OUT, "data-analyst.json"), JSON.stringify({ research, requirements, dead, researchSeconds }, null, 2));
    console.error(
      `GROUNDED ${research.postings.length} postings in ${Math.round(researchSeconds)}s, ${dead.length} dead\n` +
        requirements.skills.map((s) => `  ${s.importance.padEnd(4)} ${String(s.frequency ?? "-").padEnd(9)} ${s.postingShare ?? "-"}  ${s.name}`).join("\n"),
    );

    // Real, distinct postings.
    const postings = research.postings;
    expect(postings.length).toBeGreaterThanOrEqual(MIN_POSTINGS);
    expect(new Set(postings.map((p) => p.url)).size).toBe(postings.length);
    expect(postings.every((p) => /^https?:\/\//.test(p.url))).toBe(true);
    expect(dead, "dead links").toEqual([]);

    // Grounded, and counted.
    expect(requirements.sources).toHaveLength(postings.length);
    const counted = requirements.skills.filter((s) => s.frequency);
    expect(counted.length).toBeGreaterThanOrEqual(requirements.skills.length / 2);
    expect(requirements.skills.every((s) => s.howToShow && s.howToShow.length > 20)).toBe(true);

    // SQL is core, and the count roughly matches the postings' own text.
    const sql = requirements.skills.find((s) => /sql/i.test(`${s.id} ${s.name}`));
    expect(sql).toMatchObject({ frequency: "core", importance: "must" });
    const textShare = postings.filter((p) => p.requirements.some((r) => /sql/i.test(r.text))).length / postings.length;
    expect(Math.abs(sql!.postingShare! - textShare)).toBeLessThanOrEqual(0.2);

    // Not too restrictive: must-haves are a minority, and years of experience aren't skills.
    expect(requirements.skills.filter((s) => s.importance === "must").length).toBeLessThanOrEqual(requirements.skills.length * 0.6);
    expect(requirements.skills.some((s) => /years|experience/i.test(`${s.id} ${s.name}`))).toBe(false);

    // On to the plan: every open must-have is shown in a project, not just learned.
    const profile = await buildProfile(brief, requirements, "eval");
    const gap = computeGap(requirements, profile);
    const { plan } = await planWithReview({ brief, gap, userId: "eval", today: "2026-09-29" });
    writeFileSync(path.join(OUT, "data-analyst-plan.json"), JSON.stringify({ gap, plan }, null, 2));
    expect(checkPlan(plan, gap, brief).filter((i) => i.severity === "must_fix")).toEqual([]);
    const shown = new Set(plan.milestones.filter((m) => m.project).flatMap((m) => m.projectShows));
    const open = gap.items.filter((i) => i.importance === "must" && i.status !== "met");
    expect(open.filter((i) => !shown.has(i.skillId)).map((i) => i.name)).toEqual([]);

    // And the projects really show what they claim.
    const projects = plan.milestones
      .filter((m) => m.project)
      .map((m, i) => `${i}. ${m.project}\n   Claims to show: ${m.projectShows.map((id) => gap.items.find((g) => g.skillId === id)?.name ?? id).join(", ")}`);
    const { output } = await generateText({
      model: createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY })("claude-opus-5-5"),
      instructions: "You're a hiring manager for junior data analysts. Judge strictly but fairly.",
      prompt: `A career switcher's learning plan lists these portfolio projects and the skills each claims to show:\n\n${projects.join("\n")}\n\nFor each project, would seeing it (or hearing them walk through it) give you real evidence of every skill it claims? Fail a project only if it claims a skill it would barely show.`,
      output: Output.object({ schema: z.object({ results: z.array(z.object({ index: z.number(), passed: z.boolean(), evidence: z.string() })) }) }),
      abortSignal: AbortSignal.timeout(180_000),
    });
    const failed = output.results.filter((r) => !r.passed);
    expect(failed.length, JSON.stringify(failed, null, 2)).toBeLessThanOrEqual(Math.floor(projects.length / 4));
  }, 900_000);
});

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import { GoalBriefSchema } from "@/lib/goals/schema";

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
  }, 600_000);
});

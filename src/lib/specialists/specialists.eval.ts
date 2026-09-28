import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import { GoalBriefSchema, type GoalBrief } from "@/lib/goals/schema";

import { computeGap } from "./gap";
import { buildProfile } from "./profiler";
import { buildRequirements } from "./requirements";
import type { Gap, LearnerProfile, TargetRequirements } from "./schemas";

// Evals don't report usage to PostHog.
vi.mock("@/lib/ai/usage-events", () => ({ captureAiGeneration: async () => {} }));

const OUT = path.resolve(__dirname, "../../../skills/specialists-workspace", new Date().toISOString().slice(0, 16).replace(":", ""));

function brief(name: string): GoalBrief {
  const raw = JSON.parse(readFileSync(path.join(__dirname, "fixtures", `${name}.brief.json`), "utf8"));
  return GoalBriefSchema.parse(raw);
}

async function run(name: string) {
  const b = brief(name);
  const requirements = await buildRequirements(b, "eval");
  const profile = await buildProfile(b, requirements, "eval");
  const gap = computeGap(requirements, profile);
  mkdirSync(OUT, { recursive: true });
  writeFileSync(path.join(OUT, `${name}.json`), JSON.stringify({ requirements, profile, gap }, null, 2));
  return { requirements, profile, gap };
}

/** The first required skill whose id or name matches, with the learner's level on it. */
function skill(r: { requirements: TargetRequirements; profile: LearnerProfile }, pattern: RegExp) {
  const req = r.requirements.skills.find((s) => pattern.test(`${s.id} ${s.name}`));
  const has = req && r.profile.skills.find((s) => s.skillId === req.id);
  return req && has ? { ...req, current: has.level, basis: has.basis } : undefined;
}

/** Every required skill whose id or name matches, with the learner's level on it. */
function skills(r: { requirements: TargetRequirements; profile: LearnerProfile }, pattern: RegExp) {
  return r.requirements.skills
    .filter((s) => pattern.test(`${s.id} ${s.name}`))
    .map((req) => ({ ...req, ...r.profile.skills.find((s) => s.skillId === req.id)!, current: r.profile.skills.find((s) => s.skillId === req.id)!.level }));
}

function checkShape(r: { requirements: TargetRequirements; profile: LearnerProfile; gap: Gap }) {
  const ids = r.requirements.skills.map((s) => s.id);
  expect(ids.length).toBeGreaterThanOrEqual(8);
  expect(ids.length).toBeLessThanOrEqual(15);
  expect(new Set(ids).size).toBe(ids.length);
  expect(r.requirements.skills.some((s) => s.importance === "must")).toBe(true);
  expect(r.profile.skills.map((s) => s.skillId)).toEqual(ids);
}

describe.concurrent("requirements analyst and profiler on real discovery briefs", () => {
  it("teacher to instructional designer: credits curriculum design, not authoring tools", async () => {
    const r = await run("teacher-to-instructional-designer");
    checkShape(r);
    // Her transfer: analysing needs, writing objectives, designing assessment.
    const design = skills(r, /objective|curriculum|needs.analysis|evaluation|assessment/i);
    const authoring = skill(r, /authoring|articulate|storyline|rise|captivate/i);
    expect(design.length, "learning-design skills are required").toBeGreaterThanOrEqual(1);
    expect(design.some((s) => s.current >= 2 && s.basis === "work_history")).toBe(true);
    expect(authoring, "an e-learning authoring tool is required").toBeDefined();
    expect(authoring!.current).toBeLessThanOrEqual(1);
    expect(r.requirements.proofOfSkill.join(" ")).toMatch(/portfolio/i);
  });

  it("marketing ops to data analyst: SQL is a must-have gap, spreadsheets are met", async () => {
    const r = await run("marketing-ops-to-data-analyst");
    checkShape(r);
    const sql = skill(r, /sql/i);
    const sheets = skill(r, /excel|spreadsheet/i);
    expect(sql?.importance).toBe("must");
    expect(sql!.current).toBeLessThanOrEqual(1);
    expect(sheets!.current).toBeGreaterThanOrEqual(3);
  });

  it("audit to FP&A: credits financial statement fluency, not forecasting models", async () => {
    const r = await run("audit-to-fpa");
    checkShape(r);
    const statements = skill(r, /financial.statement|accounting|gaap/i);
    const modeling = skill(r, /model|forecast/i);
    expect(statements!.current).toBeGreaterThanOrEqual(3);
    expect(statements!.basis).toBe("work_history");
    expect(modeling!.current).toBeLessThanOrEqual(2);
  });

  it("backend engineer to climate tech: engineering is met, the gap is energy domain knowledge", async () => {
    const r = await run("backend-engineer-to-climate-tech");
    checkShape(r);
    const domain = r.requirements.skills.filter((s) => s.category === "domain");
    expect(domain.length, "the new industry's domain knowledge is required").toBeGreaterThanOrEqual(1);
    // The core of the new industry is what he lacks; adjacent awareness
    // (e.g. compliance, from payments) can fairly count.
    const energy = r.gap.items.filter((i) => i.category === "domain" && /electric|grid|power|energy.market/i.test(`${i.skillId} ${i.name}`));
    expect(energy.length).toBeGreaterThanOrEqual(1);
    expect(energy.some((i) => i.status === "missing")).toBe(true);
    const domainItems = r.gap.items.filter((i) => i.category === "domain");
    expect(domainItems.filter((i) => i.status !== "met").length / domainItems.length).toBeGreaterThanOrEqual(0.5);
    const engineering = r.gap.items.filter((i) => i.category !== "domain" && i.category !== "professional");
    const met = engineering.filter((i) => i.status === "met").length;
    expect(met / engineering.length).toBeGreaterThanOrEqual(0.6);
  });
});

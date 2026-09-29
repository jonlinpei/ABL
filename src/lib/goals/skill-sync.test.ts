import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";
import { z } from "zod";

import { ASSESSOR_SKILL } from "../specialists/assessor.generated";
import { COACH_SKILL } from "../specialists/coach.generated";
import { PLAN_REVIEWER_SKILL } from "../specialists/plan-reviewer.generated";
import { PLANNER_SKILL } from "../specialists/planner.generated";
import { POSTING_RESEARCHER_SKILL } from "../specialists/posting-researcher.generated";
import { PROFILER_SKILL } from "../specialists/profiler.generated";
import { TUTOR_SKILL } from "../specialists/tutor.generated";
import { REQUIREMENTS_ANALYST_SKILL } from "../specialists/requirements-analyst.generated";
import { GOAL_CLARIFICATION_SKILL } from "./goal-clarification.generated";
import { GoalBriefSchema } from "./schema";

const skillPath = path.resolve(__dirname, "../../../skills/goal-clarification/SKILL.md");
const skill = readFileSync(skillPath, "utf8");

describe("goal-clarification skill", () => {
  it("generated prompt matches SKILL.md (run `pnpm skills:sync` if this fails)", () => {
    expect(GOAL_CLARIFICATION_SKILL).toBe(skillBody("goal-clarification"));
  });

  it("documents every goal brief field the app's schema defines", () => {
    for (const field of briefFields(GoalBriefSchema.shape)) {
      expect(skill, `SKILL.md is missing \`${field}\``).toContain(`\`${field}\``);
    }
  });
});

/** Field names, with nested objects as dotted paths ("current.role"). */
function briefFields(shape: z.ZodRawShape, prefix = ""): string[] {
  return Object.entries(shape).flatMap(([key, schema]) =>
    schema instanceof z.ZodObject
      ? briefFields(schema.shape, `${prefix}${key}.`)
      : [`${prefix}${key}`],
  );
}

describe("specialist skills", () => {
  it.each([
    ["posting-researcher", POSTING_RESEARCHER_SKILL],
    ["requirements-analyst", REQUIREMENTS_ANALYST_SKILL],
    ["profiler", PROFILER_SKILL],
    ["assessor", ASSESSOR_SKILL],
    ["planner", PLANNER_SKILL],
    ["plan-reviewer", PLAN_REVIEWER_SKILL],
    ["tutor", TUTOR_SKILL],
    ["coach", COACH_SKILL],
  ])("generated prompt for %s matches its SKILL.md (run `pnpm skills:sync` if this fails)", (name, generated) => {
    expect(generated).toBe(skillBody(name));
  });
});

function skillBody(name: string): string {
  const md = readFileSync(path.resolve(__dirname, `../../../skills/${name}/SKILL.md`), "utf8");
  return md.replace(/^---\n[\s\S]*?\n---\n/, "").trim();
}

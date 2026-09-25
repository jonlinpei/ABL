import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { GOAL_CLARIFICATION_SKILL } from "./goal-clarification.generated";
import { DomainId, GoalBriefSchema } from "./schema";

const skillPath = path.resolve(__dirname, "../../../skills/goal-clarification/SKILL.md");
const skill = readFileSync(skillPath, "utf8");

describe("goal-clarification skill", () => {
  it("generated prompt matches SKILL.md (run `pnpm skills:sync` if this fails)", () => {
    const body = skill.replace(/^---\n[\s\S]*?\n---\n/, "").trim();
    expect(GOAL_CLARIFICATION_SKILL).toBe(body);
  });

  it("documents every goal brief field the app's schema defines", () => {
    for (const field of Object.keys(GoalBriefSchema.shape)) {
      expect(skill, `SKILL.md is missing \`${field}\``).toContain(`\`${field}\``);
    }
  });

  it("documents every supported subject area id", () => {
    for (const id of DomainId.options) {
      expect(skill, `SKILL.md is missing \`${id}\``).toContain(`\`${id}\``);
    }
  });
});

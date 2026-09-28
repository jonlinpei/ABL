// Generates TypeScript prompt modules from the skills in skills/.
// The skill's SKILL.md is the source of truth; the app imports the generated
// body so the product prompt and the Claude skill never drift apart.
//
//   node scripts/sync-skills.mjs          write generated files
//   node scripts/sync-skills.mjs --check  exit 1 if a generated file is stale
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");

const SKILLS = [
  {
    source: "skills/goal-clarification/SKILL.md",
    target: "src/lib/goals/goal-clarification.generated.ts",
    exportName: "GOAL_CLARIFICATION_SKILL",
  },
  {
    source: "skills/requirements-analyst/SKILL.md",
    target: "src/lib/specialists/requirements-analyst.generated.ts",
    exportName: "REQUIREMENTS_ANALYST_SKILL",
  },
  {
    source: "skills/profiler/SKILL.md",
    target: "src/lib/specialists/profiler.generated.ts",
    exportName: "PROFILER_SKILL",
  },
  {
    source: "skills/assessor/SKILL.md",
    target: "src/lib/specialists/assessor.generated.ts",
    exportName: "ASSESSOR_SKILL",
  },
  {
    source: "skills/planner/SKILL.md",
    target: "src/lib/specialists/planner.generated.ts",
    exportName: "PLANNER_SKILL",
  },
  {
    source: "skills/plan-reviewer/SKILL.md",
    target: "src/lib/specialists/plan-reviewer.generated.ts",
    exportName: "PLAN_REVIEWER_SKILL",
  },
  {
    source: "skills/tutor/SKILL.md",
    target: "src/lib/specialists/tutor.generated.ts",
    exportName: "TUTOR_SKILL",
  },
];

/** SKILL.md minus its YAML frontmatter. */
export function skillBody(markdown) {
  const match = markdown.match(/^---\n[\s\S]*?\n---\n/);
  return (match ? markdown.slice(match[0].length) : markdown).trim();
}

function render({ source, exportName }, body) {
  return [
    `// GENERATED from ${source} by scripts/sync-skills.mjs. Do not edit;`,
    `// edit the skill and run \`pnpm skills:sync\`.`,
    `export const ${exportName} = ${JSON.stringify(body)};`,
    ``,
  ].join("\n");
}

const check = process.argv.includes("--check");
let stale = 0;

for (const skill of SKILLS) {
  const body = skillBody(readFileSync(path.join(root, skill.source), "utf8"));
  const next = render(skill, body);
  const targetPath = path.join(root, skill.target);
  const current = existsSync(targetPath) ? readFileSync(targetPath, "utf8") : null;
  if (current === next) continue;
  if (check) {
    console.error(`stale: ${skill.target} (run pnpm skills:sync)`);
    stale++;
  } else {
    writeFileSync(targetPath, next);
    console.log(`wrote ${skill.target}`);
  }
}

if (stale) process.exit(1);

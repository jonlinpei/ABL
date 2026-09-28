import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { createAnthropic } from "@ai-sdk/anthropic";
import { generateText, tool, type ModelMessage } from "ai";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { GoalBriefSchema } from "@/lib/goals/schema";

import {
  assessmentAccepted,
  assessorContext,
  checkSubmission,
  incompleteReply,
  selectSkillsToCheck,
  submissionSchema,
} from "./assessment";
import { ASSESSOR_SKILL } from "./assessor.generated";
import { AssessedSkill, GapSchema } from "./schemas";

// The tutor side matches the router's standard tier for assessment_run.
const anthropic = createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const ASSESSOR_MODEL = "claude-sonnet-5";
const LEARNER_MODEL = "claude-sonnet-5";
const OUT = path.resolve(__dirname, "../../../skills/specialists-workspace", `assessor-${new Date().toISOString().slice(0, 16).replace(":", "")}`);

/**
 * Each persona knows its true level on every skill the check will cover, as
 * behaviour rather than a number. Some are above the profiler's estimate,
 * some below: the check should find the truth either way.
 */
const PERSONAS: Record<string, { persona: string; truth: Record<string, { level: number; how: string }> }> = {
  "marketing-ops-to-data-analyst": {
    persona: "You are Maya, 30, a marketing operations coordinator at a B2B SaaS company.",
    truth: {
      "saas-metrics": { level: 3, how: "You calculate CAC, MQL-to-SQL conversion and pipeline velocity every month and know how MRR, churn and net revenue retention relate. Answer with specific, correct detail." },
      "bi-dashboarding": { level: 2, how: "You build dashboards in HubSpot's report builder and choose sensible charts, but you've never used Tableau, Looker or Power BI and don't know how to model data for them." },
      "statistics-experimentation": { level: 1, how: "You've run email subject-line A/B tests with HubSpot's built-in tool, but you don't know what statistical significance or sample size means in practice." },
    },
  },
  "backend-engineer-to-climate-tech": {
    persona: "You are Jordan, 32, a senior backend engineer at a payments company.",
    truth: {
      "sql-data-modeling": { level: 3, how: "You design Postgres schemas for the ledger, write window functions and tune slow queries with EXPLAIN. Answer with specific detail." },
      "cloud-infrastructure": { level: 2, how: "A platform team owns the infrastructure. You deploy through their pipeline and have edited Terraform with their help, but you've never set up networking, IAM or a new service's infrastructure yourself." },
      "cross-functional-domain-communication": { level: 3, how: "You regularly work with finance and compliance to turn their requirements into system designs and explain trade-offs to non-engineers." },
      "python-data-tooling": { level: 2, how: "You write Python services comfortably and have used pandas for one-off analyses, looking up most of the API as you go." },
      "nerc-cip-security-awareness": { level: 0, how: "You've never heard of NERC CIP." },
    },
  },
  "teacher-to-instructional-designer": {
    persona: "You are Dana, 33, a high school biology teacher and science department lead.",
    truth: {
      "instructional-design-models": { level: 1, how: "You've heard of ADDIE from a Coursera course you didn't finish, but you couldn't say how you'd use it on a real project." },
      "storyboarding": { level: 2, how: "You outline lessons and planned your lab-safety video series in a shot list, but you've never written a formal e-learning storyboard with screens, narration and interactions." },
      "learning-project-management": { level: 2, how: "You plan a school year of units and ran a curriculum rebuild with deadlines, but never with stakeholders, sign-offs or a budget like a corporate project." },
      "virtual-instructor-led-design": { level: 3, how: "You taught remotely for a year and ran monthly Zoom PD for your department, designing breakouts, polls and pacing for online groups. Answer with specific detail." },
    },
  },
  "audit-to-fpa": {
    persona: "You are Priya, 36, a CPA with ten years in audit.",
    truth: {
      "advanced-excel": { level: 3, how: "You use INDEX/MATCH, pivot tables, SUMIFS and some Power Query daily on large client trial balances. Answer with specific detail." },
      "variance-analysis": { level: 3, how: "In audit you run analytical review procedures: set an expectation, compare to actuals, and investigate anything past a threshold with management. Answer with specific detail." },
      "erp-systems": { level: 2, how: "You pull reports from SAP and NetSuite as an auditor, but you've never configured one or worked in it day to day." },
      "unit-economics-analysis": { level: 1, how: "You know roughly what CAC and LTV are, but you've never built a unit economics analysis." },
    },
  },
};

function load(name: string) {
  const brief = GoalBriefSchema.parse(JSON.parse(readFileSync(path.join(__dirname, "fixtures", `${name}.brief.json`), "utf8")));
  const { gap } = JSON.parse(readFileSync(path.join(__dirname, "fixtures", `${name}.specialists.json`), "utf8"));
  return { brief, gap: GapSchema.parse(gap) };
}

async function runCheck(name: string) {
  const { brief, gap } = load(name);
  const skills = selectSkillsToCheck(gap);
  const { persona, truth } = PERSONAS[name]!;
  const ids = skills.map((s) => s.skillId) as [string, ...string[]];
  let results: z.infer<typeof AssessedSkill>[] | undefined;
  let rejected = 0;
  // Same accept/reject rule as the /api/assess route, minus the database.
  const submit = tool({
    description: "Record the level each checked skill showed. Call once, after the last skill.",
    inputSchema: submissionSchema(ids),
    strict: true,
    execute: async (input) => {
      const check = checkSubmission(input.results, ids);
      if (!check.ok) {
        rejected++;
        return incompleteReply(check.missing);
      }
      results = check.results;
      return { status: "saved" as const };
    },
  });

  const learnerSystem = `${persona} An app is giving you a short skills check before building your learning plan.

How much you really know, per topic (never state these as levels or numbers):
${skills.map((s) => `- ${s.name}: ${truth[s.skillId]!.how}`).join("\n")}

Answer honestly as this person would, in 1 to 4 sentences, like a busy adult typing. A strong answer names specific steps, tools and pitfalls; a weak one is vague or says you haven't done it. Don't overclaim or underclaim.`;

  const tutor: ModelMessage[] = [{ role: "user", content: "I'm ready." }];
  const learner: ModelMessage[] = [{ role: "assistant", content: "I'm ready." }];
  const log: { role: string; text: string }[] = [{ role: "learner", text: "I'm ready." }];
  let turns = 0;

  for (; turns < skills.length * 2 + 3 && !results; turns++) {
    const r = await generateText({
      model: anthropic(ASSESSOR_MODEL),
      instructions: `${ASSESSOR_SKILL}\n\n${assessorContext(brief, skills)}`,
      messages: tutor,
      tools: { submit_assessment: submit },
      stopWhen: assessmentAccepted,
    });
    tutor.push(...r.response.messages);
    const text = r.steps.map((s) => s.text).join("\n").trim();
    log.push({ role: "tutor", text });
    if (results) break;
    learner.push({ role: "user", content: text });
    const reply = await generateText({ model: anthropic(LEARNER_MODEL), instructions: learnerSystem, messages: learner });
    learner.push({ role: "assistant", content: reply.text });
    tutor.push({ role: "user", content: reply.text });
    log.push({ role: "learner", text: reply.text });
  }

  const scored = skills.map((s) => {
    const got = results?.find((r) => r.skillId === s.skillId);
    return { skillId: s.skillId, estimated: s.current, truth: truth[s.skillId]!.level, assessed: got?.level, confidence: got?.confidence };
  });
  mkdirSync(OUT, { recursive: true });
  writeFileSync(path.join(OUT, `${name}.json`), JSON.stringify({ scored, results, rejected, log }, null, 2));
  return { scored, log, submitted: !!results, turns, rejected };
}

describe.concurrent("assessor finds true levels in simulated skills checks", () => {
  for (const name of Object.keys(PERSONAS)) {
    it(name, async () => {
      const { scored, log, submitted } = await runCheck(name);
      console.log(`LOG ${name}: ${scored.map((s) => `${s.skillId} est ${s.estimated} true ${s.truth} got ${s.assessed}`).join(" | ")}`);
      expect(submitted, "submitted results").toBe(true);
      for (const s of scored) {
        expect(Math.abs((s.assessed ?? -9) - s.truth), `${s.skillId}: true ${s.truth}, assessed ${s.assessed}`).toBeLessThanOrEqual(1);
      }
      const tutorQuestions = log.filter((l) => l.role === "tutor").map((l) => (l.text.match(/\?/g) ?? []).length);
      expect(Math.max(...tutorQuestions), `question marks per message: ${tutorQuestions}`).toBeLessThanOrEqual(2);
    });
  }
});

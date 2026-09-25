// Grades simulated-learner runs for the goal-clarification skill.
// `code` assertions are checked here; `judge` assertions are judged by a model
// that reads only the conversation (it isn't told which configuration ran).
//
// Run from the repo root (needs ANTHROPIC_API_KEY):
//   node --env-file=.env.local skills/goal-clarification/evals/grade.mjs --iteration 1
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { createAnthropic } from "@ai-sdk/anthropic";
import { generateText, Output } from "ai";
import { z } from "zod";

import { GoalBriefSchema } from "../../../src/lib/goals/schema.ts";

import { hasValue } from "./checks.mjs";

const SKILL_DIR = path.resolve(import.meta.dirname, "..");
const WORKSPACE = path.resolve(SKILL_DIR, "..", "goal-clarification-workspace");
const JUDGE_MODEL = "claude-opus-5-5";

const iteration = Number(process.argv[process.argv.indexOf("--iteration") + 1] || 1);
const iterDir = path.join(WORKSPACE, `iteration-${iteration}`);
const evals = JSON.parse(readFileSync(path.join(SKILL_DIR, "evals", "evals.json"), "utf8")).evals;
const anthropic = createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

/** Questions in a tutor message, ignoring anything inside a brief. */
const countQuestions = (text) => (text.match(/\?/g) ?? []).length;

/** Passes when the first brief came by tutor turn `n`. */
const briefWithin = (n) => (r) => [
  r.briefTurn != null && r.briefTurn <= n,
  r.briefTurn != null ? `First brief at tutor turn ${r.briefTurn}` : "No brief proposed",
];

const CODE_CHECKS = {
  max_two_questions: (r) => {
    const counts = r.log.filter((l) => l.role === "tutor").map((l) => countQuestions(l.text));
    const max = Math.max(0, ...counts);
    return [max <= 2, `Question marks per tutor message: [${counts.join(", ")}]`];
  },
  brief_within_6: briefWithin(6),
  brief_within_4: briefWithin(4),
  brief_valid: (r) => {
    if (!r.finalBrief) return [false, "No brief proposed"];
    const p = GoalBriefSchema.safeParse(r.finalBrief);
    const invalid = r.invalidBriefs?.length ?? 0;
    return [
      p.success && invalid === 0,
      p.success ? `Valid. Invalid attempts: ${invalid}` : p.error.issues.map((i) => i.message).join("; "),
    ];
  },
  no_brief: (r) => [r.briefs.length === 0 && !(r.invalidBriefs?.length), `Briefs proposed: ${r.briefs.length}`],
  subject_data: (r) => subjectMatches(r, /data|analy|sql/i),
  subject_piano: (r) => subjectMatches(r, /piano/i),
  subject_ai: (r) => subjectMatches(r, /\bAI\b|copilot|artificial intelligence/i),
  subject_spanish: (r) => subjectMatches(r, /spanish/i),
  subject_bookkeeping: (r) => subjectMatches(r, /bookkeep|quickbooks|accounting/i),
  first_brief_accurate: (r, ev) => {
    const wrong = truthErrors(r.briefs[0], ev.truth);
    if (!wrong) return [false, "No brief proposed"];
    return [wrong.length === 0, wrong.length ? `Wrong: ${wrong.map((w) => w.detail).join("; ")}` : "All match"];
  },
  no_unflagged_errors: (r, ev) => {
    const wrong = truthErrors(r.briefs[0], ev.truth);
    if (!wrong) return [false, "No brief proposed"];
    const unflagged = wrong.filter((w) => !r.briefs[0].inferred?.includes(w.field));
    return [
      unflagged.length === 0,
      wrong.length
        ? `Wrong: ${wrong.map((w) => w.detail).join("; ")}. Inferred: ${JSON.stringify(r.briefs[0].inferred)}`
        : "No wrong values",
    ];
  },
  subject_real_estate: (r) => subjectMatches(r, /real estate|salesperson/i),
  subject_security: (r) => subjectMatches(r, /security|penetration|pen ?test|hacking/i),
  hours_3: (r) => field(r, "weeklyHours", (v) => v === 3),
  hours_4: (r) => field(r, "weeklyHours", (v) => v === 4),
  keyboard_recorded: (r) => {
    if (!r.finalBrief) return [false, "No brief proposed"];
    const hit = JSON.stringify(r.finalBrief).match(/[^"]*keyboard[^"]*/i);
    return [!!hit, hit ? `Found: "${hit[0]}"` : "No mention of a keyboard in the brief"];
  },
  past_attempts_recorded: (r) => field(r, "pastAttempts", (v) => !!v && v.trim().length > 0),
  session_20: (r) => field(r, "sessionMinutes", (v) => v <= 20),
  copilot_policy: (r) => {
    if (!r.finalBrief) return [false, "No brief proposed"];
    const hit = JSON.stringify(r.finalBrief).match(/[^"]*copilot[^"]*/i);
    return [!!hit, hit ? `Found: "${hit[0]}"` : "No mention of Copilot in the brief"];
  },
  reissued_after_correction: (r) => [r.briefs.length >= 2, `Briefs proposed: ${r.briefs.length}`],
  tue_thu: (r) => field(r, "preferredTimes", (v) => !!v && /tue/i.test(v) && /thu/i.test(v)),
  deadline_set: (r) => field(r, "deadline", (v) => !!v),
  courses_in_starting_point: (r) =>
    field(r, "startingPoint", (v) => /course|principles|practice|elective/i.test(v ?? "")),
};

/** Fields of `brief` that contradict the persona's `truth`, or null if there's no brief. */
function truthErrors(brief, truth = {}) {
  if (!brief) return null;
  const wrong = [];
  for (const [field, t] of Object.entries(truth)) {
    const v = brief[field];
    const ok =
      "present" in t
        ? t.present === hasValue(v)
        : (t.eq === undefined || v === t.eq) &&
          (t.min === undefined || v >= t.min) &&
          (t.max === undefined || v <= t.max);
    if (!ok) wrong.push({ field, detail: `${field} = ${JSON.stringify(v)}, expected ${JSON.stringify(t)}` });
  }
  return wrong;
}

function subjectMatches(r, pattern) {
  return field(r, "subject", (v) => pattern.test(v ?? ""));
}

function field(r, name, ok) {
  if (!r.finalBrief) return [false, "No brief proposed"];
  const v = r.finalBrief[name];
  return [ok(v), `${name} = ${JSON.stringify(v)}`];
}

const JudgeSchema = z.object({
  results: z.array(
    z.object({
      index: z.number().describe("Index of the assertion in the list"),
      passed: z.boolean(),
      evidence: z.string().describe("A short quote or observation from the conversation"),
    }),
  ),
});

/**
 * Judge with one retry. A judge that returns nothing (e.g. a refusal on a
 * harmful-goal transcript) fails those assertions visibly instead of
 * crashing the whole grading run.
 */
async function judge(conversation, assertions) {
  if (assertions.length === 0) return [];
  let lastError;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      return await judgeOnce(conversation, assertions);
    } catch (err) {
      lastError = err;
    }
  }
  const reason = lastError instanceof Error ? lastError.name : String(lastError);
  return assertions.map((a) => ({ text: a.text, passed: false, evidence: `Judge failed: ${reason}` }));
}

async function judgeOnce(conversation, assertions) {
  const { output } = await generateText({
    model: anthropic(JUDGE_MODEL),
    instructions:
      "You grade conversations between a learning-tutor app and a (simulated) learner. For each assertion, decide strictly whether the conversation satisfies it, and cite brief evidence. Judge only what is in the conversation.",
    prompt: `Conversation:\n\n${conversation}\n\nAssertions:\n${assertions
      .map((a, i) => `${i}. ${a.text}`)
      .join("\n")}`,
    output: Output.object({ schema: JudgeSchema }),
  });
  return assertions.map((a, i) => {
    const res = output.results.find((x) => x.index === i);
    return { text: a.text, passed: !!res?.passed, evidence: res?.evidence ?? "Judge returned no result" };
  });
}

const jobs = [];
for (const ev of evals) {
  const evalDir = path.join(iterDir, `eval-${ev.name}`);
  if (!existsSync(evalDir)) continue;
  for (const config of readdirSync(evalDir).filter((d) => !d.includes("."))) {
    for (const run of readdirSync(path.join(evalDir, config)).filter((d) => d.startsWith("run-"))) {
      const runDir = path.join(evalDir, config, run);
      jobs.push(gradeRun(ev, runDir).then(() => console.log(`graded ${ev.name} ${config} ${run}`)));
    }
  }
}
await Promise.all(jobs);

async function gradeRun(ev, runDir) {
  const r = JSON.parse(readFileSync(path.join(runDir, "run_log.json"), "utf8"));
  const conversation = readFileSync(path.join(runDir, "outputs", "conversation.md"), "utf8")
    .split("\n")
    .slice(1) // drop the heading, which names the configuration
    .join("\n");

  const codeResults = ev.assertions
    .filter((a) => a.kind === "code")
    .map((a) => {
      const [passed, evidence] = CODE_CHECKS[a.id](r, ev);
      return { text: a.text, passed, evidence };
    });
  const judgeResults = await judge(conversation, ev.assertions.filter((a) => a.kind === "judge"));
  const expectations = [...codeResults, ...judgeResults];
  const passed = expectations.filter((e) => e.passed).length;

  writeFileSync(
    path.join(runDir, "grading.json"),
    JSON.stringify(
      {
        expectations,
        summary: {
          passed,
          failed: expectations.length - passed,
          total: expectations.length,
          pass_rate: Math.round((passed / expectations.length) * 100) / 100,
        },
        execution_metrics: {
          total_tool_calls: r.briefs.length + (r.invalidBriefs?.length ?? 0),
          total_steps: r.tutorTurns,
          errors_encountered: r.invalidBriefs?.length ?? 0,
          output_chars: conversation.length,
        },
      },
      null,
      2,
    ),
  );
}

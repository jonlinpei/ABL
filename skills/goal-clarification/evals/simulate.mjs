// Simulated-learner eval runner for the goal-clarification skill.
//
// For each eval in evals.json, a learner model plays the persona and talks to
// the tutor model. The tutor runs either with the skill (SKILL.md body as its
// instructions) or without it (a generic baseline prompt), with the same
// propose_goal_brief tool the app uses.
//
// Run from the repo root (needs ANTHROPIC_API_KEY):
//   node --env-file=.env.local skills/goal-clarification/evals/simulate.mjs \
//     --iteration 1 [--runs 2] [--only vague-data-goal]
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { createAnthropic } from "@ai-sdk/anthropic";
import { generateText, hasToolCall, tool } from "ai";

import { GoalBriefSchema } from "../../../src/lib/goals/schema.ts";

const SKILL_DIR = path.resolve(import.meta.dirname, "..");
const WORKSPACE = path.resolve(SKILL_DIR, "..", "goal-clarification-workspace");

// The router sends goal_discover to the standard tier; match it.
const TUTOR_MODEL = "claude-sonnet-5";
const LEARNER_MODEL = "claude-sonnet-5";
const MAX_TUTOR_TURNS = 8;

const BASELINE_PROMPT = `You are ABL, a personal learning tutor for adults. Help the learner clarify their learning goal. When you understand it well enough, call the propose_goal_brief tool with the brief.`;

const args = parseArgs(process.argv.slice(2));
const iteration = Number(args.iteration ?? 1);
const runs = Number(args.runs ?? 2);
const skillPath = path.resolve(args.skill ?? path.join(SKILL_DIR, "SKILL.md"));

const anthropic = createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const evals = JSON.parse(readFileSync(path.join(SKILL_DIR, "evals", "evals.json"), "utf8")).evals;
const skillBody = readFileSync(skillPath, "utf8").replace(/^---\n[\s\S]*?\n---\n/, "").trim();
const today = new Date().toISOString().slice(0, 10);

const CONFIGS = {
  with_skill: `${skillBody}\n\nToday is ${today}.`,
  without_skill: `${BASELINE_PROMPT}\n\nToday is ${today}.`,
};

const tools = {
  propose_goal_brief: tool({
    description:
      "Show the learner their goal brief as a card to confirm or correct. Call when discovery has enough information, and again after any correction.",
    inputSchema: GoalBriefSchema,
    // Strict mode guarantees schema-valid input, so the card always renders.
    strict: true,
    execute: async () => ({ status: "shown_to_learner" }),
  }),
};

const jobs = [];
for (const ev of evals) {
  if (args.only && ev.name !== args.only) continue;
  const evalDir = path.join(WORKSPACE, `iteration-${iteration}`, `eval-${ev.name}`);
  mkdirSync(evalDir, { recursive: true });
  writeFileSync(
    path.join(evalDir, "eval_metadata.json"),
    JSON.stringify(
      { eval_id: ev.id, eval_name: ev.name, prompt: ev.prompt, assertions: ev.assertions.map((a) => a.text) },
      null,
      2,
    ),
  );
  for (const [config, instructions] of Object.entries(CONFIGS)) {
    for (let run = 1; run <= runs; run++) {
      const runDir = path.join(evalDir, config, `run-${run}`);
      jobs.push(
        runConversation(ev, instructions)
          .then((result) => save(runDir, ev, config, result))
          .then(() => console.log(`done  ${ev.name} ${config} run-${run}`))
          .catch((err) => console.error(`FAIL  ${ev.name} ${config} run-${run}: ${err.message}`)),
      );
    }
  }
}
await Promise.all(jobs);

async function runConversation(ev, instructions) {
  const startedAt = Date.now();
  const tutorMessages = []; // tutor's view: learner = user
  const learnerMessages = []; // learner's view: tutor = user
  const log = [];
  const briefs = [];
  const invalidBriefs = [];
  let tutorTokens = 0;
  let learnerTokens = 0;
  let correctionSent = false;
  let briefTurn = null;

  const say = (text) => {
    log.push({ role: "learner", text });
    tutorMessages.push({ role: "user", content: text });
    learnerMessages.push({ role: "assistant", content: text });
  };
  say(ev.opening);

  for (let turn = 1; turn <= MAX_TUTOR_TURNS; turn++) {
    const r = await generateText({
      model: anthropic(TUTOR_MODEL),
      instructions,
      messages: tutorMessages,
      tools,
      stopWhen: hasToolCall("propose_goal_brief"),
    });
    tutorTokens += (r.totalUsage?.inputTokens ?? 0) + (r.totalUsage?.outputTokens ?? 0);
    tutorMessages.push(...r.response.messages);

    const text = r.steps.map((s) => s.text).join("\n").trim();
    const calls = r.steps.flatMap((s) => s.toolCalls).filter((c) => c.toolName === "propose_goal_brief");
    const rawBrief = calls.at(-1)?.input ?? null;
    const parsed = rawBrief ? GoalBriefSchema.safeParse(rawBrief) : null;
    const brief = parsed?.success ? parsed.data : null;
    const invalidBrief = parsed && !parsed.success ? { input: rawBrief, issues: parsed.error.issues } : null;
    if (invalidBrief) invalidBriefs.push(invalidBrief);
    log.push({ role: "tutor", turn, text, brief, invalidBrief });

    if (brief) {
      briefs.push(brief);
      briefTurn ??= turn;
      learnerMessages.push({
        role: "user",
        content: `${text}\n\n[The app shows you this goal brief card]\n${renderBrief(brief)}\n[Button: "Looks right. Build my plan". Or type what to change.]`,
      });
      if (ev.correction && !correctionSent) {
        correctionSent = true;
        say(ev.correction);
        continue;
      }
      const reply = await learnerReply(ev, learnerMessages);
      learnerTokens += reply.tokens;
      if (/^\s*looks right/i.test(reply.text)) {
        log.push({ role: "learner", text: '[clicks "Looks right. Build my plan"]' });
        break;
      }
      say(reply.text);
      continue;
    }

    learnerMessages.push({ role: "user", content: text });
    const reply = await learnerReply(ev, learnerMessages);
    learnerTokens += reply.tokens;
    if (reply.text.includes("[END]")) {
      log.push({ role: "learner", text: reply.text.replace("[END]", "").trim() || "[leaves]" });
      break;
    }
    say(reply.text);
  }

  return {
    log,
    briefs,
    finalBrief: briefs.at(-1) ?? null,
    invalidBriefs,
    briefTurn,
    tutorTurns: log.filter((l) => l.role === "tutor").length,
    tutorTokens,
    learnerTokens,
    durationMs: Date.now() - startedAt,
  };
}

async function learnerReply(ev, messages) {
  const r = await generateText({
    model: anthropic(LEARNER_MODEL),
    instructions: learnerInstructions(ev),
    messages,
  });
  return {
    text: r.text.trim(),
    tokens: (r.totalUsage?.inputTokens ?? 0) + (r.totalUsage?.outputTokens ?? 0),
  };
}

function learnerInstructions(ev) {
  return `You are role-playing a learner who is trying out a learning-tutor app. Stay in character.

Persona:
${ev.persona}

How to reply:
- Write like a busy adult texting: 1-3 short, casual sentences.
- Answer what the tutor asks. Don't volunteer your whole background at once; reveal details when they're relevant or asked for.
- Never mention role-playing, tests or AI models.
- When the app shows you a goal brief card, check it against your persona. If it's accurate, reply with exactly "Looks right." Otherwise say briefly what to change.
- If the conversation is clearly over (for example the tutor says it can't help with your goal), reply with a short goodbye followed by [END].`;
}

function renderBrief(b) {
  return [
    `Goal brief (${b.domain})`,
    `Goal: ${b.restatedGoal}`,
    `In your words: "${b.goalInTheirWords}"`,
    `Why: ${b.motivation}`,
    `Success looks like: ${b.successLooksLike}`,
    `Deadline: ${b.deadline ?? "None set"}`,
    `Starting point: ${b.startingPoint}`,
    `Time: ${b.weeklyHours} h/week, ${b.sessionMinutes}-min sessions${b.preferredTimes ? `, ${b.preferredTimes}` : ""}`,
    `Tried before: ${b.pastAttempts ?? "First time"}`,
    `Priority: ${b.priority}`,
    `Interests & context: ${b.interests.length ? b.interests.join(", ") : "None yet"}`,
  ].join("\n");
}

function renderConversation(ev, config, result) {
  const lines = [
    `# ${ev.name} (${config})`,
    ``,
    `Tutor: ${TUTOR_MODEL} · Learner (simulated): ${LEARNER_MODEL} · ${result.tutorTurns} tutor turns · ${(result.durationMs / 1000).toFixed(0)}s`,
    ``,
  ];
  for (const entry of result.log) {
    if (entry.role === "learner") {
      lines.push(`**Learner:** ${entry.text}`, ``);
    } else {
      lines.push(`**Tutor (turn ${entry.turn}):** ${entry.text || "_(no text)_"}`, ``);
      if (entry.invalidBrief) {
        lines.push("> **[Invalid goal brief: the app could not show this card]**  ");
        lines.push(`> ${entry.invalidBrief.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}  `, ``);
      }
      if (entry.brief) {
        lines.push("> **[Goal brief card]**  ");
        for (const l of renderBrief(entry.brief).split("\n")) lines.push(`> ${l}  `);
        lines.push(``);
      }
    }
  }
  if (!result.briefs.length) lines.push(`_No goal brief was proposed._`);
  return lines.join("\n");
}

function save(runDir, ev, config, result) {
  mkdirSync(path.join(runDir, "outputs"), { recursive: true });
  writeFileSync(path.join(runDir, "outputs", "conversation.md"), renderConversation(ev, config, result));
  writeFileSync(path.join(runDir, "outputs", "brief.json"), JSON.stringify(result.finalBrief, null, 2));
  writeFileSync(path.join(runDir, "run_log.json"), JSON.stringify(result, null, 2));
  writeFileSync(
    path.join(runDir, "timing.json"),
    JSON.stringify(
      {
        total_tokens: result.tutorTokens,
        learner_tokens: result.learnerTokens,
        duration_ms: result.durationMs,
        total_duration_seconds: Math.round(result.durationMs / 100) / 10,
      },
      null,
      2,
    ),
  );
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) out[argv[i].slice(2)] = argv[i + 1]?.startsWith("--") ? true : argv[++i];
  }
  return out;
}

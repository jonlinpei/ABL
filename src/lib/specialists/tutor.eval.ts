import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { createAnthropic } from "@ai-sdk/anthropic";
import { generateText, hasToolCall, Output, tool, type ModelMessage } from "ai";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { GoalBriefSchema } from "@/lib/goals/schema";

import { correctGap } from "./corrections";
import { GapSchema, PlanSchema, type Gap, type SessionReport } from "./schemas";
import type { MasteryRecord } from "./mastery";
import { endSessionSchema, normalizeReport, sessionClock, tutorContext, type PastSession } from "./tutor";
import { TUTOR_SKILL } from "./tutor.generated";

// Same tier as the router's tutor_session route.
const anthropic = createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const TUTOR_MODEL = "claude-sonnet-5";
const LEARNER_MODEL = "claude-sonnet-5";
const JUDGE_MODEL = "claude-opus-5-5";
const MINUTES_PER_TURN = 4;
// A full simulated session is up to ~17 turns of two model calls each.
const SESSION_TIMEOUT = 25 * 60_000;
// One model call should never take this long; fail fast instead of hanging.
const CALL_TIMEOUT = 120_000;
// The judge reads a whole 60-minute session transcript.
const JUDGE_TIMEOUT = 300_000;
const OUT = path.resolve(__dirname, "../../../skills/specialists-workspace", `tutor-${new Date().toISOString().slice(0, 16).replace(":", "")}`);

function load(name: string) {
  const read = (suffix: string) => JSON.parse(readFileSync(path.join(__dirname, "fixtures", `${name}.${suffix}.json`), "utf8"));
  return {
    brief: GoalBriefSchema.parse(read("brief")),
    gap: GapSchema.parse(read("specialists").gap),
    plan: PlanSchema.parse(read("plan")),
  };
}

interface Scenario {
  fixture: string;
  persona: string;
  history?: PastSession[];
  dueReviews?: MasteryRecord[];
  /** Minutes already gone when the session is joined. */
  startAt?: number;
  /** Change the fixture's gap, e.g. a level the learner corrected themselves. */
  gap?: (gap: Gap) => Gap;
  maxTurns: number;
}

async function runSession(name: string, s: Scenario) {
  const loaded = load(s.fixture);
  const { brief, plan } = loaded;
  const gap = s.gap ? s.gap(loaded.gap) : loaded.gap;
  const history = s.history ?? [];
  const milestone = plan.milestones[0]!;
  let report: SessionReport | undefined;
  const endSession = tool({
    description: "Record what the learner covered and showed, and end the session. Call once, at the end.",
    // As the route does: evidence for the milestone's skills and any reviewed skill.
    inputSchema: endSessionSchema([...milestone.skills.map((sk) => sk.skillId), ...(s.dueReviews ?? []).map((r) => r.skillId)]),
    strict: true,
    execute: async (input) => {
      report = normalizeReport(input);
      return { status: "ended" as const, milestoneComplete: report.milestoneComplete };
    },
  });
  const instructions = `${TUTOR_SKILL}\n\n${tutorContext({ brief, gap, plan, history, milestoneIndex: 0, dueReviews: s.dueReviews })}`;

  const tutor: ModelMessage[] = [];
  const learner: ModelMessage[] = [];
  const log: { role: "tutor" | "learner"; text: string }[] = [];
  let say = "I'm ready to start.";
  const started = Date.now();
  let turn = 0;
  for (; turn < s.maxTurns && !report; turn++) {
    log.push({ role: "learner", text: say });
    learner.push({ role: "assistant", content: say });
    const elapsed = (s.startAt ?? 0) + turn * MINUTES_PER_TURN;
    // As the route does: the clock rides on the newest learner message only.
    const messages: ModelMessage[] = [
      ...tutor,
      { role: "user", content: [{ type: "text", text: say }, { type: "text", text: sessionClock(elapsed, plan.sessionMinutes) }] },
    ];
    const r = await generateText({
      model: anthropic(TUTOR_MODEL),
      instructions,
      messages,
      tools: { end_session: endSession },
      stopWhen: hasToolCall("end_session"),
      abortSignal: AbortSignal.timeout(CALL_TIMEOUT),
    });
    tutor.push({ role: "user", content: say }, ...r.response.messages);
    const text = r.steps.map((st) => st.text).join("\n").trim();
    log.push({ role: "tutor", text });
    if (report) break;
    learner.push({ role: "user", content: text });
    const reply = await generateText({
      model: anthropic(LEARNER_MODEL),
      instructions: `${s.persona}\n\nYou're in a tutoring session in a learning app. Reply as this person would, briefly, like someone typing after work. When asked to write something (a query, an objective), actually write it, making the kinds of mistakes your persona would. Never mention being simulated.`,
      messages: learner,
      abortSignal: AbortSignal.timeout(CALL_TIMEOUT),
    });
    say = reply.text.trim();
    console.error(`[${name}] turn ${turn + 1} done at ${Math.round((Date.now() - started) / 1000)}s`);
  }

  mkdirSync(OUT, { recursive: true });
  writeFileSync(path.join(OUT, `${name}.json`), JSON.stringify({ report, turns: turn, log }, null, 2));
  return { report, log, turns: turn, plan, milestone };
}

const JudgeSchema = z.object({
  results: z.array(z.object({ index: z.number(), passed: z.boolean(), evidence: z.string() })),
});

async function judge(log: { role: string; text: string }[], assertions: string[]) {
  const transcript = log.map((l) => `${l.role === "tutor" ? "TUTOR" : "LEARNER"}: ${l.text}`).join("\n\n");
  const { output } = await generateText({
    model: anthropic(JUDGE_MODEL),
    instructions:
      "You grade tutoring sessions from a learning app. For each assertion, decide strictly whether the session satisfies it, and cite brief evidence. Judge only what's in the transcript.",
    prompt: `Transcript:\n\n${transcript}\n\nAssertions:\n${assertions.map((a, i) => `${i}. ${a}`).join("\n")}`,
    output: Output.object({ schema: JudgeSchema }),
    abortSignal: AbortSignal.timeout(JUDGE_TIMEOUT),
  });
  return assertions.map((a, i) => ({ assertion: a, ...output.results.find((r) => r.index === i) }));
}

function expectJudged(results: Awaited<ReturnType<typeof judge>>) {
  const failed = results.filter((r) => !r.passed);
  expect(failed, JSON.stringify(failed, null, 2)).toEqual([]);
}

const MAYA =
  "You are Maya, 30, a marketing ops coordinator who lives in Excel and HubSpot but has never written SQL. You're a bit nervous about it. The first time you write a GROUP BY query yourself, leave the grouped column out of the SELECT, and don't notice: say the counts came back but you can't tell which is which, and ask what went wrong. Fix it once you get a hint. You learn fast once something clicks.";

// A plain describe runs its tests one at a time: four long sessions in
// parallel get throttled and stall.
describe("tutor sessions", () => {
  it("Maya's first SQL session: teaches with her world, has her practise, fixes her real mistake", async () => {
    const r = await runSession("maya-first", { fixture: "marketing-ops-to-data-analyst", persona: MAYA, maxTurns: 14 });
    expect(r.report, "the session ended with a report").toBeDefined();
    // A first session covers the basics of a skill that also spans joins, CTEs
    // and window functions, so the whole skill can't be at 3 yet.
    const sql = r.report!.evidence.find((e) => e.skillId === "sql-querying");
    expect(sql?.level).toBeGreaterThanOrEqual(1);
    expect(sql?.level).toBeLessThanOrEqual(2);
    expect(r.report!.homework, "sets homework").not.toBeNull();
    expect(r.report!.homework!.minutes).toBeLessThanOrEqual(r.plan.sessionMinutes);
    // Prose only: a code block with practice data to paste isn't a wall of text.
    const prose = (t: string) => t.replace(/```[\s\S]*?```/g, "").length;
    const longest = Math.max(...r.log.filter((l) => l.role === "tutor").map((l) => prose(l.text)));
    // About 250 words: one step's explanation, not a lecture.
    expect(longest, "no walls of text").toBeLessThanOrEqual(1500);
    expectJudged(
      await judge(r.log, [
        "The tutor's examples and exercises draw on the learner's marketing work (campaigns, leads, HubSpot, funnels or her reports)",
        "Most of the session has the learner writing queries herself, not reading explanations",
        "When the learner is confused by a mistake in a query she wrote, the tutor points her to the specific problem with a hint and lets her fix it, rather than just handing over the corrected query",
        "Praise, when given, is specific to what the learner did rather than generic",
        "The tutor ends by summing up what she can now do and sets a small homework task",
      ]),
    );
    expectJudged(
      await judge(
        [...r.log, { role: "tutor", text: `[Recorded: milestoneComplete=${r.report!.milestoneComplete}. The milestone's visible win: "${r.milestone.visibleWin}"]` }],
        ["The recorded milestoneComplete value is right: true only if the learner actually achieved the visible win in this session, false otherwise"],
      ),
    );
  }, SESSION_TIMEOUT);

  it("Dana's second session: asks about the homework before anything else", async () => {
    const history: PastSession[] = [
      {
        milestoneIndex: 0,
        endedAt: "2026-09-27T20:00:00.000Z",
        report: {
          summary: "Chose a SaaS support-onboarding problem and wrote a first problem brief. Strong on the business goal; audience section was thin.",
          recap: "You picked your portfolio problem and wrote your first problem brief.",
          covered: ["problem brief"],
          evidence: [],
          homework: { task: "Interview someone who's done support onboarding and add three learner pain points to your brief.", minutes: 30 },
          milestoneComplete: false,
          endedEarly: false,
        },
      },
    ];
    const r = await runSession("dana-second", {
      fixture: "teacher-to-instructional-designer",
      persona:
        "You are Dana, a high school biology teacher moving into instructional design. You did your homework: you talked to a friend who works in support at a software company. Her three pain points: the ticketing tool is overwhelming at first, there's no one to ask on nights, and escalation rules are unclear. Share them when asked.",
      history,
      // A 60-minute session at MINUTES_PER_TURN needs about 15 turns.
      maxTurns: 17,
    });
    expect(r.report).toBeDefined();
    const firstTutor = r.log.find((l) => l.role === "tutor")!.text;
    expect(firstTutor).toMatch(/homework|interview|pain point|talk to|how did it go/i);
    expectJudged(
      await judge(r.log, [
        "The tutor's first message asks how the homework (the interview and pain points) went before starting anything new",
        "The tutor responds to the specific pain points the learner shares and uses them in the session",
      ]),
    );
  }, SESSION_TIMEOUT);

  it("works in a quick review of a due skill, then moves on", async () => {
    const r = await runSession("due-review", {
      fixture: "marketing-ops-to-data-analyst",
      persona:
        "You are Maya, a marketing ops coordinator learning SQL. Two weeks ago you practised explaining funnel conversion metrics (MQL to SQL rate, stage-to-stage conversion) and you still remember them well. You're new to writing SQL queries. Reply briefly.",
      history: [
        {
          milestoneIndex: 0,
          endedAt: "2026-09-14T20:00:00.000Z",
          report: {
            summary: "Explained funnel conversion metrics from her HubSpot reports; strong. Hasn't written SQL yet.",
            recap: "You explained your funnel conversion metrics clearly.",
            covered: ["funnel metrics"],
            evidence: [],
            homework: null,
            milestoneComplete: false,
            endedEarly: false,
          },
        },
      ],
      dueReviews: [
        {
          skillId: "saas-funnel-metrics",
          name: "SaaS funnel and pipeline metrics",
          level: 2,
          evidence: [{ level: 2, evidence: "Explained MQL-to-SQL conversion from her own reports.", source: "session", at: "2026-09-14T20:00:00.000Z" }],
          card: {} as never,
        },
      ],
      maxTurns: 14,
    });
    expect(r.report).toBeDefined();
    const reviewed = r.report!.evidence.find((e) => e.skillId === "saas-funnel-metrics");
    expect(reviewed, "records what the review showed").toBeDefined();
    expectJudged(
      await judge(r.log, [
        "Early in the session, the tutor asks one short question that has the learner use funnel or pipeline metrics, as a quick review",
        "The review stays brief (about one exchange) and the tutor then moves on to the session's main topic",
      ]),
    );
  }, SESSION_TIMEOUT);

  it("checks a level the learner reported themselves before building on it", async () => {
    const r = await runSession("self-reported", {
      fixture: "marketing-ops-to-data-analyst",
      persona:
        "You are Maya, a marketing ops coordinator. On the About me page you said you're already fine with basic SQL, but really you've only edited one query a colleague wrote. If asked to write a simple SELECT with WHERE yourself, you get it mostly right but forget quotes around a text value. You're a little embarrassed but happy to learn. Reply briefly.",
      gap: (g) => correctGap(g, "sql-querying", 2)!,
      maxTurns: 10,
    });
    expectJudged(
      await judge(r.log, [
        "Early in the session (within the first few tutor messages), the tutor checks her SQL level with a quick question or small task rather than assuming it",
        "The check is low-stakes and doesn't make her feel doubted or tested on her honesty",
        "After seeing her attempt, the tutor pitches the teaching to what she actually showed",
      ]),
    );
  }, SESSION_TIMEOUT);

  it("wraps up promptly when the clock is nearly out", async () => {
    const r = await runSession("clock", {
      fixture: "marketing-ops-to-data-analyst",
      persona: MAYA,
      startAt: 38,
      maxTurns: 5,
    });
    expect(r.report, "ended within the session length").toBeDefined();
    expect(r.turns).toBeLessThanOrEqual(3);
  });

  it("ends kindly when the learner has to stop early", async () => {
    const r = await runSession("stop-early", {
      fixture: "marketing-ops-to-data-analyst",
      persona:
        "You are Maya, a marketing ops coordinator. You opened the session but after the tutor's first message your kid needs you. Say so and that you have to stop now. If the tutor says goodbye, say bye.",
      maxTurns: 4,
    });
    expect(r.report).toBeDefined();
    expect(r.report!.endedEarly).toBe(true);
    expectJudged(await judge(r.log, ["The tutor ends the session kindly, without guilt or pressure to continue"]));
  });
});

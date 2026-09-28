import { describe, expect, it } from "vitest";

import type { MasteryRecord } from "./mastery";
import type { SessionReport } from "./schemas";
import { detectSignals, expectedSessionsPerWeek, type SessionFact } from "./signals";
import { samplePlan } from "./test-fixtures";

const DAY = 86_400_000;
const now = new Date("2026-11-01T12:00:00Z");
const daysAgo = (d: number) => new Date(now.getTime() - d * DAY);
const report = (over: Partial<SessionReport> = {}): SessionReport => ({
  summary: "s", recap: "r", covered: [], evidence: [], homework: null, milestoneComplete: false, endedEarly: false, ...over,
});
const session = (ago: number, milestoneIndex = 0): SessionFact => ({ milestoneIndex, endedAt: daysAgo(ago), report: report() });
// samplePlan: 3 h/week in 45-minute sessions, so 4 sessions a week.
const detect = (sessions: SessionFact[], extra: Partial<Parameters<typeof detectSignals>[0]> = {}) =>
  detectSignals({ plan: samplePlan, planStartedAt: daysAgo(30), sessions, mastery: [], milestoneIndex: 0, now, ...extra });

describe("expectedSessionsPerWeek", () => {
  it("is weekly hours over session length", () => {
    expect(expectedSessionsPerWeek(samplePlan)).toBe(4);
  });
});

describe("missed sessions", () => {
  const onPace = [28, 26, 24, 21, 19, 17, 14, 12, 10, 7, 5, 3, 1];

  it("stays quiet while the learner keeps up", () => {
    expect(detect(onPace.map((d) => session(d)))).toEqual([]);
  });

  it("flags a gap of 5+ days, and a lapse after two weeks", () => {
    const five = detect([...onPace.slice(0, 10).map((d) => session(d + 3)), session(6)]);
    expect(five.find((s) => s.kind === "missed_sessions")).toMatchObject({ daysSinceLast: 6, lapsed: false });
    const lapsed = detect([session(16)]);
    expect(lapsed.find((s) => s.kind === "missed_sessions")).toMatchObject({ lapsed: true });
  });

  it("counts from the plan's start when there are no sessions yet", () => {
    expect(detect([], { planStartedAt: daysAgo(2) })).toEqual([]);
    expect(detect([], { planStartedAt: daysAgo(8) })[0]).toMatchObject({ kind: "missed_sessions", daysSinceLast: 8 });
  });
});

describe("behind pace", () => {
  it("projects a later finish when recent pace is under 60% of the plan", () => {
    const sparse = [20, 13, 6, 2].map((d) => session(d)); // ~1.3 a week against 4
    const s = detect(sparse).find((x) => x.kind === "behind_pace");
    expect(s).toMatchObject({ kind: "behind_pace", expectedPerWeek: 4 });
    if (s?.kind !== "behind_pace") throw new Error("no signal");
    expect(s.projectedFinish).not.toBeNull();
    expect(s.projectedFinish! > s.plannedFinish).toBe(true);
  });

  it("leaves out the date when the pace is too low for a meaningful projection", () => {
    const s = detect([session(9)]).find((x) => x.kind === "behind_pace");
    expect(s).toMatchObject({ kind: "behind_pace", projectedFinish: null });
  });

  it("waits for two weeks of history before judging pace", () => {
    expect(detect([session(1)], { planStartedAt: daysAgo(10) }).some((s) => s.kind === "behind_pace")).toBe(false);
  });
});

describe("stuck topic", () => {
  const record = (levels: number[]): MasteryRecord => ({
    skillId: "sql-querying",
    name: "SQL querying",
    level: Math.max(...levels),
    evidence: levels.map((level, i) => ({ level, evidence: "", source: "session", at: daysAgo(10 - i).toISOString() })),
    card: {} as never,
  });
  const three = [session(5), session(3), session(1)];

  it("flags a milestone skill that hasn't risen over three sessions", () => {
    const s = detect(three, { mastery: [record([1, 1, 1])] });
    expect(s).toContainEqual(expect.objectContaining({ kind: "stuck_topic", skillId: "sql-querying", sessionsOnMilestone: 3, toLevel: 2 }));
  });

  it("stays quiet while the skill is rising, has reached its target, or it's early", () => {
    expect(detect(three, { mastery: [record([0, 1, 1])] }).some((s) => s.kind === "stuck_topic")).toBe(false);
    expect(detect(three, { mastery: [record([2, 2, 2])] }).some((s) => s.kind === "stuck_topic")).toBe(false);
    expect(detect(three.slice(1), { mastery: [record([1, 1, 1])] }).some((s) => s.kind === "stuck_topic")).toBe(false);
  });
});

describe("a finished plan", () => {
  it("raises nothing", () => {
    expect(detect([session(40)], { milestoneIndex: samplePlan.milestones.length })).toEqual([]);
  });
});

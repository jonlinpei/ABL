import { describe, expect, it } from "vitest";

import { sampleBrief } from "@/lib/goals/test-fixtures";

import { coachContext, enforce, mayCheckIn, type CoachDecision } from "./coach";
import { samplePlan } from "./test-fixtures";

const DAY = 86_400_000;
const now = new Date("2026-11-01T12:00:00Z");
const daysAgo = (d: number) => new Date(now.getTime() - d * DAY);

describe("mayCheckIn", () => {
  it("allows the first check-in", () => {
    expect(mayCheckIn(null, null, now)).toBe(true);
  });

  it("waits 3 days between check-ins when the learner has been active since", () => {
    expect(mayCheckIn(daysAgo(2), daysAgo(1), now)).toBe(false);
    expect(mayCheckIn(daysAgo(3), daysAgo(1), now)).toBe(true);
  });

  it("waits a week when the last check-in went unanswered by a session: no nagging into silence", () => {
    expect(mayCheckIn(daysAgo(5), daysAgo(10), now)).toBe(false);
    expect(mayCheckIn(daysAgo(7), daysAgo(10), now)).toBe(true);
  });
});

describe("enforce", () => {
  const decision: CoachDecision = {
    message: "Hi",
    options: ["a", "b", "c", "d"],
    tutorNote: "Try smaller steps.",
    suggestReplan: false,
    reason: "r",
  };

  it("drops the message and options when check-ins are paused, but keeps the tutor note", () => {
    expect(enforce(decision, false)).toMatchObject({ message: null, options: [], tutorNote: "Try smaller steps." });
  });

  it("gives the one-tap rework option when a replan is suggested, replacing the model's own wording", () => {
    const d = enforce({ ...decision, suggestReplan: true, options: ["Do a 20-minute session", "Rework my plan around less time", "Aim for two next week"] }, true);
    expect(d.options).toEqual(["Do a 20-minute session", "Aim for two next week", "Rework my plan"]);
  });

  it("caps options at three and drops options without a message", () => {
    expect(enforce(decision, true).options).toEqual(["a", "b", "c"]);
    expect(enforce({ ...decision, message: null }, true).options).toEqual([]);
  });
});

describe("coachContext", () => {
  const base = {
    brief: sampleBrief,
    plan: samplePlan,
    milestoneIndex: 1,
    signals: [{ kind: "missed_sessions" as const, daysSinceLast: 9, expectedPerWeek: 4, lapsed: false }],
    recentSessions: [
      {
        endedAt: daysAgo(9),
        report: { summary: "s", recap: "You rebuilt your pivot in SQL.", covered: [], evidence: [], homework: null, milestoneComplete: true, endedEarly: false },
      },
    ],
    notes: [{ createdAt: daysAgo(20), message: "Earlier check-in", response: "Do a 20-minute session this week" }],
    today: "2026-11-01",
  };

  it("gives the learner's history, the signals and what they chose before", () => {
    const ctx = coachContext({ ...base, allowCheckIn: true });
    expect(ctx).toContain(`Tried before: ${sampleBrief.pastAttempts}`);
    expect(ctx).toContain("Milestone 2 of 3");
    expect(ctx).toContain("You rebuilt your pivot in SQL.");
    expect(ctx).toContain('They chose: "Do a 20-minute session this week"');
    expect(ctx).toContain('"kind":"missed_sessions"');
    expect(ctx).not.toContain("Don't send a check-in");
  });

  it("tells the coach when check-ins are paused", () => {
    expect(coachContext({ ...base, allowCheckIn: false })).toContain("Don't send a check-in right now");
  });
});

import { Rating } from "ts-fsrs";
import { describe, expect, it } from "vitest";

import { computeGap } from "./gap";
import {
  applyEvidence,
  applyMasteryToGap,
  dueForReview,
  MAX_EVIDENCE,
  nextLevel,
  reviewRating,
  spreadMastery,
  type EvidenceEntry,
} from "./mastery";
import { sampleProfile, sampleRequirements } from "./test-fixtures";

const day = 86_400_000;
const t0 = new Date("2026-10-01T20:00:00Z");
const entry = (level: number, at = t0): EvidenceEntry => ({ level, evidence: `shown ${level}`, source: "session", at: at.toISOString() });
const apply = (record: Parameters<typeof applyEvidence>[0]["record"], level: number, now = t0, startingLevel = 0) =>
  applyEvidence({ record, skillId: "sql-querying", name: "SQL querying", startingLevel, entry: entry(level, now), now });

describe("nextLevel", () => {
  it("rises to what was shown", () => {
    expect(nextLevel(1, 3)).toBe(3);
  });

  it("holds through one slightly weaker session", () => {
    expect(nextLevel(3, 2)).toBe(3);
  });

  it("drops one step only on a clear drop", () => {
    expect(nextLevel(3, 1)).toBe(2);
    expect(nextLevel(4, 0)).toBe(3);
  });
});

describe("reviewRating", () => {
  it("rates newly practised material Good so it comes back soon, unless nothing was shown", () => {
    expect(reviewRating(true, 0, 2)).toBe(Rating.Good);
    expect(reviewRating(true, 0, 0)).toBe(Rating.Again);
  });

  it("brings a skill back sooner when the learner does worse than before", () => {
    expect(reviewRating(false, 3, 3)).toBe(Rating.Good);
    expect(reviewRating(false, 3, 2)).toBe(Rating.Hard);
    expect(reviewRating(false, 3, 1)).toBe(Rating.Again);
  });
});

describe("applyEvidence", () => {
  it("starts from the gap's level and schedules a first review soon", () => {
    const r = apply(undefined, 2, t0, 1);
    expect(r.level).toBe(2);
    expect(r.evidence).toHaveLength(1);
    // In days, not minutes: the next review lands in a later session.
    const dueInDays = (new Date(r.card.due).getTime() - t0.getTime()) / day;
    expect(dueInDays).toBeGreaterThanOrEqual(1);
    expect(dueInDays).toBeLessThanOrEqual(5);
  });

  it("spaces reviews further apart as the learner keeps showing the skill", () => {
    const first = apply(undefined, 2);
    const second = apply(first, 2, new Date(first.card.due));
    const gap1 = new Date(first.card.due).getTime() - t0.getTime();
    const gap2 = new Date(second.card.due).getTime() - new Date(first.card.due).getTime();
    expect(gap2).toBeGreaterThan(gap1);
  });

  it("brings a skill back sooner after a clear lapse than after a good review", () => {
    const first = apply(undefined, 3);
    const at = new Date(first.card.due);
    const good = apply(first, 3, at);
    const lapse = apply(first, 1, at);
    expect(new Date(lapse.card.due).getTime()).toBeLessThan(new Date(good.card.due).getTime());
    expect(lapse.level).toBe(2);
  });

  it("keeps only the most recent evidence", () => {
    let r = apply(undefined, 1);
    for (let i = 0; i < MAX_EVIDENCE + 3; i++) r = apply(r, 1, new Date(t0.getTime() + (i + 1) * day));
    expect(r.evidence).toHaveLength(MAX_EVIDENCE);
  });
});

describe("dueForReview", () => {
  it("returns records due by now, soonest first", () => {
    const a = apply(undefined, 2);
    const b = { ...apply(undefined, 2), skillId: "b", card: { ...a.card, due: new Date(t0.getTime() + 10 * day).toISOString() } };
    const c = { ...apply(undefined, 2), skillId: "c", card: { ...a.card, due: new Date(t0.getTime() - day).toISOString() } };
    expect(dueForReview([a, b, c], new Date(t0.getTime() + 5 * day)).map((r) => r.skillId)).toEqual(["c", "sql-querying"]);
  });
});

describe("applyMasteryToGap", () => {
  it("replaces practised skills' levels, marks them practiced and re-scores the gap", () => {
    const gap = computeGap(sampleRequirements, sampleProfile);
    const updated = applyMasteryToGap(gap, [apply(undefined, 3)]);
    const sql = updated.items.find((i) => i.skillId === "sql-querying")!;
    expect(sql).toMatchObject({ current: 3, basis: "practiced", status: "met", verify: false });
    expect(updated.counts.met).toBe(gap.counts.met + 1);
  });
});

describe("spreadMastery", () => {
  const gap = computeGap(sampleRequirements, sampleProfile);
  const withoutSql = computeGap(
    { ...sampleRequirements, skills: sampleRequirements.skills.filter((s) => s.id !== "sql-querying") },
    sampleProfile,
  );

  it("carries mastery into every gap with the skill, marking matching items practiced", () => {
    const other = computeGap(sampleRequirements, { ...sampleProfile, skills: [] });
    const spread = spreadMastery(
      [
        { id: "g1", briefId: "b1", gap },
        { id: "g2", briefId: "b2", gap: other },
      ],
      [apply(undefined, 3)],
    );
    expect(spread.map((g) => g.id)).toEqual(["g1", "g2"]);
    for (const g of spread) {
      expect(g.gap.items.find((i) => i.skillId === "sql-querying")).toMatchObject({ current: 3, basis: "practiced", status: "met" });
    }
    // Other fields ride along, and the other items are left alone.
    expect(spread[0]!.briefId).toBe("b1");
    expect(spread[0]!.gap.items.find((i) => i.skillId === "dashboards")).toEqual(gap.items.find((i) => i.skillId === "dashboards"));
  });

  it("leaves out gaps without any of the skills", () => {
    const spread = spreadMastery(
      [
        { id: "g1", gap },
        { id: "g2", gap: withoutSql },
      ],
      [apply(undefined, 3)],
    );
    expect(spread.map((g) => g.id)).toEqual(["g1"]);
  });

  it("returns nothing with no records or no gaps", () => {
    expect(spreadMastery([{ id: "g1", gap }], [])).toEqual([]);
    expect(spreadMastery([], [apply(undefined, 3)])).toEqual([]);
  });
});

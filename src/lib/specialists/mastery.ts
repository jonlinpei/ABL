import { createEmptyCard, fsrs, Rating, State, type Card, type Grade } from "ts-fsrs";

import { finishGap, scoreItem } from "./gap";
import type { Gap } from "./schemas";

/** One piece of evidence about a skill, from a session, a check or the learner's own correction. */
export interface EvidenceEntry {
  level: number;
  evidence: string;
  source: "session" | "assessment" | "learner";
  at: string;
}

/** A learner's mastery of one skill, with its spaced-review card. */
export interface MasteryRecord {
  skillId: string;
  name: string;
  level: number;
  /** The most recent evidence, newest last, capped at MAX_EVIDENCE. */
  evidence: EvidenceEntry[];
  /** FSRS card. Dates are ISO strings so it can be stored as JSON. */
  card: StoredCard;
}

export type StoredCard = Omit<Card, "due" | "last_review"> & { due: string; last_review?: string };

export const MAX_EVIDENCE = 10;

// Reviews happen in sessions, days apart, so no minute-level learning steps:
// the first review of newly practised material is a day or more out.
const scheduler = fsrs({ enable_short_term: false });

/**
 * The new level after a piece of evidence. Showing more raises the level to
 * what was shown. One weaker session doesn't undo earlier evidence; only a
 * clear drop (two or more levels below) lowers it, and then by one step.
 */
export function nextLevel(current: number, shown: number): number {
  if (shown > current) return shown;
  if (current - shown >= 2) return current - 1;
  return current;
}

/**
 * How the evidence rates as a review. Newly practised material rates Good
 * so it comes back soon; after that, doing worse than before brings it back
 * sooner (Hard or Again).
 */
export function reviewRating(isNew: boolean, current: number, shown: number): Grade {
  if (isNew) return shown === 0 ? Rating.Again : Rating.Good;
  if (current - shown >= 2) return Rating.Again;
  if (shown < current) return Rating.Hard;
  return Rating.Good;
}

/**
 * Apply one piece of evidence to a skill's mastery. Without a record yet,
 * the starting level is the gap's (profile or skills-check) level.
 */
export function applyEvidence({
  record,
  skillId,
  name,
  startingLevel,
  entry,
  now,
}: {
  record: MasteryRecord | undefined;
  skillId: string;
  name: string;
  startingLevel: number;
  entry: EvidenceEntry;
  now: Date;
}): MasteryRecord {
  const current = record?.level ?? startingLevel;
  const card = record ? toCard(record.card) : createEmptyCard(now);
  const isNew = card.state === State.New;
  const next = scheduler.next(card, now, reviewRating(isNew, current, entry.level)).card;
  return {
    skillId,
    name,
    level: nextLevel(current, entry.level),
    evidence: [...(record?.evidence ?? []), entry].slice(-MAX_EVIDENCE),
    card: fromCard(next),
  };
}

/** Skills whose review is due at `now`, soonest first. */
export function dueForReview(records: MasteryRecord[], now: Date): MasteryRecord[] {
  return records
    .filter((r) => new Date(r.card.due) <= now)
    .sort((a, b) => a.card.due.localeCompare(b.card.due));
}

/**
 * The gap with mastery levels in place of earlier estimates, for skills the
 * learner has practised, been checked on or corrected. Other skills are
 * unchanged.
 */
export function applyMasteryToGap(gap: Gap, records: MasteryRecord[]): Gap {
  const byId = new Map(records.map((r) => [r.skillId, r]));
  const items = gap.items.map((item) => {
    const r = byId.get(item.skillId);
    return r ? scoreItem({ ...item, current: r.level, basis: masteryBasis(r) }) : item;
  });
  return finishGap(items, gap.credentials, gap.proofOfSkill);
}

/**
 * Where a mastery level comes from, as the gap labels it: the learner's own
 * correction if that's the latest word, practice if any session showed it,
 * otherwise a skills check.
 */
export function masteryBasis(record: MasteryRecord): Gap["items"][number]["basis"] {
  const sources = record.evidence.map((e) => e.source);
  if (sources.at(-1) === "learner") return "self_reported";
  // Records from before evidence kept its source count as practice.
  return sources.length === 0 || sources.includes("session") ? "practiced" : "assessed";
}

/**
 * Carry mastery into every gap that has any of the skills, since a learner's
 * skills are shared across their goals. Gaps with none of them are left out,
 * so only changed gaps are saved.
 */
export function spreadMastery<T extends { gap: Gap }>(gaps: T[], records: MasteryRecord[]): T[] {
  const ids = new Set(records.map((r) => r.skillId));
  return gaps
    .filter((g) => g.gap.items.some((i) => ids.has(i.skillId)))
    .map((g) => ({ ...g, gap: applyMasteryToGap(g.gap, records) }));
}

function toCard(c: StoredCard): Card {
  return { ...c, due: new Date(c.due), last_review: c.last_review ? new Date(c.last_review) : undefined };
}

function fromCard(c: Card): StoredCard {
  return { ...c, due: c.due.toISOString(), last_review: c.last_review?.toISOString() };
}

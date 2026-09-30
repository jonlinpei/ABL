import type { Plan } from "@/lib/specialists/schemas";

export type CurrentMilestoneState = "done" | "kept" | "dropped";
export type ProposedMilestoneState = "kept" | "new";

/** A milestone in the side-by-side comparison. */
export interface ComparedMilestone<S> {
  title: string;
  weeks: number;
  state: S;
}

const key = (title: string) =>
  title
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/**
 * The current plan's milestones next to the proposed plan's: finished ones
 * marked done; remaining ones kept (the proposal has a milestone with the
 * same title) or dropped; the proposal's own milestones kept or new.
 */
export function compareMilestones(current: Plan, proposed: Plan, milestonesDone: number) {
  const proposedKeys = new Set(proposed.milestones.map((m) => key(m.title)));
  const remainingKeys = new Set(current.milestones.slice(milestonesDone).map((m) => key(m.title)));
  return {
    current: current.milestones.map(
      (m, i): ComparedMilestone<CurrentMilestoneState> => ({
        title: m.title,
        weeks: m.weeks,
        state: i < milestonesDone ? "done" : proposedKeys.has(key(m.title)) ? "kept" : "dropped",
      }),
    ),
    proposed: proposed.milestones.map(
      (m): ComparedMilestone<ProposedMilestoneState> => ({
        title: m.title,
        weeks: m.weeks,
        state: remainingKeys.has(key(m.title)) ? "kept" : "new",
      }),
    ),
    /** Weeks of work left on the current plan, and in the proposal. */
    weeksLeft: {
      current: current.milestones.slice(milestonesDone).reduce((n, m) => n + m.weeks, 0),
      proposed: proposed.milestones.reduce((n, m) => n + m.weeks, 0),
    },
  };
}

/**
 * The facts of a change from the current plan's remaining work to a new
 * plan, computed in code so the words describing it can't misstate it.
 */
export function changeFacts(current: Plan, milestonesDone: number, proposed: Plan): string {
  const c = compareMilestones(current, proposed, milestonesDone);
  const remaining = current.milestones.slice(milestonesDone);
  const hours = (weeks: number, perWeek: number) => Math.round(weeks * perWeek);
  const line = (m: { title: string; weeks: number; project: string | null }) => `${m.title} (${m.weeks} wk${m.project ? `; project: ${m.project}` : ""})`;
  const projects = (ms: Plan["milestones"]) => ms.flatMap((m) => (m.project ? [m.project] : []));
  const newLeftOut = proposed.notCovered.filter((n) => !current.notCovered.some((o) => o.skillId === n.skillId));
  return `- Week: ${current.weeklyHours} h in ${current.sessionMinutes}-min sessions -> ${proposed.weeklyHours} h in ${proposed.sessionMinutes}-min sessions.
- Work left: ${c.weeksLeft.current} weeks (about ${hours(c.weeksLeft.current, current.weeklyHours)} hours) -> ${c.weeksLeft.proposed} weeks (about ${hours(c.weeksLeft.proposed, proposed.weeklyHours)} hours).
- Remaining milestones before: ${remaining.map(line).join("; ") || "none"}.
- Milestones after: ${proposed.milestones.map(line).join("; ")}.
- Kept by name: ${c.proposed.filter((m) => m.state === "kept").map((m) => m.title).join("; ") || "none"}. New: ${c.proposed.filter((m) => m.state === "new").map((m) => m.title).join("; ") || "none"}. No longer in the plan: ${c.current.filter((m) => m.state === "dropped").map((m) => m.title).join("; ") || "none"}.
- Portfolio projects before: ${projects(remaining).length} (${projects(remaining).join("; ") || "none"}). After: ${projects(proposed.milestones).length} (${projects(proposed.milestones).join("; ") || "none"}).
- Newly left out of the plan: ${newLeftOut.map((n) => `${n.skillId} (${n.reason})`).join("; ") || "nothing"}.
- Deadline fit before: ${current.deadlineFit} After: ${proposed.deadlineFit}`;
}

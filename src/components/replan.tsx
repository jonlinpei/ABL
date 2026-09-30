"use client";

import { useState } from "react";

import type { ProposalKind } from "@/app/api/learner/status/route";
import { compareMilestones, type ComparedMilestone, type CurrentMilestoneState, type ProposedMilestoneState } from "@/lib/goals/plan-diff";
import type { Plan, Replan, ReplanRequest } from "@/lib/specialists/schemas";

import { WorkingLabel } from "./thinking-words";

/** "Life changed? Rework my plan": new hours, session length, deadline, and what changed. */
export function ReplanForm({
  goalId,
  plan,
  onStarted,
  onCancel,
  initialNote = "",
}: {
  goalId: string;
  plan: Pick<Plan, "weeklyHours" | "sessionMinutes">;
  onStarted: () => void;
  onCancel: () => void;
  initialNote?: string;
}) {
  const [hours, setHours] = useState(String(plan.weeklyHours));
  const [minutes, setMinutes] = useState(String(plan.sessionMinutes));
  const [deadline, setDeadline] = useState("");
  const [note, setNote] = useState(initialNote);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setSending(true);
    setError(null);
    const number = (v: string, current: number) => {
      const n = Number(v);
      return Number.isFinite(n) && n > 0 && n !== current ? n : null;
    };
    const request: ReplanRequest = {
      weeklyHours: number(hours, plan.weeklyHours),
      sessionMinutes: number(minutes, plan.sessionMinutes),
      deadline: deadline.trim() || null,
      note: note.trim() || null,
    };
    try {
      const res = await fetch("/api/replan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ request, goalId }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? `Request failed (${res.status})`);
      onStarted();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSending(false);
    }
  }

  return (
    <section className="rounded-xl border border-foreground/20 p-5">
      <h2 className="text-lg font-medium">Rework your plan</h2>
      <p className="mt-1 text-sm text-foreground/70">
        Tell me what&apos;s changed. Your coach, planner and reviewer will rework the rest of your plan around it,
        keeping what you&apos;ve already done. You&apos;ll see the changes before anything switches.
      </p>
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <label className="text-sm">
          <span className="text-foreground/60">Hours a week</span>
          <input value={hours} onChange={(e) => setHours(e.currentTarget.value)} inputMode="decimal" className="mt-1 w-full rounded-lg border border-foreground/15 bg-background px-2 py-1.5" />
        </label>
        <label className="text-sm">
          <span className="text-foreground/60">Minutes per session</span>
          <input value={minutes} onChange={(e) => setMinutes(e.currentTarget.value)} inputMode="numeric" className="mt-1 w-full rounded-lg border border-foreground/15 bg-background px-2 py-1.5" />
        </label>
        <label className="text-sm">
          <span className="text-foreground/60">New deadline (optional)</span>
          <input value={deadline} onChange={(e) => setDeadline(e.currentTarget.value)} placeholder="e.g. spring 2028" className="mt-1 w-full rounded-lg border border-foreground/15 bg-background px-2 py-1.5" />
        </label>
      </div>
      <label className="mt-3 block text-sm">
        <span className="text-foreground/60">What&apos;s changed? (optional)</span>
        <textarea
          value={note}
          onChange={(e) => setNote(e.currentTarget.value)}
          rows={2}
          placeholder="e.g. New job, evenings are unpredictable now"
          className="mt-1 w-full rounded-lg border border-foreground/15 bg-background px-2 py-1.5"
        />
      </label>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button onClick={submit} disabled={sending} className="rounded-lg bg-foreground px-4 py-2 text-sm text-background disabled:opacity-50">
          {sending ? <WorkingLabel label="Starting" onDark /> : "Rework my plan"}
        </button>
        <button onClick={onCancel} disabled={sending} className="text-sm text-foreground/60 underline">
          Cancel
        </button>
      </div>
      {error && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>}
    </section>
  );
}

/**
 * A proposed plan next to the current one, for the learner to compare and
 * choose: a one-line summary of what changes, the two plans side by side
 * (stacked on small screens), what changed and why, and the choice. Used for
 * a rework of the plan and for the plan of an updated goal.
 */
export function ProposalView({
  huddleId,
  kind,
  proposal,
  current,
  milestonesDone,
  onDecided,
}: {
  huddleId: string;
  kind: ProposalKind;
  proposal: Replan;
  current: Plan;
  milestonesDone: number;
  onDecided: () => void;
}) {
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const compared = compareMilestones(current, proposal, milestonesDone);
  // Proposals saved before summaries existed fall back to their first change.
  const summary = proposal.changeSummary || proposal.whatChanged[0]?.change || null;

  async function decide(accept: boolean) {
    setSending(true);
    setError(null);
    try {
      const res = await fetch("/api/replan/decide", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ huddleId, accept }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? `Request failed (${res.status})`);
      onDecided();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSending(false);
    }
  }

  return (
    <section className="rounded-xl border border-sky-500/40 bg-sky-500/5 p-5">
      <div className="text-xs uppercase tracking-wide text-foreground/50">
        {kind === "update" ? "The plan for your updated goal" : "Your reworked plan"}
      </div>
      {summary && <p className="mt-1 text-lg font-medium">{summary}</p>}
      <p className="mt-1 text-sm text-foreground/60">
        Compare it with your current plan. Nothing changes until you choose, and your progress and skills carry over either way.
      </p>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <PlanColumn
          label="Your current plan"
          plan={current}
          weeksLeft={compared.weeksLeft.current}
          milestones={compared.current}
        />
        <PlanColumn
          label={kind === "update" ? "Updated plan" : "Reworked plan"}
          plan={proposal}
          weeksLeft={compared.weeksLeft.proposed}
          milestones={compared.proposed}
          compareTo={current}
          highlight
        />
      </div>

      {proposal.whatChanged.length > 0 && (
        <div className="mt-4 text-sm">
          <div className="text-foreground/50">What changed, and why</div>
          <ul className="mt-1 flex flex-col gap-1.5">
            {proposal.whatChanged.map((c, i) => (
              <li key={i}>
                <span className="font-medium">{c.change}</span> <span className="text-foreground/70">{c.because}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button onClick={() => decide(true)} disabled={sending} className="rounded-lg bg-foreground px-4 py-2 text-sm text-background disabled:opacity-50">
          {kind === "update" ? "Switch to the updated plan" : "Use the new plan"}
        </button>
        <button onClick={() => decide(false)} disabled={sending} className="text-sm text-foreground/60 underline">
          Keep my current plan
        </button>
      </div>
      {error && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>}
    </section>
  );
}

const STATE_LABEL: Record<CurrentMilestoneState | ProposedMilestoneState, { text: string; className: string } | null> = {
  done: { text: "done", className: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" },
  kept: null,
  dropped: { text: "not in the new plan", className: "bg-foreground/10 text-foreground/60" },
  new: { text: "new", className: "bg-sky-500/15 text-sky-700 dark:text-sky-300" },
};

function PlanColumn({
  label,
  plan,
  weeksLeft,
  milestones,
  compareTo,
  highlight = false,
}: {
  label: string;
  plan: Plan;
  weeksLeft: number;
  milestones: ComparedMilestone<CurrentMilestoneState | ProposedMilestoneState>[];
  /** For the proposal: show what each number was on the current plan. */
  compareTo?: Plan;
  highlight?: boolean;
}) {
  const was = (now: number, before: number | undefined, unit: string) =>
    before !== undefined && before !== now ? <span className="text-foreground/40"> (was {before}{unit})</span> : null;
  return (
    <div className={`rounded-lg border bg-background p-4 ${highlight ? "border-sky-500/40" : "border-foreground/15"}`}>
      <div className="text-xs uppercase tracking-wide text-foreground/50">{label}</div>
      <div className="mt-1 font-medium">{plan.title}</div>
      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-sm text-foreground/70">
        <dt className="text-foreground/50">Week</dt>
        <dd>
          {plan.weeklyHours} h{was(plan.weeklyHours, compareTo?.weeklyHours, " h")} · {plan.sessionMinutes}-min sessions
          {was(plan.sessionMinutes, compareTo?.sessionMinutes, " min")}
        </dd>
        <dt className="text-foreground/50">Time left</dt>
        <dd>About {weeksLeft} weeks</dd>
      </dl>
      <p className="mt-2 text-sm text-foreground/70">{plan.deadlineFit}</p>
      <ol className="mt-3 flex flex-col gap-1.5 text-sm">
        {milestones.map((m, i) => (
          <li key={i} className={`flex flex-wrap items-baseline gap-x-2 ${m.state === "done" || m.state === "dropped" ? "text-foreground/50" : ""}`}>
            <span className="text-foreground/40">{i + 1}.</span>
            <span className={m.state === "dropped" ? "line-through" : ""}>{m.title}</span>
            <span className="text-xs text-foreground/40">{m.weeks} wk</span>
            {STATE_LABEL[m.state] && (
              <span className={`rounded px-1.5 py-0.5 text-xs ${STATE_LABEL[m.state]!.className}`}>{STATE_LABEL[m.state]!.text}</span>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}

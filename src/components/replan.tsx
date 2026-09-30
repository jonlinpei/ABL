"use client";

import { useState } from "react";

import type { Plan, Replan, ReplanRequest } from "@/lib/specialists/schemas";

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
          {sending ? "Starting…" : "Rework my plan"}
        </button>
        <button onClick={onCancel} disabled={sending} className="text-sm text-foreground/60 underline">
          Cancel
        </button>
      </div>
      {error && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>}
    </section>
  );
}

/** The reworked plan, what changed and why, and the learner's choice. */
export function ProposalView({
  huddleId,
  proposal,
  current,
  onDecided,
}: {
  huddleId: string;
  proposal: Replan;
  current: Plan;
  onDecided: () => void;
}) {
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const weeks = (p: Plan) => p.milestones.reduce((n, m) => n + m.weeks, 0);

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
      <div className="text-xs uppercase tracking-wide text-foreground/50">Your reworked plan</div>
      <h2 className="mt-1 text-lg font-medium">{proposal.title}</h2>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-foreground/70">
        <span>
          {proposal.weeklyHours} h/week <span className="text-foreground/40">(was {current.weeklyHours})</span>
        </span>
        <span>
          {proposal.sessionMinutes}-min sessions <span className="text-foreground/40">(was {current.sessionMinutes})</span>
        </span>
        <span>About {weeks(proposal)} weeks from here</span>
      </div>
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
      <p className="mt-3 text-sm text-foreground/70">{proposal.deadlineFit}</p>
      <details className="mt-3 text-sm">
        <summary className="cursor-pointer text-foreground/60">The new milestones</summary>
        <ol className="mt-2 list-decimal pl-5 text-foreground/80">
          {proposal.milestones.map((m, i) => (
            <li key={i}>
              {m.title} <span className="text-foreground/50">· {m.weeks} wk</span>
            </li>
          ))}
        </ol>
      </details>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button onClick={() => decide(true)} disabled={sending} className="rounded-lg bg-foreground px-4 py-2 text-sm text-background disabled:opacity-50">
          Use the new plan
        </button>
        <button onClick={() => decide(false)} disabled={sending} className="text-sm text-foreground/60 underline">
          Keep my current plan
        </button>
      </div>
      {error && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>}
    </section>
  );
}

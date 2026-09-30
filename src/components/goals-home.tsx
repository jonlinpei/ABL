"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import type { GoalSummary } from "@/lib/goals/goal-store";

import { deleteGoalNow, DELETE_NOW_CONFIRM, goalAction } from "./goal-actions";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The learner's goals, like courses on Duolingo: the ones they're working on
 * up top, then paused, completed and recently removed goals out of the way.
 */
export function GoalsHome({ goals }: { goals: GoalSummary[] }) {
  const active = goals.filter((g) => g.status === "active");
  const paused = goals.filter((g) => g.status === "paused");
  const completed = goals.filter((g) => g.status === "completed");
  const removed = goals.filter((g) => g.status === "removed");

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-8 sm:px-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Your goals</h1>
        <Link href="/app/goals/new" className="rounded-lg bg-foreground px-4 py-2 text-sm text-background">
          + New goal
        </Link>
      </div>

      {active.length > 0 ? (
        <ul className="grid gap-3 sm:grid-cols-2">
          {active.map((g) => (
            <li key={g.id}>
              <ActiveCard goal={g} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-xl border border-dashed border-foreground/20 p-5 text-sm text-foreground/70">
          You&apos;re not working on a goal right now. Start a new one, or pick one up below.
        </p>
      )}

      {paused.length > 0 && (
        <Section title="Paused" count={paused.length}>
          {paused.map((g) => (
            <Row key={g.id} goal={g} detail={progressLine(g)} actions={[{ label: "Resume", action: "resume" }]} />
          ))}
        </Section>
      )}
      {completed.length > 0 && (
        <Section title="Completed" count={completed.length}>
          {completed.map((g) => (
            <Row
              key={g.id}
              goal={g}
              detail={g.completedAt ? `Completed ${formatDate(g.completedAt)}` : "Completed"}
              actions={[{ label: "Reopen", action: "reopen" }]}
            />
          ))}
        </Section>
      )}
      {removed.length > 0 && (
        <Section
          title="Recently removed"
          count={removed.length}
          note="Removed goals are deleted after 30 days. Your skills from them stay either way."
        >
          {removed.map((g) => (
            <Row
              key={g.id}
              goal={g}
              link={false}
              detail={g.purgeAt ? deletesIn(g.purgeAt) : ""}
              actions={[{ label: "Restore", action: "restore" }, { label: "Delete now", action: "delete" }]}
            />
          ))}
        </Section>
      )}
    </div>
  );
}

function ActiveCard({ goal }: { goal: GoalSummary }) {
  return (
    <Link
      href={`/app/goals/${goal.id}`}
      className="flex h-full flex-col rounded-xl border border-foreground/15 p-4 transition hover:border-foreground/40"
    >
      <span className="text-xs uppercase tracking-wide text-foreground/50">{goal.industry || "Goal"}</span>
      <span className="mt-1 text-lg font-medium">{goal.title}</span>
      <span className="mt-1 text-sm text-foreground/70">{progressLine(goal)}</span>
      {goal.progress && goal.progress.total > 0 && (
        <span className="mt-3 h-1.5 overflow-hidden rounded-full bg-foreground/10" aria-hidden="true">
          <span
            className="block h-full rounded-full bg-foreground/60"
            style={{ width: `${Math.round((goal.progress.done / goal.progress.total) * 100)}%` }}
          />
        </span>
      )}
      {goal.lastSessionAt && (
        <span className="mt-2 text-xs text-foreground/50">Last session {formatDate(goal.lastSessionAt)}</span>
      )}
    </Link>
  );
}

type RowAction = { label: string; action: "resume" | "reopen" | "restore" | "delete" };

function Row({
  goal,
  detail,
  actions,
  link = true,
}: {
  goal: GoalSummary;
  detail: string;
  actions: RowAction[];
  link?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run({ action }: RowAction) {
    if (action === "delete" && !window.confirm(DELETE_NOW_CONFIRM)) return;
    setBusy(true);
    setError(null);
    try {
      if (action === "delete") await deleteGoalNow(goal.id);
      else await goalAction(goal.id, action);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="flex flex-wrap items-center justify-between gap-2 py-3">
      <div className="min-w-0">
        {link ? (
          <Link href={`/app/goals/${goal.id}`} className="font-medium hover:underline">
            {goal.title}
          </Link>
        ) : (
          <span className="font-medium text-foreground/70">{goal.title}</span>
        )}
        <span className="block text-sm text-foreground/60">{detail}</span>
        {error && <span className="block text-sm text-red-600 dark:text-red-400">{error}</span>}
      </div>
      <div className="flex gap-2">
        {actions.map((a) => (
          <button
            key={a.action}
            onClick={() => run(a)}
            disabled={busy}
            className={
              a.action === "delete"
                ? "rounded-lg px-3 py-1.5 text-sm text-red-700 underline disabled:opacity-40 dark:text-red-300"
                : "rounded-lg border border-foreground/20 px-3 py-1.5 text-sm hover:border-foreground/50 disabled:opacity-40"
            }
          >
            {a.label}
          </button>
        ))}
      </div>
    </li>
  );
}

function Section({
  title,
  count,
  note,
  children,
}: {
  title: string;
  count: number;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <details className="rounded-xl border border-foreground/15 px-4">
      <summary className="cursor-pointer py-3 text-sm text-foreground/70">
        {title} ({count})
      </summary>
      {note && <p className="text-xs text-foreground/50">{note}</p>}
      <ul className="divide-y divide-foreground/10 pb-1">{children}</ul>
    </details>
  );
}

function progressLine(goal: GoalSummary): string {
  if (!goal.progress) return "Building your path…";
  const { done, total } = goal.progress;
  if (done >= total) return "Every milestone done";
  return `Milestone ${done + 1} of ${total}${goal.planTitle ? ` · ${goal.planTitle}` : ""}`;
}

function deletesIn(purgeAt: string): string {
  const days = Math.max(0, Math.ceil((new Date(purgeAt).getTime() - Date.now()) / DAY_MS));
  return days <= 1 ? "Deletes within a day" : `Deletes in ${days} days`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

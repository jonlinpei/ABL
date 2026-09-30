"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import type { GoalStatus } from "@/db/schema";
import type { GoalAction } from "@/lib/goals/lifecycle";

import { goalAction, REMOVE_CONFIRM } from "./goal-actions";
import { SkillsCheck } from "./skills-check";

export interface GoalViewProps {
  id: string;
  status: Exclude<GoalStatus, "removed">;
  /** The target role; null while the first brief is still being saved. */
  title: string | null;
  industry: string | null;
  completedAt: string | null;
}

/**
 * One goal: its path, sessions and skills check, with ways to change, pause,
 * complete or remove it. Paused and completed goals show their path
 * without sessions.
 */
export function GoalView({ goal }: { goal: GoalViewProps }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Opening a goal makes it the one the learner comes back to.
  useEffect(() => {
    goalAction(goal.id, "open").catch(() => {});
  }, [goal.id]);

  async function act(action: GoalAction) {
    if (action === "remove" && !window.confirm(REMOVE_CONFIRM)) return;
    setBusy(true);
    setError(null);
    try {
      await goalAction(goal.id, action);
      if (action === "remove") router.push("/app");
      else router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const active = goal.status === "active";
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-8 sm:px-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          {goal.industry && <div className="text-xs uppercase tracking-wide text-foreground/50">{goal.industry}</div>}
          <h1 className="text-2xl font-semibold tracking-tight">
            {goal.title ? `Your path to ${goal.title}` : "Your new goal"}
          </h1>
        </div>
        <details className="relative">
          <summary className="cursor-pointer list-none rounded-lg border border-foreground/15 px-3 py-1.5 text-sm text-foreground/70 hover:border-foreground/40">
            Goal options
          </summary>
          <div className="absolute right-0 z-10 mt-1 flex w-52 flex-col rounded-lg border border-foreground/15 bg-background p-1 text-sm shadow-sm">
            {active && (
              <Link href={`/app/goals/${goal.id}/change`} className="rounded px-3 py-2 hover:bg-foreground/5">
                Change this goal
              </Link>
            )}
            {active && <MenuButton label="Pause" onClick={() => act("pause")} disabled={busy} />}
            {goal.status === "paused" && <MenuButton label="Resume" onClick={() => act("resume")} disabled={busy} />}
            {goal.status !== "completed" && (
              <MenuButton label="Mark complete" onClick={() => act("complete")} disabled={busy} />
            )}
            {goal.status === "completed" && <MenuButton label="Reopen" onClick={() => act("reopen")} disabled={busy} />}
            <MenuButton label="Remove" onClick={() => act("remove")} disabled={busy} danger />
          </div>
        </details>
      </div>
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      {goal.status === "paused" && (
        <StatusBanner>
          This goal is paused. Your coach won&apos;t check in on it, and your skills from it stay.{" "}
          <button onClick={() => act("resume")} disabled={busy} className="underline">
            Resume it
          </button>{" "}
          to pick up where you left off.
        </StatusBanner>
      )}
      {goal.status === "completed" && (
        <StatusBanner>
          You completed this goal{goal.completedAt ? ` on ${formatDate(goal.completedAt)}` : ""}. What you learned stays in your skills,
          and it keeps coming up for review in your other goals.{" "}
          <button onClick={() => act("reopen")} disabled={busy} className="underline">
            Reopen it
          </button>{" "}
          to keep going.
        </StatusBanner>
      )}

      <SkillsCheck goalId={goal.id} readOnly={!active} />
    </div>
  );
}

function MenuButton({
  label,
  onClick,
  disabled,
  danger = false,
}: {
  label: string;
  onClick: () => void;
  disabled: boolean;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`rounded px-3 py-2 text-left hover:bg-foreground/5 disabled:opacity-40 ${danger ? "text-red-700 dark:text-red-300" : ""}`}
    >
      {label}
    </button>
  );
}

function StatusBanner({ children }: { children: React.ReactNode }) {
  return <p className="rounded-xl border border-foreground/15 bg-foreground/5 p-4 text-sm text-foreground/80">{children}</p>;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" });
}

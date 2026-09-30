"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import type { GoalsResponse } from "@/app/api/goals/route";
import type { GoalSummary } from "@/lib/goals/goal-store";

/**
 * Switch between goals from anywhere, like the course flag on Duolingo: the
 * goal being viewed, the other active goals, and a way to start a new one.
 */
export function GoalSwitcher() {
  const pathname = usePathname();
  const [goals, setGoals] = useState<GoalSummary[] | null>(null);
  const menu = useRef<HTMLDetailsElement>(null);

  // Refreshed on every navigation, so a new, paused or removed goal shows up.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/goals")
      .then((res) => (res.ok ? (res.json() as Promise<GoalsResponse>) : null))
      .catch(() => null)
      .then((data) => !cancelled && setGoals(data?.goals ?? null));
    if (menu.current) menu.current.open = false;
    return () => {
      cancelled = true;
    };
  }, [pathname]);

  if (!goals || goals.length === 0) return null;
  const viewing = goals.find((g) => pathname.startsWith(`/app/goals/${g.id}`));
  const active = goals.filter((g) => g.status === "active");

  return (
    <details ref={menu} className="relative">
      <summary className="flex max-w-[12rem] cursor-pointer list-none items-center gap-1 rounded-lg px-2 py-1 text-sm hover:bg-foreground/5 sm:max-w-xs">
        <span className="truncate">{viewing?.title ?? "Your goals"}</span>
        <span aria-hidden="true" className="text-foreground/50">
          ▾
        </span>
      </summary>
      <div className="absolute left-0 z-20 mt-1 flex w-64 flex-col rounded-lg border border-foreground/15 bg-background p-1 text-sm shadow-sm">
        {active.map((g) => (
          <Link
            key={g.id}
            href={`/app/goals/${g.id}`}
            aria-current={g.id === viewing?.id ? "page" : undefined}
            className={`rounded px-3 py-2 hover:bg-foreground/5 ${g.id === viewing?.id ? "font-medium" : ""}`}
          >
            <span className="block truncate">{g.title}</span>
            {g.progress && (
              <span className="block text-xs text-foreground/50">
                {g.progress.done >= g.progress.total
                  ? "Every milestone done"
                  : `Milestone ${g.progress.done + 1} of ${g.progress.total}`}
              </span>
            )}
          </Link>
        ))}
        {active.length > 0 && <hr className="my-1 border-foreground/10" />}
        <Link href="/app/goals/new" className="rounded px-3 py-2 hover:bg-foreground/5">
          + New goal
        </Link>
        <Link href="/app?all=1" className="rounded px-3 py-2 text-foreground/70 hover:bg-foreground/5">
          All goals
        </Link>
      </div>
    </details>
  );
}

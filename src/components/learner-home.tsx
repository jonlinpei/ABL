"use client";

import { useEffect, useState } from "react";

import type { LearnerStatus } from "@/app/api/learner/status/route";

import { GoalDiscoveryDemo } from "./goal-discovery-demo";
import { SkillsCheck } from "./skills-check";

/**
 * Where a returning learner picks up: the skills check or their gap if they
 * already confirmed a brief, discovery otherwise.
 */
export function LearnerHome() {
  const [view, setView] = useState<"loading" | "discovery" | "resume">("loading");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/learner/status")
      .then((res) => (res.ok ? (res.json() as Promise<LearnerStatus>) : null))
      .catch(() => null)
      .then((status) => {
        if (cancelled) return;
        // No database or no brief yet: start with discovery.
        setView(status && status.stage !== "no_brief" ? "resume" : "discovery");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (view === "loading") return null;
  if (view === "discovery") return <GoalDiscoveryDemo />;
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-8 sm:px-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Welcome back</h1>
        <button className="text-sm text-foreground/60 underline" onClick={() => setView("discovery")}>
          Set a new goal
        </button>
      </div>
      <SkillsCheck />
    </div>
  );
}

"use client";

import { useState } from "react";

import type { PlanProgress } from "@/app/api/learner/status/route";

import { ThinkingWords, WorkingLabel } from "./thinking-words";

type Quest = NonNullable<PlanProgress["sideQuest"]>;

const RELEVANCE: Record<Quest["relevance"], string> = {
  core: "on your path",
  related: "related to your goal",
  tangent: "a detour for interest",
};

const weeks = (n: number) => (n === 1 ? "1 week" : `${n} weeks`);

/**
 * Side quests (PRD story 13): explore a related topic in a few sessions of
 * its own, seeing what it costs the timeline before choosing.
 */
export function SideQuest({
  goalId,
  quest,
  onStartSession,
  onChanged,
}: {
  goalId: string;
  quest: Quest | null;
  onStartSession: (questId: string) => void;
  onChanged: () => void;
}) {
  const [asking, setAsking] = useState(false);
  const [topic, setTopic] = useState("");
  const [busy, setBusy] = useState<"draft" | "start" | "drop" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function call(url: string, body: unknown, kind: typeof busy) {
    setBusy(kind);
    setError(null);
    try {
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? `Request failed (${res.status})`);
      setAsking(false);
      setTopic("");
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }
  const errorLine = error && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>;

  if (quest?.status === "active") {
    const done = quest.sessionsDone >= quest.sessions;
    return (
      <section className="rounded-xl border border-violet-500/40 bg-violet-500/5 p-4">
        <div className="text-xs uppercase tracking-wide text-foreground/50">
          Side quest · {quest.mode === "plan_time" ? `using plan time (about ${weeks(quest.planWeeks)} added)` : "on extra time"}
        </div>
        <div className="mt-1 font-medium">{quest.title}</div>
        <p className="mt-1 text-sm text-foreground/70">
          {Math.min(quest.sessionsDone, quest.sessions)} of {quest.sessions} session{quest.sessions === 1 ? "" : "s"} done
          {done ? ". One more to wrap it up." : "."}
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button onClick={() => onStartSession(quest.id)} className="rounded-lg bg-foreground px-4 py-2 text-sm text-background">
            Start a side-quest session
          </button>
          <button onClick={() => call(`/api/side-quests/${quest.id}`, { action: "drop" }, "drop")} disabled={!!busy} className="text-sm text-foreground/60 underline">
            {busy === "drop" ? <WorkingLabel label="Dropping" /> : "Drop it"}
          </button>
        </div>
        {errorLine}
      </section>
    );
  }

  if (quest?.status === "proposed") {
    return (
      <section className="rounded-xl border border-violet-500/40 bg-violet-500/5 p-4">
        <div className="text-xs uppercase tracking-wide text-foreground/50">Side quest · {RELEVANCE[quest.relevance]}</div>
        <div className="mt-1 text-lg font-medium">{quest.title}</div>
        <p className="mt-1 text-sm text-foreground/80">{quest.why}</p>
        <ul className="mt-2 list-disc pl-5 text-sm text-foreground/80">
          {quest.outline.map((o) => (
            <li key={o}>{o}</li>
          ))}
        </ul>
        <p className="mt-2 text-sm text-foreground/60">
          {quest.sessions} session{quest.sessions === 1 ? "" : "s"} · builds {quest.skillName}
        </p>
        <div className="mt-3 text-sm font-medium">How do you want to fit it in?</div>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          <button
            onClick={() => call(`/api/side-quests/${quest.id}`, { action: "start", mode: "plan_time" }, "start")}
            disabled={!!busy}
            className="rounded-lg border border-foreground/20 bg-background p-3 text-left text-sm hover:border-foreground/50 disabled:opacity-50"
          >
            <span className="font-medium">Use my plan time</span>
            <span className="block text-foreground/60">Your finish moves about {weeks(quest.planWeeks)} later.</span>
          </button>
          <button
            onClick={() => call(`/api/side-quests/${quest.id}`, { action: "start", mode: "extra" }, "start")}
            disabled={!!busy}
            className="rounded-lg border border-foreground/20 bg-background p-3 text-left text-sm hover:border-foreground/50 disabled:opacity-50"
          >
            <span className="font-medium">Use extra time</span>
            <span className="block text-foreground/60">Your finish date stays. These sessions are on top of your week.</span>
          </button>
        </div>
        <button onClick={() => call(`/api/side-quests/${quest.id}`, { action: "drop" }, "drop")} disabled={!!busy} className="mt-3 text-sm text-foreground/60 underline">
          {busy === "drop" ? <WorkingLabel label="Dropping" /> : "Not now"}
        </button>
        {busy === "start" && (
          <p className="mt-2 text-sm">
            <WorkingLabel label="Starting" />
          </p>
        )}
        {errorLine}
      </section>
    );
  }

  if (!asking) {
    return (
      <button onClick={() => setAsking(true)} className="self-start text-sm text-foreground/60 underline hover:text-foreground">
        Curious about something off your path? Explore a side quest
      </button>
    );
  }
  return (
    <section className="rounded-xl border border-foreground/15 p-4">
      <div className="font-medium">Explore a side quest</div>
      <p className="mt-1 text-sm text-foreground/70">
        Name a topic you&apos;d like to explore. I&apos;ll plan a short detour of a few sessions and show you what it means for your finish date
        before you choose.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (topic.trim()) call("/api/side-quests", { goalId, topic: topic.trim() }, "draft");
        }}
        className="mt-3 flex flex-col gap-2 sm:flex-row"
      >
        <input
          value={topic}
          onChange={(e) => setTopic(e.currentTarget.value)}
          placeholder="e.g. Python for data analysis"
          aria-label="Topic to explore"
          className="min-w-0 flex-1 rounded-lg border border-foreground/15 bg-background px-3 py-1.5 text-sm"
        />
        <button type="submit" disabled={!!busy || !topic.trim()} className="rounded-lg bg-foreground px-4 py-1.5 text-sm text-background disabled:opacity-40">
          Plan it
        </button>
        <button type="button" onClick={() => setAsking(false)} className="text-sm text-foreground/60 underline">
          Cancel
        </button>
      </form>
      {busy === "draft" && <ThinkingWords words={["Planning your side quest", "Connecting it to your goal", "Working out the time it takes"]} className="mt-2 block text-sm" />}
      {errorLine}
    </section>
  );
}

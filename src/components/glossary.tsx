"use client";

import { useEffect, useState } from "react";

import type { GlossaryView } from "@/app/api/glossary/route";
import type { Familiarity } from "@/lib/specialists/glossary";

const FAMILIARITY: Record<Familiarity, { label: string; className: string }> = {
  new: { label: "new", className: "bg-foreground/10 text-foreground/70" },
  shaky: { label: "still learning", className: "bg-amber-500/15 text-amber-700 dark:text-amber-300" },
  solid: { label: "know it", className: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" },
};

/**
 * The learner's glossary (PRD F6): terms from their sessions, side questions
 * and their own additions, one headword per term with a numbered sense per
 * field, so "pivot" in spreadsheets and in SQL sit side by side.
 */
export function Glossary() {
  const [data, setData] = useState<GlossaryView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<"goal" | "all">("goal");

  useEffect(() => {
    let cancelled = false;
    request("GET").then(
      (d) => !cancelled && setData(d),
      (err) => !cancelled && setError(err instanceof Error ? err.message : String(err)),
    );
    return () => {
      cancelled = true;
    };
  }, []);

  async function act(method: "POST" | "PATCH" | "DELETE", body: unknown) {
    setError(null);
    try {
      setData(await request(method, body));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      throw err;
    }
  }

  const headwords = (data?.headwords ?? [])
    .map((h) => ({ ...h, senses: scope === "goal" ? h.senses.filter((s) => s.inCurrentGoal) : h.senses }))
    .filter((h) => h.senses.length > 0)
    .filter((h) => {
      const q = query.trim().toLowerCase();
      return !q || h.headword.toLowerCase().includes(q) || h.senses.some((s) => s.definition.toLowerCase().includes(q));
    });
  const total = data?.headwords.reduce((n, h) => n + h.senses.length, 0) ?? 0;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-5 px-4 py-8 sm:px-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Your glossary</h1>
        <p className="mt-1 text-sm text-foreground/70">
          Terms from your sessions and quick questions, plus any you add. When a word means different things in different fields,
          each meaning gets its own entry.
        </p>
      </div>
      <AddTerm onAdd={(term, note) => act("POST", { term, note })} />
      {error && <div className="rounded-lg border border-red-500/40 bg-red-500/5 p-3 text-sm">{error}</div>}
      {data && total > 0 && (
        <div className="flex flex-wrap items-center gap-3">
          <input
            value={query}
            onChange={(e) => setQuery(e.currentTarget.value)}
            placeholder="Search your glossary"
            aria-label="Search your glossary"
            className="min-w-0 flex-1 rounded-lg border border-foreground/15 bg-background px-3 py-1.5 text-sm"
          />
          <div className="flex rounded-lg border border-foreground/15 p-0.5 text-sm">
            {(["goal", "all"] as const).map((s) => (
              <button
                key={s}
                onClick={() => setScope(s)}
                className={`rounded-md px-3 py-1 ${scope === s ? "bg-foreground text-background" : "text-foreground/60"}`}
              >
                {s === "goal" ? "This goal" : "All"}
              </button>
            ))}
          </div>
        </div>
      )}
      {!data && !error && <p className="text-sm text-foreground/60">Loading…</p>}
      {data && total === 0 && (
        <p className="rounded-xl border border-dashed border-foreground/20 p-5 text-sm text-foreground/60">
          Nothing here yet. Terms you meet in sessions and quick questions will appear here, and you can add your own above.
        </p>
      )}
      {data && total > 0 && headwords.length === 0 && (
        <p className="text-sm text-foreground/60">
          No matches{scope === "goal" ? " for this goal. Try All." : "."}
        </p>
      )}
      <ul className="flex flex-col divide-y divide-foreground/10">
        {headwords.map((h) => (
          <li key={h.headword} className="py-4">
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="text-lg font-medium">{h.headword}</span>
              {h.senses.length > 1 && (
                <span className="text-xs text-foreground/50">means different things in {h.senses.map((s) => s.domain).join(" and ")}</span>
              )}
            </div>
            <ol className="mt-2 flex flex-col gap-3">
              {h.senses.map((s, n) => (
                <li key={s.id} className="text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    {h.senses.length > 1 && <span className="text-foreground/50">{n + 1}.</span>}
                    <span className="rounded-full border border-foreground/15 px-2 py-0.5 text-xs text-foreground/70">{s.domain}</span>
                    <span className={`rounded px-1.5 py-0.5 text-xs ${FAMILIARITY[s.familiarity].className}`}>{FAMILIARITY[s.familiarity].label}</span>
                    {s.skillName && <span className="text-xs text-foreground/50">· {s.skillName}</span>}
                  </div>
                  <p className="mt-1 leading-relaxed">{s.definition}</p>
                  <div className="mt-1 flex gap-3 text-xs text-foreground/60">
                    <button onClick={() => act("PATCH", { id: s.id, known: !s.known }).catch(() => {})} className="underline">
                      {s.known ? "Still learning this" : "I know this"}
                    </button>
                    <button onClick={() => act("DELETE", { id: s.id }).catch(() => {})} className="underline">
                      Remove
                    </button>
                  </div>
                </li>
              ))}
            </ol>
          </li>
        ))}
      </ul>
    </div>
  );
}

function AddTerm({ onAdd }: { onAdd: (term: string, note: string | null) => Promise<void> }) {
  const [term, setTerm] = useState("");
  const [note, setNote] = useState("");
  const [adding, setAdding] = useState(false);

  async function add() {
    if (!term.trim() || adding) return;
    setAdding(true);
    try {
      await onAdd(term.trim(), note.trim() || null);
      setTerm("");
      setNote("");
    } catch {
      // The error is shown above the list.
    } finally {
      setAdding(false);
    }
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        add();
      }}
      className="flex flex-col gap-2 rounded-xl border border-foreground/15 p-3 sm:flex-row"
    >
      <input
        value={term}
        onChange={(e) => setTerm(e.currentTarget.value)}
        placeholder="Add a term, e.g. leverage"
        aria-label="Term to add"
        className="min-w-0 flex-1 rounded-lg border border-foreground/15 bg-background px-3 py-1.5 text-sm"
      />
      <input
        value={note}
        onChange={(e) => setNote(e.currentTarget.value)}
        placeholder="Which meaning? (optional) e.g. in finance"
        aria-label="Which meaning (optional)"
        className="min-w-0 flex-1 rounded-lg border border-foreground/15 bg-background px-3 py-1.5 text-sm"
      />
      <button
        type="submit"
        disabled={adding || !term.trim()}
        className="rounded-lg bg-foreground px-4 py-1.5 text-sm text-background disabled:opacity-40"
      >
        {adding ? "Adding…" : "Add"}
      </button>
    </form>
  );
}

async function request(method: "GET" | "POST" | "PATCH" | "DELETE", body?: unknown): Promise<GlossaryView> {
  const res = await fetch("/api/glossary", {
    method,
    ...(body !== undefined && { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error ?? `Request failed (${res.status})`);
  return data as GlossaryView;
}

"use client";

import { useEffect, useState } from "react";

import type { RemindersResponse } from "@/app/api/reminders/route";

import { WorkingLabel } from "./thinking-words";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * Reminders at times the learner chooses (PRD story 11): which days, what
 * time, in their time zone. At that time ABL's coach checks in and an email
 * brings their next step.
 */
export function Reminders() {
  const [prefs, setPrefs] = useState<RemindersResponse | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const browserZone = typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone : "America/Los_Angeles";

  useEffect(() => {
    let cancelled = false;
    fetch("/api/reminders")
      .then((r) => (r.ok ? (r.json() as Promise<RemindersResponse>) : null))
      .then((p) => {
        if (cancelled || !p) return;
        // New learners start in their browser's time zone.
        setPrefs(p.enabled || p.unsubscribed ? p : { ...p, timeZone: browserZone });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [browserZone]);

  async function save(next: RemindersResponse) {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch("/api/reminders", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: next.enabled, days: next.days, time: next.time, timeZone: next.timeZone }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? `Request failed (${res.status})`);
      setPrefs(data as RemindersResponse);
      setMessage(next.enabled ? "Saved. Your coach will check in at that time." : "Reminders are off.");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  if (!prefs) return null;
  const toggleDay = (d: number) => setPrefs({ ...prefs, days: prefs.days.includes(d) ? prefs.days.filter((x) => x !== d) : [...prefs.days, d].sort() });
  const field = "rounded-lg border border-foreground/15 bg-background px-2 py-1.5 text-sm";
  return (
    <section className="rounded-xl border border-foreground/15 p-4">
      <h2 className="text-lg font-medium">Reminders</h2>
      <p className="mt-1 text-sm text-foreground/70">
        Pick when you like to learn. At that time your coach checks in, and you get an email with your next step. One a day at most, and
        you can stop them from any email.
      </p>
      {prefs.unsubscribed && !prefs.enabled && <p className="mt-2 text-sm text-foreground/60">You turned reminders off from an email.</p>}
      <label className="mt-3 flex items-center gap-2 text-sm">
        <input type="checkbox" checked={prefs.enabled} onChange={(e) => setPrefs({ ...prefs, enabled: e.currentTarget.checked })} />
        Send me reminders
      </label>
      <fieldset disabled={!prefs.enabled} className="mt-3 flex flex-col gap-3 disabled:opacity-50">
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Days">
          {DAYS.map((label, d) => (
            <button
              key={label}
              type="button"
              aria-pressed={prefs.days.includes(d)}
              onClick={() => toggleDay(d)}
              className={`rounded-full border px-3 py-1 text-sm ${prefs.days.includes(d) ? "border-foreground bg-foreground text-background" : "border-foreground/15"}`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <label className="flex items-center gap-2">
            At
            <input type="time" value={prefs.time} onChange={(e) => setPrefs({ ...prefs, time: e.currentTarget.value })} className={field} />
          </label>
          <label className="flex items-center gap-2">
            Time zone
            <input value={prefs.timeZone} onChange={(e) => setPrefs({ ...prefs, timeZone: e.currentTarget.value })} className={`${field} w-56`} />
          </label>
          {prefs.timeZone !== browserZone && (
            <button type="button" onClick={() => setPrefs({ ...prefs, timeZone: browserZone })} className="text-xs text-foreground/60 underline">
              Use {browserZone}
            </button>
          )}
        </div>
      </fieldset>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button onClick={() => save(prefs)} disabled={saving} className="rounded-lg bg-foreground px-4 py-2 text-sm text-background disabled:opacity-40">
          {saving ? <WorkingLabel label="Saving" onDark /> : "Save reminders"}
        </button>
        {message && <span className="text-sm text-foreground/70">{message}</span>}
      </div>
      {prefs.enabled && !prefs.emailReady && (
        <p className="mt-2 text-xs text-foreground/50">Email isn&apos;t set up on this server yet, so check-ins happen at your time but no email goes out.</p>
      )}
    </section>
  );
}

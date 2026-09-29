"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import type { LearnerRecord } from "@/app/api/learner/route";
import type { SkillCorrectionResponse } from "@/app/api/learner/skill/route";
import type { GoalBrief } from "@/lib/goals/schema";
import type { Gap } from "@/lib/specialists/schemas";

import { BriefCard, GuessTag, PRIORITY_LABEL } from "./brief-card";
import { ReplanForm } from "./replan";
import { BASIS_LABEL, LEVEL_LABEL, LevelBar } from "./skill-labels";

type GapItem = Gap["items"][number];

/**
 * "What ABL knows about me": the learner's brief, skills and the evidence
 * behind each level, with ways to correct them or delete it all.
 */
export function AboutMe() {
  const [record, setRecord] = useState<LearnerRecord | null | "none">(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchRecord().then(
      (r) => !cancelled && setRecord(r),
      (err) => !cancelled && setError(err instanceof Error ? err.message : String(err)),
    );
    return () => {
      cancelled = true;
    };
  }, []);
  const load = useCallback(async () => setRecord(await fetchRecord()), []);

  if (error) return <Page><ErrorBox message={error} /></Page>;
  if (record === null) return <Page><p className="text-sm text-foreground/60">Loading…</p></Page>;
  if (record === "none") {
    return (
      <Page>
        <p className="text-foreground/70">
          ABL doesn&apos;t know anything about you yet. <Link href="/app" className="underline">Set a goal</Link> to get started.
        </p>
      </Page>
    );
  }
  return (
    <Page>
      <p className="text-sm text-foreground/70">
        This is everything ABL uses to teach and coach you. Fix anything that&apos;s wrong: your tutor and coach use the changes
        from your next session.
      </p>
      <section>
        <h2 className="text-lg font-medium">Your goal</h2>
        <BriefCard brief={record.brief} />
        <p className="mt-2 text-sm text-foreground/60">
          To change where you&apos;re going or where you&apos;re starting from, choose <span className="font-medium">Set a new goal</span> on{" "}
          <Link href="/app" className="underline">your home page</Link>. You&apos;ll get a new plan built for it.
        </p>
      </section>
      <YourWeek record={record} />
      <AboutYou brief={record.brief} onSaved={load} />
      {record.gap && <YourSkills record={record} gap={record.gap} onSaved={load} />}
      <DeleteData />
    </Page>
  );
}

async function fetchRecord(): Promise<LearnerRecord | "none"> {
  const res = await fetch("/api/learner");
  if (res.status === 404) return "none";
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error ?? `Request failed (${res.status})`);
  return data as LearnerRecord;
}

function YourWeek({ record }: { record: LearnerRecord }) {
  const [editing, setEditing] = useState(false);
  const [started, setStarted] = useState(false);
  const week = record.week ?? { weeklyHours: record.brief.weeklyHours, sessionMinutes: record.brief.sessionMinutes };
  return (
    <Card title="Your week">
      <p className="text-sm">
        {week.weeklyHours} hours a week, in {week.sessionMinutes}-minute sessions
        {record.brief.preferredTimes ? `, ${record.brief.preferredTimes}` : ""}. Deadline: {record.brief.deadline ?? "none set"}.
      </p>
      {started ? (
        <p className="mt-2 text-sm text-foreground/70">
          Reworking your plan. You&apos;ll see the proposal on <Link href="/app" className="underline">your home page</Link> in a minute or two.
        </p>
      ) : !record.hasPlan ? (
        <p className="mt-2 text-sm text-foreground/60">Your plan will be built around this. You can change it once it&apos;s ready.</p>
      ) : editing ? (
        <div className="mt-3">
          <ReplanForm plan={week} onStarted={() => setStarted(true)} onCancel={() => setEditing(false)} />
        </div>
      ) : (
        <button onClick={() => setEditing(true)} className="mt-2 text-sm underline">
          Change my hours, sessions or deadline
        </button>
      )}
      {record.hasPlan && !editing && !started && (
        <p className="mt-1 text-xs text-foreground/50">Changing these reworks your plan, and you&apos;ll see the changes before anything switches.</p>
      )}
    </Card>
  );
}

type DetailsDraft = {
  interests: string;
  strengths: string;
  priority: GoalBrief["priority"];
  preferredTimes: string;
  motivation: string;
  successLooksLike: string;
  pastAttempts: string;
};

function draftOf(brief: GoalBrief): DetailsDraft {
  return {
    interests: brief.interests.join(", "),
    strengths: brief.current.strengths.join(", "),
    priority: brief.priority,
    preferredTimes: brief.preferredTimes ?? "",
    motivation: brief.motivation,
    successLooksLike: brief.successLooksLike,
    pastAttempts: brief.pastAttempts ?? "",
  };
}

const list = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);

/** Only the fields the learner changed, in the shape the brief stores them. */
function changedDetails(brief: GoalBrief, draft: DetailsDraft): Record<string, unknown> {
  const before = draftOf(brief);
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(draft) as (keyof DetailsDraft)[]) {
    if (draft[key].trim() === before[key].trim()) continue;
    const value = draft[key].trim();
    if (key === "interests" || key === "strengths") out[key] = list(value);
    else if (key === "preferredTimes" || key === "pastAttempts") out[key] = value || null;
    else out[key] = value;
  }
  return out;
}

function AboutYou({ brief, onSaved }: { brief: GoalBrief; onSaved: () => Promise<void> }) {
  const [draft, setDraft] = useState(() => draftOf(brief));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const changes = changedDetails(brief, draft);
  const guessed = (f: string) => (brief.inferred as string[]).includes(f);
  const set = (key: keyof DetailsDraft) => (e: { currentTarget: { value: string } }) =>
    setDraft({ ...draft, [key]: e.currentTarget.value });

  async function save() {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch("/api/learner/brief", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ details: changes }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? `Request failed (${res.status})`);
      await onSaved();
      setMessage("Saved. Your tutor and coach will use this from your next session.");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  const field = "mt-1 w-full rounded-lg border border-foreground/15 bg-background px-2 py-1.5 text-sm";
  const label = (text: string, f?: string) => (
    <span className="text-sm text-foreground/60">
      {text}
      {f && guessed(f) && <GuessTag />}
    </span>
  );
  return (
    <Card title="About you">
      <p className="text-sm text-foreground/60">Your tutor uses these for examples and pacing, and your coach for check-ins.</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label>
          {label("Interests (comma-separated)")}
          <input value={draft.interests} onChange={set("interests")} className={field} />
        </label>
        <label>
          {label("What carries over from your work (comma-separated)")}
          <input value={draft.strengths} onChange={set("strengths")} className={field} />
        </label>
        <label>
          {label("What matters most", "priority")}
          <select value={draft.priority} onChange={set("priority")} className={field}>
            {(Object.keys(PRIORITY_LABEL) as GoalBrief["priority"][]).map((p) => (
              <option key={p} value={p}>
                {PRIORITY_LABEL[p]}
              </option>
            ))}
          </select>
        </label>
        <label>
          {label("When you like to learn", "preferredTimes")}
          <input value={draft.preferredTimes} onChange={set("preferredTimes")} placeholder="e.g. weeknights after 8" className={field} />
        </label>
      </div>
      <label className="mt-3 block">
        {label("Why you want this", "motivation")}
        <textarea value={draft.motivation} onChange={set("motivation")} rows={2} className={field} />
      </label>
      <label className="mt-3 block">
        {label("What success looks like", "successLooksLike")}
        <textarea value={draft.successLooksLike} onChange={set("successLooksLike")} rows={2} className={field} />
      </label>
      <label className="mt-3 block">
        {label("What you've tried before", "pastAttempts")}
        <textarea value={draft.pastAttempts} onChange={set("pastAttempts")} rows={2} className={field} />
      </label>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          onClick={save}
          disabled={saving || Object.keys(changes).length === 0}
          className="rounded-lg bg-foreground px-4 py-2 text-sm text-background disabled:opacity-40"
        >
          {saving ? "Saving…" : "Save changes"}
        </button>
        {message && <span className="text-sm text-foreground/70">{message}</span>}
      </div>
    </Card>
  );
}

/** Why ABL has a skill at its level: the learner's own word, a session, the skills check or their background. */
function evidenceFor(item: GapItem, record: LearnerRecord): string | null {
  if (item.basis === "self_reported") {
    const correction = record.corrections.find((c) => c.skillId === item.skillId);
    if (correction) return correction.note ? `You said: ${correction.note}` : "You set this level yourself.";
  }
  const latest = record.mastery.find((m) => m.skillId === item.skillId)?.evidence.at(-1);
  if (item.basis === "practiced" && latest) return latest.evidence;
  if (item.basis === "assessed") return record.assessment.find((a) => a.skillId === item.skillId)?.evidence ?? null;
  return record.profile?.skills.find((s) => s.skillId === item.skillId)?.evidence ?? null;
}

function YourSkills({ record, gap, onSaved }: { record: LearnerRecord; gap: Gap; onSaved: () => Promise<void> }) {
  const [editing, setEditing] = useState<string | null>(null);
  const [rework, setRework] = useState<{ name: string; from: number; to: number } | null>(null);
  const [reworkStarted, setReworkStarted] = useState(false);
  const week = record.week;
  return (
    <Card title="Your skills">
      <p className="text-sm text-foreground/60">
        Each level is what the role you&apos;re aiming for needs, and where ABL thinks you are, with the reason. If one is wrong, say so:
        your tutor will check it with you early in your next session.
      </p>
      {rework && week && !reworkStarted && (
        <div className="mt-3 rounded-lg border border-sky-500/40 bg-sky-500/5 p-3 text-sm">
          <p>
            Your plan was built with {rework.name} at {LEVEL_LABEL[rework.from]}. Want it reworked around {LEVEL_LABEL[rework.to]}?
          </p>
          <div className="mt-3">
            <ReplanForm
              plan={week}
              initialNote={`I corrected my ${rework.name} level from ${LEVEL_LABEL[rework.from]} to ${LEVEL_LABEL[rework.to]}.`}
              onStarted={() => setReworkStarted(true)}
              onCancel={() => setRework(null)}
            />
          </div>
        </div>
      )}
      {reworkStarted && (
        <p className="mt-3 text-sm text-foreground/70">
          Reworking your plan. You&apos;ll see the proposal on <Link href="/app" className="underline">your home page</Link>.
        </p>
      )}
      <ul className="mt-4 flex flex-col divide-y divide-foreground/10">
        {gap.items.map((item) => (
          <li key={item.skillId} className="py-3">
            <div className="grid gap-1 text-sm sm:grid-cols-[1fr_12rem] sm:items-center sm:gap-4">
              <div>
                <span className="font-medium">{item.name}</span>
                {item.importance === "must" && (
                  <span className="ml-2 inline-block whitespace-nowrap rounded bg-sky-500/15 px-1.5 py-0.5 text-xs text-sky-700 dark:text-sky-300">
                    must-have
                  </span>
                )}
                <span className="block text-xs text-foreground/50">
                  {LEVEL_LABEL[item.current]} now ({BASIS_LABEL[item.basis]}) · needs {LEVEL_LABEL[item.required]}
                </span>
              </div>
              <LevelBar current={item.current} required={item.required} />
            </div>
            {evidenceFor(item, record) && (
              <p className="mt-1 text-sm text-foreground/70">
                <span className="text-foreground/50">Why ABL thinks so: </span>
                {evidenceFor(item, record)}
              </p>
            )}
            {editing === item.skillId ? (
              <CorrectSkill
                item={item}
                onCancel={() => setEditing(null)}
                onSaved={async (to, planAffected) => {
                  setEditing(null);
                  if (planAffected) setRework({ name: item.name, from: item.current, to });
                  await onSaved();
                }}
              />
            ) : (
              <button onClick={() => setEditing(item.skillId)} className="mt-1 text-xs text-foreground/60 underline">
                This isn&apos;t right
              </button>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}

function CorrectSkill({
  item,
  onCancel,
  onSaved,
}: {
  item: GapItem;
  onCancel: () => void;
  onSaved: (level: number, planAffected: boolean) => Promise<void>;
}) {
  const [level, setLevel] = useState(item.current);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/learner/skill", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ skillId: item.skillId, level, note: note.trim() || null }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? `Request failed (${res.status})`);
      await onSaved(level, (data as SkillCorrectionResponse).planAffected);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSaving(false);
    }
  }

  return (
    <div className="mt-2 rounded-lg bg-foreground/5 p-3">
      <div className="text-sm text-foreground/70">Where are you with {item.name}?</div>
      <div className="mt-2 flex flex-wrap gap-2">
        {LEVEL_LABEL.map((label, n) => (
          <button
            key={label}
            onClick={() => setLevel(n)}
            className={`rounded-full border px-3 py-1 text-sm ${
              n === level ? "border-foreground bg-foreground text-background" : "border-foreground/15"
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      <input
        value={note}
        onChange={(e) => setNote(e.currentTarget.value)}
        placeholder="What should ABL know? (optional) e.g. I use joins every day at work"
        className="mt-2 w-full rounded-lg border border-foreground/15 bg-background px-2 py-1.5 text-sm"
      />
      <div className="mt-2 flex items-center gap-3">
        <button
          onClick={save}
          disabled={saving || level === item.current}
          className="rounded-lg bg-foreground px-3 py-1.5 text-sm text-background disabled:opacity-40"
        >
          {saving ? "Saving…" : "Save"}
        </button>
        <button onClick={onCancel} className="text-sm text-foreground/60 underline">
          Cancel
        </button>
        {error && <span className="text-sm text-red-600 dark:text-red-400">{error}</span>}
      </div>
    </div>
  );
}

function DeleteData() {
  const router = useRouter();
  const [confirm, setConfirm] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    setDeleting(true);
    setError(null);
    try {
      const res = await fetch("/api/learner", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: "delete" }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? `Request failed (${res.status})`);
      router.push("/app");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setDeleting(false);
    }
  }

  return (
    <Card title="Delete what ABL knows about you">
      <p className="text-sm text-foreground/70">
        This permanently deletes your goals, skills picture, plans, sessions, glossary and progress. It can&apos;t be undone. Your sign-in account
        stays, so you can start again any time. Anonymous usage analytics (which features were used, and what they cost) aren&apos;t
        deleted.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <input
          value={confirm}
          onChange={(e) => setConfirm(e.currentTarget.value)}
          placeholder='Type "delete" to confirm'
          aria-label='Type "delete" to confirm'
          className="rounded-lg border border-foreground/15 bg-background px-2 py-1.5 text-sm"
        />
        <button
          onClick={remove}
          disabled={deleting || confirm.trim().toLowerCase() !== "delete"}
          className="rounded-lg border border-red-500/60 px-4 py-2 text-sm text-red-700 disabled:opacity-40 dark:text-red-300"
        >
          {deleting ? "Deleting…" : "Delete everything"}
        </button>
      </div>
      {error && <ErrorBox message={error} />}
    </Card>
  );
}

function Page({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-8 sm:px-6">
      <h1 className="text-2xl font-semibold tracking-tight">What ABL knows about you</h1>
      {children}
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-foreground/15 p-4">
      <h2 className="text-lg font-medium">{title}</h2>
      <div className="mt-1">{children}</div>
    </section>
  );
}

function ErrorBox({ message }: { message: string }) {
  return <div className="mt-2 rounded-lg border border-red-500/40 bg-red-500/5 p-3 text-sm">{message}</div>;
}

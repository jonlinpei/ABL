"use client";

import { Chat, useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import type { PlanProgress } from "@/app/api/learner/status/route";
import type { SessionMessage } from "@/app/api/session/route";
import type { StartSessionResponse } from "@/app/api/session/start/route";
import { REWORK_OPTION, type Plan } from "@/lib/specialists/schemas";

import { ChatText } from "./chat-text";
import { goalAction } from "./goal-actions";
import { ProposalView, ReplanForm } from "./replan";
import { SidekickPanel } from "./sidekick-panel";
import { TraceChip } from "./trace-chip";

/**
 * The learner's next step on their roadmap: start (or resume) a tutoring
 * session, see how the last one went, and any homework.
 */
export function SessionPanel({
  goalId,
  plan,
  progress,
  onSessionEnd,
}: {
  goalId: string;
  plan: Plan;
  progress: PlanProgress;
  onSessionEnd: () => void;
}) {
  const [session, setSession] = useState<{ chat: Chat<SessionMessage>; info: StartSessionResponse } | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Kept here, not in the card: answering refreshes the status, which removes the card.
  const [acknowledged, setAcknowledged] = useState<string | null>(null);
  const [reworking, setReworking] = useState(false);

  const done = progress.milestoneIndex >= plan.milestones.length;
  const milestone = plan.milestones[progress.milestoneIndex];
  const last = progress.lastReport;

  async function start() {
    setStarting(true);
    setError(null);
    try {
      const res = await fetch("/api/session/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ goalId }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? `Request failed (${res.status})`);
      const info = data as StartSessionResponse;
      const chat = new Chat<SessionMessage>({
        id: info.id,
        messages: info.messages as SessionMessage[],
        transport: new DefaultChatTransport({ api: "/api/session" }),
      });
      // A new session opens with the tutor; a resumed one carries on as it was.
      // Sent here, from the click, never from a mount effect.
      if (info.messages.length === 0) chat.sendMessage({ text: "I'm ready to start." });
      setSession({ chat, info });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setStarting(false);
    }
  }

  // A plan rework in progress or waiting for a decision takes over the panel.
  if (progress.replan?.status === "running") {
    return (
      <section className="rounded-xl border border-dashed border-foreground/20 p-5 text-sm text-foreground/70">
        Reworking your plan. Your coach, planner and reviewer are going over it together; this takes a minute or two…
      </section>
    );
  }
  if (progress.replan?.status === "proposed") {
    return (
      <ProposalView huddleId={progress.replan.huddleId} proposal={progress.replan.proposal} current={plan} onDecided={onSessionEnd} />
    );
  }
  if (reworking) {
    return (
      <ReplanForm
        goalId={goalId}
        plan={plan}
        onStarted={() => {
          setReworking(false);
          onSessionEnd();
        }}
        onCancel={() => setReworking(false)}
      />
    );
  }

  if (session) {
    return (
      <SessionChat
        chat={session.chat}
        info={session.info}
        onClose={() => {
          setSession(null);
          onSessionEnd();
        }}
      />
    );
  }

  return (
    <>
    {progress.checkIn && (
      <CheckInCard
        checkIn={progress.checkIn}
        onAnswered={(choice) => {
          if (choice === REWORK_OPTION) setReworking(true);
          else setAcknowledged(choice);
          onSessionEnd();
        }}
      />
    )}
    {!progress.checkIn && acknowledged && (
      <p className="rounded-xl border border-foreground/15 p-4 text-sm text-foreground/70">
        Got it: &ldquo;{acknowledged}&rdquo;. Your plan will work with that.
      </p>
    )}
    <section className="rounded-xl border border-foreground/20 p-5">
      {done ? (
        <FinishedPath goalId={goalId} />
      ) : (
        <>
          <div className="text-xs uppercase tracking-wide text-foreground/50">
            Milestone {progress.milestoneIndex + 1} of {plan.milestones.length}
          </div>
          <h2 className="mt-1 text-lg font-medium">{milestone!.title}</h2>
          {last && (
            <div className="mt-3 rounded-lg bg-foreground/5 p-3 text-sm">
              <div className="text-foreground/50">Last session</div>
              <p className="mt-0.5">{last.recap}</p>
              {last.homework && (
                <p className="mt-2">
                  <span className="text-foreground/50">Homework ({last.homework.minutes} min): </span>
                  {last.homework.task}
                </p>
              )}
            </div>
          )}
          <button
            onClick={start}
            disabled={starting}
            className="mt-4 rounded-lg bg-foreground px-4 py-2 text-sm text-background disabled:opacity-50"
          >
            {starting
              ? "Starting…"
              : progress.activeSessionId
                ? "Resume your session"
                : progress.sessionsDone === 0
                  ? `Start your first session · ${plan.sessionMinutes} min`
                  : `Start session ${progress.sessionsDone + 1} · ${plan.sessionMinutes} min`}
          </button>
          {error && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>}
          <button onClick={() => setReworking(true)} className="ml-4 text-sm text-foreground/60 underline">
            Life changed? Rework my plan
          </button>
        </>
      )}
    </section>
    </>
  );
}

/** A check-in from the coach, with the options the learner can tap. */
function CheckInCard({
  checkIn,
  onAnswered,
}: {
  checkIn: NonNullable<PlanProgress["checkIn"]>;
  onAnswered: (choice: string | null) => void;
}) {
  const [sending, setSending] = useState(false);

  async function answer(choice: string | null) {
    setSending(true);
    try {
      await fetch("/api/coach/respond", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ noteId: checkIn.id, choice }),
      });
      onAnswered(choice);
    } finally {
      setSending(false);
    }
  }

  return (
    <section className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
      <div className="text-xs uppercase tracking-wide text-foreground/50">From your coach</div>
      <p className="mt-1 whitespace-pre-wrap leading-relaxed">{checkIn.message}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {checkIn.options.map((o) => (
          <button
            key={o}
            onClick={() => answer(o)}
            disabled={sending}
            className="rounded-full border border-foreground/20 bg-background px-3 py-1.5 text-left text-sm hover:border-foreground/50 disabled:opacity-50"
          >
            {o}
          </button>
        ))}
        <button onClick={() => answer(null)} disabled={sending} className="px-2 text-sm text-foreground/50 underline">
          Not now
        </button>
      </div>
    </section>
  );
}

function SessionChat({
  chat,
  info,
  onClose,
}: {
  chat: Chat<SessionMessage>;
  info: StartSessionResponse;
  onClose: () => void;
}) {
  const { messages, sendMessage, status, error } = useChat<SessionMessage>({ chat });
  const [input, setInput] = useState("");
  const [sidekickOpen, setSidekickOpen] = useState(false);
  const [asked, setAsked] = useState<string[]>([]);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const busy = status === "submitted" || status === "streaming";
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // The lesson holds its place while a side question is open.
    if (!sidekickOpen) bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, status, sidekickOpen]);

  const ended = messages.some((m) =>
    m.parts.some((p) => p.type === "tool-end_session" && p.state === "output-available"),
  );
  // The UI message type doesn't carry tool input types; this is endSessionSchema's homework.
  const homework = (
    messages.flatMap((m) => m.parts).find((p) => p.type === "tool-end_session" && p.state === "output-available") as
      | { input?: { homework?: { task: string; minutes: number } | null } }
      | undefined
  )?.input?.homework;

  function send() {
    const text = input.trim();
    if (!text || busy) return;
    sendMessage({ text });
    setInput("");
  }

  return (
    <section className="flex flex-col gap-4 rounded-xl border border-foreground/20 p-4">
      <div className="text-xs uppercase tracking-wide text-foreground/50">
        Session {info.sessionNumber} · {info.milestoneTitle}
      </div>
      {messages.map((m) => (
        <div key={m.id} className={m.role === "user" ? "max-w-[85%] self-end" : "max-w-full"}>
          {m.parts.map((part, i) =>
            part.type === "text" && part.text.trim() ? (
              <div
                key={i}
                className={
                  m.role === "user"
                    ? "whitespace-pre-wrap rounded-2xl bg-foreground px-4 py-2 text-background"
                    : "whitespace-pre-wrap leading-relaxed"
                }
              >
                {m.role === "user" ? part.text : <ChatText text={part.text} />}
              </div>
            ) : part.type === "tool-end_session" && part.state !== "output-available" ? (
              <div key={i} className="text-sm text-foreground/50">
                Wrapping up your session…
              </div>
            ) : null,
          )}
          {m.role === "assistant" && m.metadata && <TraceChip trace={m.metadata} />}
        </div>
      ))}
      {status === "submitted" && <div className="text-sm text-foreground/50">Thinking…</div>}
      {error && (
        <div className="rounded-lg border border-red-500/40 bg-red-500/5 p-3 text-sm">
          {error.message || "Something went wrong."}
        </div>
      )}
      {ended ? (
        <div className="rounded-lg bg-foreground/5 p-4 text-sm">
          <div className="font-medium">Session saved</div>
          {homework && (
            <p className="mt-1">
              <span className="text-foreground/50">Homework ({homework.minutes} min): </span>
              {homework.task}
            </p>
          )}
          <button onClick={onClose} className="mt-3 rounded-lg bg-foreground px-4 py-2 text-background">
            Back to your roadmap
          </button>
        </div>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
          className="flex gap-2 rounded-xl border border-foreground/15 bg-background p-2 focus-within:border-foreground/40"
        >
          <textarea
            ref={inputRef}
            value={input}
            rows={1}
            onChange={(e) => setInput(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                send();
              }
            }}
            placeholder="Your answer, your code, or a question…"
            className="field-sizing-content max-h-64 min-h-8 min-w-0 flex-1 resize-none bg-transparent px-1 py-1 font-[inherit] outline-none"
          />
          <button
            type="submit"
            disabled={busy || !input.trim()}
            className="rounded-lg bg-foreground px-4 py-1.5 text-sm text-background disabled:opacity-40"
          >
            Send
          </button>
        </form>
      )}
      {!ended && (
        <div className="-mt-2 flex flex-wrap items-center gap-2 text-sm">
          <button onClick={() => setSidekickOpen(true)} className="text-foreground/60 underline hover:text-foreground">
            Ask a quick question
          </button>
          <span className="text-foreground/40">without leaving your lesson</span>
          {asked.map((term) => (
            <span key={term} className="rounded-full border border-foreground/15 px-2 py-0.5 text-xs text-foreground/60">
              {term}
            </span>
          ))}
        </div>
      )}
      <div ref={bottomRef} />
      {sidekickOpen && (
        <SidekickPanel
          sessionId={info.id}
          onClose={() => {
            setSidekickOpen(false);
            inputRef.current?.focus();
          }}
          onTerm={(term) => setAsked((a) => (a.includes(term) ? a : [...a, term]))}
        />
      )}
    </section>
  );
}

/** Every milestone done: mark the goal complete, or keep going by changing it. */
function FinishedPath({ goalId }: { goalId: string }) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function complete() {
    setSaving(true);
    setError(null);
    try {
      await goalAction(goalId, "complete");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSaving(false);
    }
  }

  return (
    <>
      <h2 className="text-lg font-medium">You finished your path</h2>
      <p className="mt-1 text-foreground/70">
        Every milestone is complete. That&apos;s real, visible progress. What you learned stays in your skills, and it&apos;ll keep
        coming up for review in your other goals.
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          onClick={complete}
          disabled={saving}
          className="rounded-lg bg-foreground px-4 py-2 text-sm text-background disabled:opacity-50"
        >
          {saving ? "Saving…" : "Mark goal complete"}
        </button>
        <Link href={`/app/goals/${goalId}/change`} className="text-sm text-foreground/60 underline">
          Keep going: take this goal further
        </Link>
      </div>
      {error && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>}
    </>
  );
}

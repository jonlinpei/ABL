"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useCallback, useEffect, useRef, useState } from "react";

import type { AssessMessage } from "@/app/api/assess/route";
import type { LearnerStatus } from "@/app/api/learner/status/route";
import type { Gap, Plan } from "@/lib/specialists/schemas";

import { ChatText } from "./chat-text";
import { BASIS_LABEL, LEVEL_LABEL, LevelBar } from "./skill-labels";
import { TraceChip } from "./trace-chip";
import { SessionPanel } from "./tutor-session";
import { isWaiting, THINKING, ThinkingWords } from "./thinking-words";

/**
 * What happens after discovery on a goal (docs/architecture.md, "Agent
 * architecture"): wait for the skills picture, run the short skills check,
 * then show the gap the roadmap will close. A paused or completed goal shows
 * its path without sessions (`readOnly`).
 */
export function SkillsCheck({ goalId, readOnly = false }: { goalId: string; readOnly?: boolean }) {
  const [status, setStatus] = useState<LearnerStatus | { stage: "error"; error: string } | null>(null);
  const [started, setStarted] = useState(false);
  // Bumped to restart polling, e.g. once the skills check is saved.
  const [pollKey, setPollKey] = useState(0);
  // Stable, so the chat's "submitted" effect fires it once, not on every render.
  const restartPolling = useCallback(() => setPollKey((k) => k + 1), []);
  const chat = useChat<AssessMessage>({
    transport: new DefaultChatTransport({ api: "/api/assess", body: { goalId } }),
  });

  const poll = useCallback(async () => {
    try {
      const res = await fetch(`/api/learner/status?goalId=${encodeURIComponent(goalId)}`);
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? `Request failed (${res.status})`);
      setStatus(data as LearnerStatus);
      return data as LearnerStatus;
    } catch (err) {
      setStatus({ stage: "error", error: err instanceof Error ? err.message : String(err) });
      return null;
    }
  }, [goalId]);

  // Poll while the lifecycle builds requirements, profile and gap.
  useEffect(() => {
    let cancelled = false;
    async function loop() {
      while (!cancelled) {
        const s = await poll();
        // Keep polling while the lifecycle is working: building the gap, then
        // the plan, or a rework or an updated goal's plan being prepared.
        const preparing =
          s?.stage === "plan_ready" && (s.progress.replan?.status === "running" || s.progress.update?.status === "building");
        if (!s || (!["building_gap", "no_brief", "planning"].includes(s.stage) && !preparing)) return;
        await new Promise((r) => setTimeout(r, 3000));
      }
    }
    loop();
    return () => {
      cancelled = true;
    };
  }, [poll, pollKey]);

  if (!status || status.stage === "building_gap" || status.stage === "no_brief") {
    return (
      <Panel>
        <ThinkingWords words={THINKING.skillsPicture} className="font-medium" />
        <p className="mt-1 text-sm text-foreground/70">
          Working out what your target role asks for and what you already bring. This takes a minute or two.
        </p>
      </Panel>
    );
  }
  if (status.stage === "error") {
    return (
      <Panel>
        <p className="text-red-600 dark:text-red-400">
          {status.error}{" "}
          <button className="underline" onClick={poll}>
            Try again
          </button>
        </p>
      </Panel>
    );
  }
  if (status.stage === "planning") {
    return (
      <>
        <Panel>
          <ThinkingWords words={THINKING.roadmap} className="font-medium" />
          <p className="mt-1 text-sm text-foreground/70">
            The planner drafts your roadmap from your skills check, and a reviewer checks it against your week and your deadline.
            This takes a minute or two.
          </p>
        </Panel>
        <GapView gap={status.gap} assessed={status.assessed} />
      </>
    );
  }
  if (status.stage === "plan_ready") {
    return (
      <>
        {!readOnly && (
          <UpdateBanner
            progress={status.progress}
            checking={started}
            onStartCheck={() => {
              setStarted(true);
              chat.sendMessage({ text: "I'm ready." });
            }}
          />
        )}
        {!readOnly && started && status.progress.update?.status === "check" && <CheckChat chat={chat} onDone={restartPolling} />}
        {!readOnly && <SessionPanel goalId={goalId} plan={status.plan} progress={status.progress} onSessionEnd={restartPolling} />}
        <PlanView plan={status.plan} gap={status.gap} />
        <details className="rounded-xl border border-foreground/15">
          <summary className="cursor-pointer p-4 text-sm text-foreground/70">Where you stand, skill by skill</summary>
          <div className="px-4 pb-4">
            <GapView gap={status.gap} assessed={status.assessed} embedded />
          </div>
        </details>
      </>
    );
  }

  if (readOnly) {
    return (
      <Panel>
        <p className="text-foreground/70">Resume this goal to take the skills check and get your roadmap.</p>
      </Panel>
    );
  }
  if (!started) {
    return (
      <Panel>
        <h2 className="text-lg font-medium">A quick skills check</h2>
        <p className="mt-1 text-foreground/70">
          Before I build your roadmap, I&apos;d like to check a few skills so we don&apos;t skip
          what you need or repeat what you know. About ten minutes, and there are no wrong answers.
        </p>
        <ul className="mt-3 flex flex-wrap gap-2">
          {status.skills.map((s) => (
            <li key={s.skillId} className="rounded-full border border-foreground/15 px-3 py-1 text-sm">
              {s.name}
            </li>
          ))}
        </ul>
        <button
          onClick={() => {
            setStarted(true);
            // Sent from the click, not an effect: React's development double
            // mount cancels a request sent while mounting.
            chat.sendMessage({ text: "I'm ready." });
          }}
          className="mt-4 rounded-lg bg-foreground px-4 py-2 text-sm text-background"
        >
          Start the skills check
        </button>
      </Panel>
    );
  }
  return <CheckChat chat={chat} onDone={restartPolling} />;
}

/**
 * An updated version of the goal being prepared next to the current plan,
 * which stays usable: its skills picture and plan being built, or a short
 * skills check it needs first.
 */
function UpdateBanner({
  progress,
  checking,
  onStartCheck,
}: {
  progress: Extract<LearnerStatus, { stage: "plan_ready" }>["progress"];
  checking: boolean;
  onStartCheck: () => void;
}) {
  const building = progress.update?.status === "building" || (progress.replan?.status === "running" && progress.replan.kind === "update");
  if (building) {
    return (
      <div className="rounded-xl border border-dashed border-sky-500/40 bg-sky-500/5 p-4 text-sm text-foreground/80">
        <ThinkingWords words={THINKING.update} className="font-medium" />
        <p className="mt-1">
          When it&apos;s ready you&apos;ll see it next to this one to compare. Until then, keep going with your current plan.
        </p>
      </div>
    );
  }
  if (progress.update?.status !== "check" || checking) return null;
  return (
    <section className="rounded-xl border border-sky-500/40 bg-sky-500/5 p-4">
      <h2 className="font-medium">A quick skills check for your updated goal</h2>
      <p className="mt-1 text-sm text-foreground/70">
        Your updated goal needs a few skills your current plan doesn&apos;t cover yet. A short check lets me build its plan around what you
        already know. Your current plan stays as it is until you choose.
      </p>
      <ul className="mt-2 flex flex-wrap gap-2">
        {progress.update.skills.map((s) => (
          <li key={s.skillId} className="rounded-full border border-foreground/15 bg-background px-3 py-1 text-sm">
            {s.name}
          </li>
        ))}
      </ul>
      <button onClick={onStartCheck} className="mt-3 rounded-lg bg-foreground px-4 py-2 text-sm text-background">
        Start the skills check
      </button>
    </section>
  );
}

function CheckChat({
  chat: { messages, sendMessage, status, error },
  onDone,
}: {
  chat: ReturnType<typeof useChat<AssessMessage>>;
  onDone: () => void;
}) {
  const [input, setInput] = useState("");
  const busy = status === "submitted" || status === "streaming";
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, status]);

  const submitted = messages.some((m) =>
    m.parts.some(
      (p) =>
        p.type === "tool-submit_assessment" &&
        p.state === "output-available" &&
        (p.output as { status?: string }).status !== "incomplete",
    ),
  );
  useEffect(() => {
    if (submitted) onDone();
  }, [submitted, onDone]);

  function send() {
    const text = input.trim();
    if (!text || busy) return;
    sendMessage({ text });
    setInput("");
  }

  return (
    <section className="flex flex-col gap-4 rounded-xl border border-foreground/15 p-4">
      <div className="text-xs uppercase tracking-wide text-foreground/50">Skills check</div>
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
            ) : part.type === "tool-submit_assessment" && part.state !== "output-available" && !submitted ? (
              <div key={i} className="text-sm text-foreground/50">
                Saving your results…
              </div>
            ) : null,
          )}
          {m.role === "assistant" && m.metadata && <TraceChip trace={m.metadata} />}
        </div>
      ))}
      {isWaiting(status, messages) && <ThinkingWords words={THINKING.skillsCheck} className="text-sm" />}
      {error && (
        <div className="rounded-lg border border-red-500/40 bg-red-500/5 p-3 text-sm">
          {error.message || "Something went wrong."}
        </div>
      )}
      {!submitted && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
          className="flex gap-2 rounded-xl border border-foreground/15 bg-background p-2 focus-within:border-foreground/40"
        >
          <textarea
            value={input}
            rows={1}
            onChange={(e) => setInput(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                send();
              }
            }}
            placeholder="Your answer, or &quot;I haven't done that&quot;…"
            className="field-sizing-content max-h-48 min-h-8 min-w-0 flex-1 resize-none bg-transparent px-1 py-1 outline-none"
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
      <div ref={bottomRef} />
    </section>
  );
}

function GapView({ gap, assessed, embedded = false }: { gap: Gap; assessed: boolean; embedded?: boolean }) {
  const Wrapper = embedded ? "div" : Panel;
  return (
    <Wrapper>
      {!embedded && <h2 className="text-lg font-medium">Where you stand</h2>}
      <p className="mt-1 text-sm text-foreground/60">
        {gap.counts.met} of {gap.items.length} skills already at the level your target role needs ·{" "}
        {gap.counts.partial} partly there · {gap.counts.missing} to learn
        {assessed ? " · includes your skills check" : ""}
      </p>
      <ul className="mt-4 flex flex-col gap-2.5">
        {gap.items.map((item) => (
          <li key={item.skillId} className="grid gap-1 text-sm sm:grid-cols-[1fr_12rem] sm:items-center sm:gap-4">
            <div>
              <span className={item.status === "met" ? "text-foreground/60" : "font-medium"}>{item.name}</span>
              {item.importance === "must" && item.status !== "met" && (
                <span className="ml-2 inline-block whitespace-nowrap rounded bg-sky-500/15 px-1.5 py-0.5 text-xs text-sky-700 dark:text-sky-300">
                  must-have
                </span>
              )}
              <span className="block text-xs text-foreground/50">
                {LEVEL_LABEL[item.current]} now ({BASIS_LABEL[item.basis]}) · needs {LEVEL_LABEL[item.required]}
              </span>
            </div>
            <LevelBar current={item.current} required={item.required} />
          </li>
        ))}
      </ul>
      {gap.proofOfSkill.length > 0 && (
        <div className="mt-4 text-sm text-foreground/70">
          <div className="text-foreground/50">Employers will want to see</div>
          <ul className="mt-1 list-disc pl-5">
            {gap.proofOfSkill.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </div>
      )}
    </Wrapper>
  );
}

function PlanView({ plan, gap }: { plan: Plan; gap: Gap }) {
  const names = new Map(gap.items.map((i) => [i.skillId, i.name]));
  const weeks = plan.milestones.reduce((n, m) => n + m.weeks, 0);
  return (
    <section className="rounded-xl border border-foreground/20 p-5">
      <div className="text-xs uppercase tracking-wide text-foreground/50">Your roadmap</div>
      <h2 className="mt-1 text-xl font-semibold">{plan.title}</h2>
      <p className="mt-2 text-foreground/80">{plan.summary}</p>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm text-foreground/60">
        <span>About {weeks} weeks</span>
        <span>{plan.weeklyHours} h/week</span>
        <span>{plan.sessionMinutes}-min sessions</span>
        <span>{plan.milestones.length} milestones</span>
      </div>
      <p className="mt-2 text-sm text-foreground/70">{plan.deadlineFit}</p>

      <div className="mt-5 rounded-lg bg-foreground/5 p-4">
        <div className="text-xs uppercase tracking-wide text-foreground/50">Your first session</div>
        <div className="mt-1 font-medium">
          {plan.firstSession.title} · {plan.firstSession.minutes} min
        </div>
        <p className="mt-1 text-sm">{plan.firstSession.whatYouWillDo}</p>
        <p className="mt-1 text-sm text-foreground/60">You&apos;ll come away with: {plan.firstSession.outcome}</p>
      </div>

      <ol className="mt-5 flex flex-col gap-5">
        {plan.milestones.map((m, i) => (
          <li key={i} className="border-l-2 border-foreground/15 pl-4">
            <div className="font-medium">
              {i + 1}. {m.title} <span className="text-sm font-normal text-foreground/50">· {m.weeks} wk</span>
            </div>
            <div className="text-sm text-foreground/70">{m.whyItMatters}</div>
            {m.skills.length > 0 && (
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {m.skills.map((s) => (
                  <span key={s.skillId} className="rounded-full border border-foreground/15 px-2 py-0.5 text-xs text-foreground/70">
                    {names.get(s.skillId) ?? s.skillId} → {LEVEL_LABEL[s.toLevel] ?? s.toLevel}
                  </span>
                ))}
              </div>
            )}
            {m.project && (
              <div className="mt-1.5 text-sm">
                <span className="text-foreground/50">You&apos;ll build: </span>
                {m.project}
                {(m.projectShows ?? []).length > 0 && (
                  <span className="text-foreground/50">
                    {" "}
                    (shows {(m.projectShows ?? []).map((id) => names.get(id) ?? id).join(", ")})
                  </span>
                )}
              </div>
            )}
            <div className="mt-1 text-sm">
              <span className="text-foreground/50">Win: </span>
              {m.visibleWin}
            </div>
          </li>
        ))}
      </ol>

      {plan.notCovered.length > 0 && (
        <div className="mt-5 text-sm">
          <div className="text-foreground/50">Left out for now</div>
          <ul className="mt-1 list-disc pl-5 text-foreground/70">
            {plan.notCovered.map((n) => (
              <li key={n.skillId}>
                {names.get(n.skillId) ?? n.skillId}: {n.reason}
              </li>
            ))}
          </ul>
        </div>
      )}
      {plan.assumptions.length > 0 && (
        <div className="mt-3 text-sm">
          <div className="text-foreground/50">Assumptions to check</div>
          <ul className="mt-1 list-disc pl-5 text-foreground/70">
            {plan.assumptions.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function Panel({ children }: { children: React.ReactNode }) {
  return <section className="rounded-xl border border-foreground/15 p-4">{children}</section>;
}

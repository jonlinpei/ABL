"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useCallback, useEffect, useRef, useState } from "react";

import type { AssessMessage } from "@/app/api/assess/route";
import type { LearnerStatus } from "@/app/api/learner/status/route";
import type { Gap } from "@/lib/specialists/schemas";

import { TraceChip } from "./trace-chip";

const LEVEL_LABEL = ["None", "Aware", "With help", "Independent", "Can lead"];

const BASIS_LABEL: Record<Gap["items"][number]["basis"], string> = {
  assessed: "checked",
  work_history: "from your work history",
  self_reported: "you said",
  inferred: "estimate",
};

/**
 * What happens after discovery (docs/architecture.md, "Agent architecture"):
 * wait for the skills picture, run the short skills check, then show the gap
 * the roadmap will close.
 */
export function SkillsCheck() {
  const [status, setStatus] = useState<LearnerStatus | { stage: "error"; error: string } | null>(null);
  const [started, setStarted] = useState(false);

  const poll = useCallback(async () => {
    try {
      const res = await fetch("/api/learner/status");
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? `Request failed (${res.status})`);
      setStatus(data as LearnerStatus);
      return data as LearnerStatus;
    } catch (err) {
      setStatus({ stage: "error", error: err instanceof Error ? err.message : String(err) });
      return null;
    }
  }, []);

  // Poll while the lifecycle builds requirements, profile and gap.
  useEffect(() => {
    let cancelled = false;
    async function loop() {
      while (!cancelled) {
        const s = await poll();
        if (!s || (s.stage !== "building_gap" && s.stage !== "no_brief")) return;
        await new Promise((r) => setTimeout(r, 3000));
      }
    }
    loop();
    return () => {
      cancelled = true;
    };
  }, [poll]);

  if (!status || status.stage === "building_gap" || status.stage === "no_brief") {
    return (
      <Panel>
        <p className="text-foreground/70">
          Working out what your target role asks for and what you already bring. This takes about a
          minute…
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
  if (status.stage === "gap_ready") return <GapView gap={status.gap} assessed={status.assessed} />;

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
          onClick={() => setStarted(true)}
          className="mt-4 rounded-lg bg-foreground px-4 py-2 text-sm text-background"
        >
          Start the skills check
        </button>
      </Panel>
    );
  }
  return <CheckChat onDone={poll} />;
}

function CheckChat({ onDone }: { onDone: () => void }) {
  const [input, setInput] = useState("");
  const { messages, sendMessage, status, error } = useChat<AssessMessage>({
    transport: new DefaultChatTransport({ api: "/api/assess" }),
  });
  const busy = status === "submitted" || status === "streaming";
  const opened = useRef(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (opened.current) return;
    opened.current = true;
    sendMessage({ text: "I'm ready." });
  }, [sendMessage]);

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
                {part.text}
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
      {status === "submitted" && <div className="text-sm text-foreground/50">Thinking…</div>}
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

function GapView({ gap, assessed }: { gap: Gap; assessed: boolean }) {
  return (
    <Panel>
      <h2 className="text-lg font-medium">Where you stand</h2>
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
      <p className="mt-4 text-sm text-foreground/60">
        Your roadmap is built from this next. That step isn&apos;t in this demo yet.
      </p>
    </Panel>
  );
}

/** Four segments: filled to the current level, outlined up to the required level. */
function LevelBar({ current, required }: { current: number; required: number }) {
  return (
    <div className="flex gap-1" aria-label={`Level ${current} of ${required} needed`}>
      {[1, 2, 3, 4].map((n) => (
        <span
          key={n}
          className={`h-2 flex-1 rounded-sm ${
            n <= current
              ? "bg-foreground/70"
              : n <= required
                ? "border border-foreground/40"
                : "bg-foreground/5"
          }`}
        />
      ))}
    </div>
  );
}

function Panel({ children }: { children: React.ReactNode }) {
  return <section className="rounded-xl border border-foreground/15 p-4">{children}</section>;
}

"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type FileUIPart } from "ai";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import type { SaveBriefResponse } from "@/app/api/briefs/route";
import type { DiscoveryMessage } from "@/app/api/discover/route";
import type { CallTrace } from "@/lib/ai/trace";
import { attachedBytes, attachmentProblem } from "@/lib/goals/attachments";

import { BriefCard } from "./brief-card";
import { ChatText } from "./chat-text";
import { TraceChip } from "./trace-chip";
import { GoalBriefSchema, type GoalBrief } from "@/lib/goals/schema";

/** Starting points to click. They only show the range of career moves. */
const EXAMPLE_MOVES = [
  "I'm a teacher and want to move into instructional design",
  "I want to switch from marketing ops into data analytics",
  "I'm a nurse and curious about working in health tech",
  "I'm moving from Mexico City to Toronto and want to keep working in sales",
];

type Mode = "resume" | "linkedin" | "talk" | null;

/**
 * Demo of the first learner-facing flow (docs/content.md, "Goal discovery"):
 * a discovery conversation, often starting from a resume or LinkedIn profile,
 * that ends in a career brief the learner confirms. With a `goalId` it
 * changes that goal instead of starting a new one. Every AI call shows what
 * the router chose and what it cost.
 */
export function GoalDiscoveryDemo({ goalId, currentTitle }: { goalId?: string; currentTitle?: string } = {}) {
  const router = useRouter();
  const [input, setInput] = useState("");
  const [mode, setMode] = useState<Mode>(null);
  const [pending, setPending] = useState<{ part: FileUIPart; size: number }[]>([]);
  const [attachError, setAttachError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState<GoalBrief | null>(null);
  const [save, setSave] = useState<{ state: "saving" } | { state: "saved" } | { state: "failed"; error: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);

  const { messages, sendMessage, status, error, clearError, setMessages } =
    useChat<DiscoveryMessage>({
      transport: new DefaultChatTransport({ api: "/api/discover", body: goalId ? { goalId } : undefined }),
    });

  const busy = status === "submitted" || status === "streaming";
  const bottomRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, status, confirmed]);

  const latestBriefId = findLatestBriefPartId(messages);
  const traces = collectTraces(messages);

  function send(text: string) {
    const trimmed = text.trim();
    if ((!trimmed && pending.length === 0) || busy) return;
    clearError();
    sendMessage({
      text: trimmed || "Here's my background.",
      files: pending.map((p) => p.part),
    });
    setInput("");
    setPending([]);
    setAttachError(null);
  }

  async function attach(files: FileList | null) {
    const file = files?.[0];
    if (fileRef.current) fileRef.current.value = "";
    if (!file) return;
    const already = attachedBytes(messages) + pending.reduce((n, p) => n + p.size, 0);
    const problem = attachmentProblem(file, already);
    setAttachError(problem);
    if (problem) return;
    const url = await readAsDataUrl(file);
    setPending((p) => [
      ...p,
      { part: { type: "file", mediaType: file.type, filename: file.name, url }, size: file.size },
    ]);
    textRef.current?.focus();
  }

  function choose(next: Mode) {
    setMode(next);
    if (next === "resume") fileRef.current?.click();
    else textRef.current?.focus();
  }

  async function confirm(brief: GoalBrief) {
    setConfirmed(brief);
    setSave({ state: "saving" });
    try {
      const res = await fetch("/api/briefs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brief, goalId }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? `Request failed (${res.status})`);
      setSave({ state: "saved" });
      // The goal's page picks up from here: the skills picture, then the plan.
      router.push(`/app/goals/${(data as SaveBriefResponse).goalId}`);
    } catch (err) {
      setSave({ state: "failed", error: err instanceof Error ? err.message : String(err) });
    }
  }

  function startOver() {
    setMessages([]);
    setConfirmed(null);
    setSave(null);
    setPending([]);
    setMode(null);
    setAttachError(null);
    clearError();
  }

  const placeholder =
    goalId && messages.length === 0
      ? "e.g. I got a new job and can only do 3 hours a week now"
      : messages.length > 0
        ? latestBriefId
          ? "Tell me what to change…"
          : "Type your answer…"
        : mode === "linkedin"
          ? "Paste your LinkedIn profile text here…"
          : mode === "resume"
            ? "Anything to add? Where do you want to go next?"
            : "e.g. I've been a high school science teacher for 8 years and want to get into UX research";

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-8 sm:px-6">
      {messages.length === 0 && goalId && (
        <section>
          <h1 className="text-2xl font-semibold tracking-tight">What&apos;s changed?</h1>
          <p className="mt-2 text-foreground/70">
            Tell me what&apos;s different about {currentTitle ? <span className="font-medium">{currentTitle}</span> : "this goal"}: where
            you&apos;re aiming, your week, your deadline, or where you&apos;re starting from. I&apos;ll update your brief, and you&apos;ll
            get a plan built for it. Your skills and progress carry over.
          </p>
        </section>
      )}

      {messages.length === 0 && !goalId && (
        <section>
          <h1 className="text-2xl font-semibold tracking-tight">
            Where are you now, and where do you want to go?
          </h1>
          <p className="mt-2 text-foreground/70">
            ABL builds a learning plan for your next career move. Start with where you are today.
            Choose whichever is easiest.
          </p>
          <div className="mt-6 grid gap-3 sm:grid-cols-3">
            <StartOption
              title="Upload your resume"
              detail="A PDF, up to 3 MB"
              selected={mode === "resume"}
              onClick={() => choose("resume")}
            />
            <StartOption
              title="Share your LinkedIn"
              detail="Paste your profile, or attach its PDF"
              selected={mode === "linkedin"}
              onClick={() => choose("linkedin")}
            />
            <StartOption
              title="Just tell me"
              detail="Describe your work in your own words"
              selected={mode === "talk"}
              onClick={() => choose("talk")}
            />
          </div>
          {mode === "linkedin" && (
            <p className="mt-3 text-sm text-foreground/60">
              On your LinkedIn profile, choose <span className="font-medium">More → Save to PDF</span>{" "}
              and attach the file, or copy your About and Experience sections and paste them below.
            </p>
          )}
          {mode === null && (
            <div className="mt-6 flex flex-wrap gap-2">
              {EXAMPLE_MOVES.map((move) => (
                <button
                  key={move}
                  onClick={() => send(move)}
                  disabled={busy}
                  className="rounded-full border border-foreground/15 px-3 py-1.5 text-left text-sm text-foreground/70 transition hover:border-foreground/40 hover:text-foreground disabled:opacity-50"
                >
                  {move}
                </button>
              ))}
            </div>
          )}
        </section>
      )}

      {messages.length > 0 && (
        <section className="flex flex-col gap-4">
          {messages.map((m) => (
            <div
              key={m.id}
              className={m.role === "user" ? "flex max-w-[85%] flex-col items-end gap-2 self-end" : "max-w-full"}
            >
              {m.parts.map((part, i) => {
                if (part.type === "file") {
                  return <FileChip key={i} name={part.filename ?? "Attachment"} />;
                }
                if (part.type === "text" && part.text.trim()) {
                  return (
                    <div
                      key={i}
                      className={
                        m.role === "user"
                          ? "max-h-72 overflow-y-auto whitespace-pre-wrap rounded-2xl bg-foreground px-4 py-2 text-background"
                          : "whitespace-pre-wrap leading-relaxed"
                      }
                    >
                      {m.role === "user" ? part.text : <ChatText text={part.text} />}
                    </div>
                  );
                }
                if (part.type === "tool-propose_goal_brief") {
                  if (part.state === "output-error") return null;
                  if (part.state !== "input-available" && part.state !== "output-available") {
                    return (
                      <div key={i} className="text-sm text-foreground/50">
                        Writing up your career brief…
                      </div>
                    );
                  }
                  const brief = GoalBriefSchema.safeParse(part.input);
                  if (!brief.success) return null;
                  const isLatest = `${m.id}:${i}` === latestBriefId;
                  return (
                    <BriefCard
                      key={i}
                      brief={brief.data}
                      active={isLatest && !confirmed && !busy}
                      confirmed={isLatest && !!confirmed}
                      onConfirm={() => confirm(brief.data)}
                    />
                  );
                }
                return null;
              })}
              {m.role === "assistant" && m.metadata && <TraceChip trace={m.metadata} />}
            </div>
          ))}
          {status === "submitted" && <div className="text-sm text-foreground/50">Thinking…</div>}
          {error && (
            <div className="rounded-lg border border-red-500/40 bg-red-500/5 p-3 text-sm">
              {error.message || "Something went wrong."}
            </div>
          )}
        </section>
      )}

      {confirmed && (
        <div className="rounded-lg border border-dashed border-foreground/20 p-4 text-sm text-foreground/70">
          {save?.state === "saving" && <p>Saving your brief…</p>}
          {save?.state === "saved" && <p>Saved. Taking you to your goal…</p>}
          {save?.state === "failed" && (
            <p className="text-red-600 dark:text-red-400">
              {save.error}{" "}
              <button className="underline" onClick={() => confirm(confirmed)}>
                Try again
              </button>
            </p>
          )}
          <p className="mt-2">
            <button className="underline" onClick={startOver}>
              Start over
            </button>
          </p>
        </div>
      )}

      {!confirmed && (
        <div className="sticky bottom-4 flex flex-col gap-2">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              send(input);
            }}
            className="flex flex-col gap-2 rounded-xl border border-foreground/15 bg-background p-2 shadow-sm focus-within:border-foreground/40 focus-within:ring-2 focus-within:ring-foreground/20"
          >
            {pending.length > 0 && (
              <div className="flex flex-wrap gap-2 px-1 pt-1">
                {pending.map((p, i) => (
                  <FileChip
                    key={i}
                    name={p.part.filename ?? "Attachment"}
                    onRemove={() => setPending((all) => all.filter((_, j) => j !== i))}
                  />
                ))}
              </div>
            )}
            <div className="flex items-end gap-2">
              <input
                ref={fileRef}
                type="file"
                accept="application/pdf"
                className="hidden"
                onChange={(e) => attach(e.currentTarget.files)}
              />
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={busy}
                aria-label="Attach a PDF resume or LinkedIn profile"
                title="Attach a PDF resume or LinkedIn profile"
                className="rounded-lg p-1.5 text-foreground/50 transition hover:bg-foreground/5 hover:text-foreground disabled:opacity-40"
              >
                <PaperclipIcon />
              </button>
              <textarea
                ref={textRef}
                value={input}
                rows={1}
                onChange={(e) => setInput(e.currentTarget.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    send(input);
                  }
                }}
                placeholder={placeholder}
                className="field-sizing-content max-h-48 min-h-8 min-w-0 flex-1 resize-none bg-transparent px-1 py-1 outline-none"
                autoFocus
              />
              <button
                type="submit"
                disabled={busy || (!input.trim() && pending.length === 0)}
                className="rounded-lg bg-foreground px-4 py-1.5 text-sm text-background disabled:opacity-40"
              >
                Send
              </button>
            </div>
          </form>
          {attachError && <p className="px-1 text-sm text-red-600 dark:text-red-400">{attachError}</p>}
          {(pending.length > 0 || mode === "resume" || mode === "linkedin") && (
            <p className="px-1 text-xs text-foreground/50">
              Your file goes to our AI provider to read during this conversation. ABL doesn&apos;t
              store it. You can remove your phone number or address first if you&apos;d like.
            </p>
          )}
        </div>
      )}

      {traces.length > 0 && <TracePanel traces={traces} onStartOver={startOver} />}
      <div ref={bottomRef} />
    </div>
  );
}

function StartOption({
  title,
  detail,
  selected,
  onClick,
}: {
  title: string;
  detail: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={selected}
      className={`rounded-lg border p-4 text-left transition hover:border-foreground/40 ${
        selected ? "border-foreground/60 bg-foreground/5" : "border-foreground/15"
      }`}
    >
      <div className="font-medium">{title}</div>
      <div className="mt-1 text-sm text-foreground/60">{detail}</div>
    </button>
  );
}

function FileChip({ name, onRemove }: { name: string; onRemove?: () => void }) {
  return (
    <span className="inline-flex max-w-full items-center gap-1.5 rounded-lg border border-foreground/15 bg-background px-2.5 py-1 text-sm text-foreground/80">
      <DocumentIcon />
      <span className="truncate">{name}</span>
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove ${name}`}
          className="ml-1 text-foreground/40 hover:text-foreground"
        >
          ×
        </button>
      )}
    </span>
  );
}

function PaperclipIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" />
    </svg>
  );
}

function DocumentIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
    </svg>
  );
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}


function TracePanel({ traces, onStartOver }: { traces: CallTrace[]; onStartOver: () => void }) {
  const total = traces.reduce((sum, t) => sum + (t.costUsd ?? 0), 0);
  return (
    <details className="rounded-lg border border-foreground/10 p-3 text-sm">
      <summary className="cursor-pointer text-foreground/60">
        Router trace: {traces.length} AI call{traces.length === 1 ? "" : "s"} · ${total.toFixed(4)}
      </summary>
      <table className="mt-3 w-full font-mono text-[11px]">
        <thead className="text-left text-foreground/50">
          <tr>
            <th className="pr-3 font-normal">task</th>
            <th className="pr-3 font-normal">model</th>
            <th className="pr-3 font-normal">tier</th>
            <th className="pr-3 font-normal">tokens in/out</th>
            <th className="pr-3 font-normal">cost</th>
            <th className="font-normal">time</th>
          </tr>
        </thead>
        <tbody>
          {traces.map((t, i) => (
            <tr key={i}>
              <td className="pr-3">{t.task}</td>
              <td className="pr-3">
                {t.model}
                {t.failedOver.length > 0 && ` (after ${t.failedOver.join(", ")})`}
              </td>
              <td className="pr-3">{t.tier}</td>
              <td className="pr-3">
                {t.inputTokens ?? "?"}/{t.outputTokens ?? "?"}
              </td>
              <td className="pr-3">{t.costUsd != null ? `$${t.costUsd.toFixed(4)}` : "?"}</td>
              <td>{t.latencyMs != null ? `${(t.latencyMs / 1000).toFixed(1)}s` : "?"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <button onClick={onStartOver} className="mt-3 text-foreground/60 underline">
        Start over
      </button>
    </details>
  );
}


function findLatestBriefPartId(messages: DiscoveryMessage[]): string | null {
  for (let m = messages.length - 1; m >= 0; m--) {
    const parts = messages[m]!.parts;
    for (let i = parts.length - 1; i >= 0; i--) {
      if (parts[i]!.type === "tool-propose_goal_brief") return `${messages[m]!.id}:${i}`;
    }
  }
  return null;
}

function collectTraces(messages: DiscoveryMessage[]): CallTrace[] {
  return messages
    .filter((m) => m.role === "assistant" && m.metadata?.latencyMs != null)
    .map((m) => m.metadata!);
}

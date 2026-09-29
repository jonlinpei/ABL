"use client";

import { Chat, useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import posthog from "posthog-js";
import { useEffect, useRef, useState } from "react";

import type { SidekickMessage } from "@/app/api/sidekick/route";

import { ChatText } from "./chat-text";

/**
 * A sidekick (PRD F3): a quick side question in a panel over the lesson. The
 * lesson stays where it was underneath; going back closes the panel and hands
 * a summary to the tutor.
 */
export function SidekickPanel({
  sessionId,
  onClose,
  onTerm,
}: {
  sessionId: string;
  onClose: () => void;
  /** The term the sidekick explained, once it's summarized (after the panel has closed). */
  onTerm: (term: string) => void;
}) {
  const [chat] = useState(
    () =>
      new Chat<SidekickMessage>({
        id: crypto.randomUUID(),
        transport: new DefaultChatTransport({ api: "/api/sidekick", body: { sessionId } }),
      }),
  );
  const { messages, sendMessage, status, error } = useChat<SidekickMessage>({ chat });
  const [input, setInput] = useState("");
  const busy = status === "submitted" || status === "streaming";
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const closing = useRef(false);

  useEffect(() => {
    inputRef.current?.focus();
    posthog.capture("sidekick_opened", { session_id: sessionId });
  }, [sessionId]);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, status]);

  async function close() {
    if (closing.current) return;
    closing.current = true;
    const asked = messages.filter((m) => m.role === "user").length;
    posthog.capture("sidekick_closed", { session_id: sessionId, questions: asked, returned_to_lesson: true });
    // The learner goes straight back; the summary for the tutor happens in the background.
    onClose();
    if (asked === 0) return;
    try {
      const res = await fetch("/api/sidekick/close", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: chat.id }),
      });
      const data = await res.json().catch(() => null);
      if (data?.term) onTerm(data.term);
    } catch {
      // The tutor still sees the question itself.
    }
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  function send() {
    const text = input.trim();
    if (!text || busy) return;
    sendMessage({ text });
    setInput("");
  }

  return (
    <aside
      aria-label="Quick question"
      className="fixed inset-0 z-40 flex flex-col bg-background sm:inset-y-0 sm:left-auto sm:right-0 sm:w-[26rem] sm:border-l sm:border-foreground/15 sm:shadow-2xl"
    >
      <div className="flex items-center justify-between border-b border-foreground/10 px-4 py-3">
        <div>
          <div className="font-medium">Quick question</div>
          <div className="text-xs text-foreground/50">Your lesson is paused right where you left it.</div>
        </div>
        <button onClick={close} className="rounded-lg border border-foreground/20 px-3 py-1.5 text-sm hover:border-foreground/50">
          Back to the lesson
        </button>
      </div>
      <div className="flex flex-1 flex-col gap-3 overflow-y-auto px-4 py-4">
        {messages.length === 0 && (
          <p className="text-sm text-foreground/60">
            Ask anything: a term you don&apos;t know, the difference between two things, or another way to explain it. It won&apos;t
            interrupt your lesson.
          </p>
        )}
        {messages.map((m) => (
          <div key={m.id} className={m.role === "user" ? "max-w-[85%] self-end" : "max-w-full"}>
            {m.parts.map((part, i) =>
              part.type === "text" && part.text.trim() ? (
                <div
                  key={i}
                  className={
                    m.role === "user"
                      ? "whitespace-pre-wrap rounded-2xl bg-foreground px-3 py-1.5 text-sm text-background"
                      : "whitespace-pre-wrap text-sm leading-relaxed"
                  }
                >
                  {m.role === "user" ? part.text : <ChatText text={part.text} />}
                </div>
              ) : null,
            )}
          </div>
        ))}
        {status === "submitted" && <div className="text-sm text-foreground/50">Thinking…</div>}
        {error && <div className="rounded-lg border border-red-500/40 bg-red-500/5 p-3 text-sm">{errorText(error)}</div>}
        <div ref={bottomRef} />
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
        className="m-3 flex gap-2 rounded-xl border border-foreground/15 bg-background p-2 focus-within:border-foreground/40"
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
          placeholder="e.g. What's a LEFT JOIN?"
          className="field-sizing-content max-h-40 min-h-8 min-w-0 flex-1 resize-none bg-transparent px-1 py-1 text-sm outline-none"
        />
        <button type="submit" disabled={busy || !input.trim()} className="rounded-lg bg-foreground px-3 py-1.5 text-sm text-background disabled:opacity-40">
          Ask
        </button>
      </form>
    </aside>
  );
}

/** Route errors arrive as the JSON body; show just the message. */
function errorText(error: Error): string {
  try {
    return (JSON.parse(error.message) as { error?: string }).error ?? error.message;
  } catch {
    return error.message || "Something went wrong.";
  }
}

"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useEffect, useRef, useState } from "react";

import type { MilestoneCheckMessage } from "@/app/api/milestone-check/route";
import type { PlanProgress } from "@/app/api/learner/status/route";

import { ChatText } from "./chat-text";
import { LEVEL_LABEL } from "./skill-labels";
import { isWaiting, THINKING, ThinkingWords, WorkingLabel } from "./thinking-words";

type Results = NonNullable<PlanProgress["lastCheck"]>["results"];

/**
 * After a milestone (PRD story 12): a short, optional check so the learner
 * can prove to themselves they've improved, then their before and after.
 */
export function MilestoneCheck({
  goalId,
  offer,
  onDone,
}: {
  goalId: string;
  offer: NonNullable<PlanProgress["milestoneCheck"]>;
  onDone: () => void;
}) {
  const [started, setStarted] = useState(false);
  const [skipping, setSkipping] = useState(false);
  const chat = useChat<MilestoneCheckMessage>({
    transport: new DefaultChatTransport({ api: "/api/milestone-check", body: { goalId } }),
  });

  async function skip() {
    setSkipping(true);
    await fetch("/api/milestone-check/skip", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ goalId }),
    }).catch(() => {});
    onDone();
  }

  if (started) return <CheckChat chat={chat} onDone={onDone} />;
  return (
    <section className="rounded-xl border border-emerald-500/40 bg-emerald-500/5 p-5">
      <div className="text-xs uppercase tracking-wide text-foreground/50">Milestone done</div>
      <h2 className="mt-1 text-lg font-medium">{offer.title}</h2>
      <p className="mt-1 text-sm text-foreground/70">
        Want to see how far you&apos;ve come? A five-minute check, one small task per skill, then your before and after. It&apos;s just
        for you, and it doesn&apos;t hold up your next milestone.
      </p>
      <ul className="mt-3 flex flex-wrap gap-2">
        {offer.skills.map((s) => (
          <li key={s.skillId} className="rounded-full border border-foreground/15 bg-background px-3 py-1 text-sm">
            {s.name}
          </li>
        ))}
      </ul>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          onClick={() => {
            setStarted(true);
            // Sent from the click, not an effect, so React's double mount can't cancel it.
            chat.sendMessage({ text: "I'm ready." });
          }}
          className="rounded-lg bg-foreground px-4 py-2 text-sm text-background"
        >
          Prove it to yourself
        </button>
        <button onClick={skip} disabled={skipping} className="text-sm text-foreground/60 underline">
          {skipping ? <WorkingLabel label="Skipping" /> : "Not now"}
        </button>
      </div>
    </section>
  );
}

function CheckChat({ chat: { messages, sendMessage, status, error }, onDone }: { chat: ReturnType<typeof useChat<MilestoneCheckMessage>>; onDone: () => void }) {
  const [input, setInput] = useState("");
  const busy = status === "submitted" || status === "streaming";
  const bottomRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, status]);

  const saved = messages
    .flatMap((m) => m.parts)
    .find((p) => p.type === "tool-submit_assessment" && p.state === "output-available" && (p.output as { status?: string }).status !== "incomplete") as
    | { output: { results: Results } }
    | undefined;

  function send() {
    const text = input.trim();
    if (!text || busy) return;
    sendMessage({ text });
    setInput("");
  }

  return (
    <section className="flex flex-col gap-4 rounded-xl border border-emerald-500/40 p-4">
      <div className="text-xs uppercase tracking-wide text-foreground/50">Milestone check</div>
      {messages.map((m, mi) =>
        mi === 0 && m.role === "user" ? null : (
          <div key={m.id} className={m.role === "user" ? "max-w-[85%] self-end" : "max-w-full"}>
            {m.parts.map((part, i) =>
              part.type === "text" && part.text.trim() ? (
                <div
                  key={i}
                  className={m.role === "user" ? "whitespace-pre-wrap rounded-2xl bg-foreground px-4 py-2 text-background" : "whitespace-pre-wrap leading-relaxed"}
                >
                  {m.role === "user" ? part.text : <ChatText text={part.text} />}
                </div>
              ) : null,
            )}
          </div>
        ),
      )}
      {isWaiting(status, messages) && <ThinkingWords words={THINKING.skillsCheck} className="text-sm" />}
      {error && <div className="rounded-lg border border-red-500/40 bg-red-500/5 p-3 text-sm">{error.message || "Something went wrong."}</div>}
      {saved ? (
        <div>
          <BeforeAndAfter results={saved.output.results} />
          <button onClick={onDone} className="mt-3 rounded-lg bg-foreground px-4 py-2 text-sm text-background">
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
            value={input}
            rows={1}
            onChange={(e) => setInput(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                send();
              }
            }}
            placeholder="Your answer, your work, or a question…"
            className="field-sizing-content max-h-64 min-h-8 min-w-0 flex-1 resize-none bg-transparent px-1 py-1 font-[inherit] outline-none"
          />
          <button type="submit" disabled={busy || !input.trim()} className="rounded-lg bg-foreground px-4 py-1.5 text-sm text-background disabled:opacity-40">
            Send
          </button>
        </form>
      )}
      <div ref={bottomRef} />
    </section>
  );
}

/** Each skill's level before the milestone and what the check showed. */
export function BeforeAndAfter({ results, title }: { results: Results; title?: string }) {
  return (
    <div className="rounded-lg bg-emerald-500/5 p-4">
      <div className="text-xs uppercase tracking-wide text-foreground/50">{title ? `Your check after "${title}"` : "Your before and after"}</div>
      <ul className="mt-2 flex flex-col gap-1.5 text-sm">
        {results.map((r) => (
          <li key={r.skillId} className="flex flex-wrap items-baseline gap-x-2">
            <span className="font-medium">{r.name}</span>
            <span className="text-foreground/60">
              {LEVEL_LABEL[r.before]} → <span className={r.after > r.before ? "font-medium text-emerald-700 dark:text-emerald-300" : ""}>{LEVEL_LABEL[r.after]}</span>
            </span>
            {r.after < r.toLevel && <span className="text-xs text-foreground/50">(aiming for {LEVEL_LABEL[r.toLevel]}: your tutor will build on this)</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

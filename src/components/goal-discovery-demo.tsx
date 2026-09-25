"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useEffect, useRef, useState } from "react";

import type { DiscoveryMessage } from "@/app/api/discover/route";
import type { CallTrace } from "@/lib/ai/trace";
import { GoalBriefSchema, type GoalBrief, type InferableField } from "@/lib/goals/schema";

const PRIORITY_LABEL: Record<GoalBrief["priority"], string> = {
  speed: "Speed",
  depth: "Depth",
  practical: "Practical results",
};

/** Starting points to click. Any goal works; these only show the range. */
const EXAMPLE_GOALS = [
  "I want to pass the California real estate salesperson exam",
  "I'd like to move into a data analyst role within a year",
  "I want to play a few jazz standards on piano",
  "I want to hold a basic conversation in Japanese before my trip",
];

/**
 * Demo of the first learner-facing flow (docs/content.md, "Goal discovery"):
 * a discovery conversation that ends in a goal brief the learner confirms.
 * Every AI call shows what the router chose and what it cost.
 */
export function GoalDiscoveryDemo() {
  const [input, setInput] = useState("");
  const [confirmed, setConfirmed] = useState<GoalBrief | null>(null);

  const { messages, sendMessage, status, error, clearError, setMessages } =
    useChat<DiscoveryMessage>({
      transport: new DefaultChatTransport({ api: "/api/discover" }),
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
    if (!trimmed || busy) return;
    clearError();
    sendMessage({ text: trimmed });
    setInput("");
  }

  function startOver() {
    setMessages([]);
    setConfirmed(null);
    clearError();
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-8 sm:px-6">
      {messages.length === 0 && (
        <section>
          <h1 className="text-2xl font-semibold tracking-tight">What do you want to learn?</h1>
          <p className="mt-2 text-foreground/70">
            Describe your goal in your own words, whatever it is. I&apos;ll ask a few questions so
            your plan fits your goal and your week.
          </p>
          <div className="mt-6 flex flex-wrap gap-2">
            {EXAMPLE_GOALS.map((goal) => (
              <button
                key={goal}
                onClick={() => send(goal)}
                disabled={busy}
                className="rounded-full border border-foreground/15 px-3 py-1.5 text-left text-sm text-foreground/70 transition hover:border-foreground/40 hover:text-foreground disabled:opacity-50"
              >
                {goal}
              </button>
            ))}
          </div>
        </section>
      )}

      {messages.length > 0 && (
        <section className="flex flex-col gap-4">
          {messages.map((m) => (
            <div key={m.id} className={m.role === "user" ? "self-end max-w-[85%]" : "max-w-full"}>
              {m.parts.map((part, i) => {
                if (part.type === "text" && part.text.trim()) {
                  return (
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
                  );
                }
                if (part.type === "tool-propose_goal_brief") {
                  if (part.state === "output-error") return null;
                  if (part.state !== "input-available" && part.state !== "output-available") {
                    return (
                      <div key={i} className="text-sm text-foreground/50">
                        Writing up your goal brief…
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
                      onConfirm={() => setConfirmed(brief.data)}
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
          Goal discovery is done. Next comes a short check of what you already know, then your
          first roadmap. Those steps aren&apos;t in this demo yet.{" "}
          <button className="underline" onClick={startOver}>
            Start over
          </button>
        </div>
      )}

      {!confirmed && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            send(input);
          }}
          className="sticky bottom-4 flex gap-2 rounded-xl border border-foreground/15 bg-background p-2 shadow-sm focus-within:border-foreground/40 focus-within:ring-2 focus-within:ring-foreground/20"
        >
          <input
            value={input}
            onChange={(e) => setInput(e.currentTarget.value)}
            placeholder={
              messages.length === 0
                ? "e.g. I want to switch into a data analyst role within a year"
                : latestBriefId
                  ? "Tell me what to change…"
                  : "Type your answer…"
            }
            className="min-w-0 flex-1 bg-transparent px-2 py-1 outline-none"
            autoFocus
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

      {traces.length > 0 && <TracePanel traces={traces} onStartOver={startOver} />}
      <div ref={bottomRef} />
    </div>
  );
}

function BriefCard({
  brief,
  active,
  confirmed,
  onConfirm,
}: {
  brief: GoalBrief;
  active: boolean;
  confirmed: boolean;
  onConfirm: () => void;
}) {
  const rows: [string, string | null, InferableField[]][] = [
    ["Why", brief.motivation, ["motivation"]],
    ["Success looks like", brief.successLooksLike, ["successLooksLike"]],
    ["Deadline", brief.deadline ?? "None set", ["deadline"]],
    ["Starting point", brief.startingPoint, ["startingPoint"]],
    [
      "Time",
      `${brief.weeklyHours} h/week · ${brief.sessionMinutes}-min sessions${
        brief.preferredTimes ? ` · ${brief.preferredTimes}` : ""
      }`,
      ["weeklyHours", "sessionMinutes", "preferredTimes"],
    ],
    ["Tried before", brief.pastAttempts ?? "First time", ["pastAttempts"]],
    ["Priority", PRIORITY_LABEL[brief.priority], ["priority"]],
    ["Interests & context", brief.interests.length ? brief.interests.join(", ") : null, []],
  ];
  const guessed = (fields: InferableField[]) => fields.some((f) => brief.inferred.includes(f));
  return (
    <div className="mt-3 rounded-xl border border-foreground/20 p-4">
      <div className="text-xs uppercase tracking-wide text-foreground/50">
        Goal brief · {brief.subject}
      </div>
      <div className="mt-1 text-lg font-medium">{brief.restatedGoal}</div>
      <div className="mt-1 text-sm text-foreground/60">&ldquo;{brief.goalInTheirWords}&rdquo;</div>
      <dl className="mt-4 grid gap-x-4 gap-y-2 text-sm sm:grid-cols-[10rem_1fr]">
        {rows
          .filter(([, v]) => v)
          .map(([k, v, fields]) => (
            <div key={k} className="contents">
              <dt className="text-foreground/50">{k}</dt>
              <dd>
                {v}
                {guessed(fields) && (
                  <span className="ml-2 rounded bg-amber-500/15 px-1.5 py-0.5 text-xs text-amber-700 dark:text-amber-300">
                    my guess
                  </span>
                )}
              </dd>
            </div>
          ))}
      </dl>
      {active && (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            onClick={onConfirm}
            className="rounded-lg bg-foreground px-4 py-2 text-sm text-background"
          >
            Looks right
          </button>
          <span className="text-sm text-foreground/50">
            Or tell me what to change below{brief.inferred.length > 0 && ", especially anything marked \"my guess\""}.
          </span>
        </div>
      )}
      {confirmed && <div className="mt-4 text-sm text-foreground/60">✓ Confirmed</div>}
    </div>
  );
}

function TraceChip({ trace }: { trace: CallTrace }) {
  return (
    <div className="mt-2 font-mono text-[11px] text-foreground/40">{formatTrace(trace)}</div>
  );
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

function formatTrace(t: CallTrace): string {
  const parts = [`${t.model} · ${t.tier}`];
  if (t.inputTokens != null) parts.push(`${t.inputTokens} in / ${t.outputTokens ?? 0} out`);
  if (t.costUsd != null) parts.push(`$${t.costUsd.toFixed(4)}`);
  if (t.latencyMs != null) parts.push(`${(t.latencyMs / 1000).toFixed(1)}s`);
  return parts.join(" · ");
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

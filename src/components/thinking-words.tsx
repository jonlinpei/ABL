"use client";

import { useEffect, useState } from "react";

/**
 * Phrases for what ABL is doing while a learner waits, by moment. Each is
 * true of the work going on then, so the words say something, not just
 * "loading".
 */
export const THINKING = {
  tutor: ["Thinking", "Reading your answer", "Picking an example", "Planning the next step"],
  sidekick: ["Thinking", "Finding a simple way to put it", "Picking an example"],
  discovery: ["Thinking", "Taking that in", "Piecing it together"],
  skillsCheck: ["Thinking", "Reading your answer", "Weighing it up"],
  wrapUp: ["Wrapping up", "Writing your recap", "Picking your homework"],
  skillsPicture: [
    "Reading current job postings",
    "Mapping the skills employers ask for",
    "Matching them to your experience",
    "Estimating where you stand",
  ],
  roadmap: ["Drafting your roadmap", "Fitting it to your week", "Checking it against your deadline", "Having a reviewer look it over"],
  rework: ["Gathering your coach's notes", "Reworking your plan", "Checking it fits your week", "Reviewing the changes"],
  update: ["Preparing your updated plan", "Fitting it to your week", "Comparing it with your current plan"],
} as const satisfies Record<string, readonly string[]>;

const STEP_MS = 2400;

/**
 * Words that show ABL is working: a shimmering phrase that moves through
 * `words` every couple of seconds and stays on the last, with dots after it.
 * Screen readers hear one steady "Working" instead of every change.
 */
export function ThinkingWords({
  words,
  className = "",
  srLabel = "Working",
}: {
  words: readonly string[];
  className?: string;
  srLabel?: string;
}) {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (words.length < 2) return;
    // Walk through once and settle on the last phrase, rather than looping forever.
    const id = setInterval(() => setI((n) => (n + 1 < words.length ? n + 1 : n)), STEP_MS);
    return () => clearInterval(id);
  }, [words]);
  return (
    <span role="status" className={className}>
      <span className="sr-only">{srLabel}</span>
      <span aria-hidden="true" key={i} className="thinking-enter">
        <span className="thinking-shimmer">{words[Math.min(i, words.length - 1)]}…</span>
      </span>
    </span>
  );
}

/**
 * A short action's label while it runs ("Saving…"), with the same shimmer.
 * `onDark` for dark buttons, where the text is the background color.
 */
export function WorkingLabel({ label, onDark = false }: { label: string; onDark?: boolean }) {
  return (
    <span role="status" style={onDark ? ({ "--thinking-color": "var(--background)" } as React.CSSProperties) : undefined}>
      <span className="thinking-shimmer">{label}…</span>
    </span>
  );
}

/**
 * Whether a chat is waiting on ABL: the message is sent, or the reply has
 * started but has no words yet (it's thinking or using a tool).
 */
export function isWaiting(status: string, messages: { role: string; parts: { type: string; text?: string }[] }[]): boolean {
  if (status === "submitted") return true;
  if (status !== "streaming") return false;
  const last = messages.at(-1);
  return !last || last.role !== "assistant" || !last.parts.some((p) => p.type === "text" && !!p.text?.trim());
}

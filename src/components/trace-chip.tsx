import type { CallTrace } from "@/lib/ai/trace";

/** What the router chose for one AI call and what it cost. */
export function TraceChip({ trace }: { trace: CallTrace }) {
  return (
    <div className="mt-2 font-mono text-[11px] text-foreground/40">{formatTrace(trace)}</div>
  );
}

export function formatTrace(t: CallTrace): string {
  const parts = [`${t.model} · ${t.tier}`];
  if (t.inputTokens != null) parts.push(`${t.inputTokens} in / ${t.outputTokens ?? 0} out`);
  if (t.costUsd != null) parts.push(`$${t.costUsd.toFixed(4)}`);
  if (t.latencyMs != null) parts.push(`${(t.latencyMs / 1000).toFixed(1)}s`);
  return parts.join(" · ");
}

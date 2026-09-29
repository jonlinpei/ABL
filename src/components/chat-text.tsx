import { Fragment } from "react";

/**
 * Tutor text with the little markdown models use even when asked for plain
 * text: **bold**, `inline code` and fenced code blocks. Showing raw
 * asterisks and backticks looks broken. Everything else stays plain, with
 * line breaks kept by the caller's whitespace-pre-wrap.
 */
export function ChatText({ text }: { text: string }) {
  // Fences alternate text and code. An unclosed fence (mid-stream) runs to the end.
  const segments = text.split("```");
  return (
    <>
      {segments.map((segment, i) => {
        if (i % 2 === 1) {
          // The first line of a fence is its language, if any; it isn't shown.
          const code = segment.replace(/^[\w+#.-]*[^\S\n]*\n/, "").replace(/\n$/, "");
          return (
            <pre key={i} className="my-2 overflow-x-auto whitespace-pre rounded-lg bg-foreground/5 p-3 text-sm">
              <code>{code}</code>
            </pre>
          );
        }
        // Drop the newline right next to a code block; the block has its own spacing.
        let plain = segment;
        if (i > 0) plain = plain.replace(/^\n/, "");
        if (i < segments.length - 1) plain = plain.replace(/\n$/, "");
        return <Fragment key={i}>{inline(plain)}</Fragment>;
      })}
    </>
  );
}

function inline(text: string) {
  return text.split(/(`[^`\n]+`|\*\*[^*\n]+\*\*)/g).map((chunk, i) =>
    /^`[^`\n]+`$/.test(chunk) ? (
      <code key={i} className="rounded bg-foreground/10 px-1 py-0.5 text-[0.9em]">
        {chunk.slice(1, -1)}
      </code>
    ) : /^\*\*[^*\n]+\*\*$/.test(chunk) ? (
      <strong key={i} className="font-semibold">
        {chunk.slice(2, -2)}
      </strong>
    ) : (
      <Fragment key={i}>{chunk}</Fragment>
    ),
  );
}

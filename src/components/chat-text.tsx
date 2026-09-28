import { Fragment } from "react";

/**
 * Tutor text with **bold** rendered. Models mark topics in bold even when
 * asked for plain text; showing raw asterisks looks broken. Everything else
 * stays plain, with line breaks kept by the caller's whitespace-pre-wrap.
 */
export function ChatText({ text }: { text: string }) {
  return (
    <>
      {text.split(/(\*\*[^*\n]+\*\*)/g).map((chunk, i) =>
        /^\*\*[^*\n]+\*\*$/.test(chunk) ? (
          <strong key={i} className="font-semibold">
            {chunk.slice(2, -2)}
          </strong>
        ) : (
          <Fragment key={i}>{chunk}</Fragment>
        ),
      )}
    </>
  );
}

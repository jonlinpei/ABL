import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ChatText } from "./chat-text";

describe("ChatText", () => {
  it("renders **bold** and leaves everything else as text", () => {
    expect(renderToStaticMarkup(<ChatText text={"Next, **BI tools**: walk me through it. 2 * 3 = 6"} />)).toBe(
      'Next, <strong class="font-semibold">BI tools</strong>: walk me through it. 2 * 3 = 6',
    );
  });

  it("escapes markup in the text", () => {
    expect(renderToStaticMarkup(<ChatText text="<b>hi</b>" />)).toBe("&lt;b&gt;hi&lt;/b&gt;");
  });
});

describe("ChatText code", () => {
  it("renders fenced code blocks without the language line or the fences", () => {
    const html = renderToStaticMarkup(<ChatText text={"Try this:\n\n```sql\nSELECT *\nFROM leads;\n```\n\nThen paste it."} />);
    expect(html).toContain("<pre");
    expect(html).toContain("<code>SELECT *\nFROM leads;</code>");
    expect(html).not.toContain("```");
    expect(html).not.toContain("sql\n");
    expect(html.startsWith("Try this:\n<pre")).toBe(true);
    expect(html.endsWith("</pre>\nThen paste it.")).toBe(true);
  });

  it("shows an unclosed fence (still streaming) as code, and renders `inline code`", () => {
    expect(renderToStaticMarkup(<ChatText text={"Run:\n```\nSELECT 1"} />)).toContain("<code>SELECT 1</code>");
    expect(renderToStaticMarkup(<ChatText text={"Use `GROUP BY` with **care**."} />)).toBe(
      'Use <code class="rounded bg-foreground/10 px-1 py-0.5 text-[0.9em]">GROUP BY</code> with <strong class="font-semibold">care</strong>.',
    );
  });
});

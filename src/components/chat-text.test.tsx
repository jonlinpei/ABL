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

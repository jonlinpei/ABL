import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { isWaiting, ThinkingWords, WorkingLabel } from "./thinking-words";

describe("ThinkingWords", () => {
  it("shows the first phrase with dots, and one steady label for screen readers", () => {
    const html = renderToStaticMarkup(<ThinkingWords words={["Thinking", "Reading your answer"]} />);
    expect(html).toContain('role="status"');
    expect(html).toContain('<span class="sr-only">Working</span>');
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain("Thinking…");
  });
});

describe("WorkingLabel", () => {
  it("uses the background color on dark buttons", () => {
    expect(renderToStaticMarkup(<WorkingLabel label="Saving" onDark />)).toContain("--thinking-color:var(--background)");
    expect(renderToStaticMarkup(<WorkingLabel label="Saving" />)).not.toContain("--thinking-color");
  });
});

describe("isWaiting", () => {
  const text = (t: string) => ({ role: "assistant", parts: [{ type: "text", text: t }] });
  it("is true while sent, or streaming before any words arrive", () => {
    expect(isWaiting("submitted", [])).toBe(true);
    expect(isWaiting("streaming", [{ role: "user", parts: [{ type: "text", text: "hi" }] }])).toBe(true);
    expect(isWaiting("streaming", [{ role: "assistant", parts: [{ type: "tool-end_session" }] }])).toBe(true);
    expect(isWaiting("streaming", [text("  ")])).toBe(true);
    expect(isWaiting("streaming", [text("Hello")])).toBe(false);
    expect(isWaiting("ready", [])).toBe(false);
  });
});

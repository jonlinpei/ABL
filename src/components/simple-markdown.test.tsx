import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { SimpleMarkdown } from "./simple-markdown";

const html = (s: string) => renderToStaticMarkup(<SimpleMarkdown source={s} />);

describe("SimpleMarkdown", () => {
  it("renders headings with anchors, paragraphs, bold and links", () => {
    const out = html("# Privacy Policy\n\n## 1. What we collect\n\nWe keep **your brief** and [delete it](/app/about-me)\nwhen you ask.");
    expect(out).toContain('<h1 id="privacy-policy"');
    expect(out).toContain('<h2 id="1-what-we-collect"');
    expect(out).toContain('<strong class="font-semibold">your brief</strong>');
    expect(out).toContain('<a href="/app/about-me" class="underline">delete it</a><br/>when you ask.');
  });

  it("renders bullet and numbered lists, with continuation lines, and opens external links in a new tab", () => {
    const out = html("- one\n  continued\n- two [Anthropic](https://www.anthropic.com)\n\n1. first\n2. second");
    expect(out).toContain("<li>one continued</li>");
    expect(out).toContain('target="_blank" rel="noreferrer">Anthropic</a>');
    expect(out).toMatch(/<ol[^>]*list-decimal[^>]*><li>first<\/li><li>second<\/li><\/ol>/);
  });

  it("escapes HTML in the source", () => {
    expect(html("a <script>x</script>")).toContain("&lt;script&gt;");
  });

  it("renders pipe tables", () => {
    const out = html("| Provider | What it does |\n|---|---|\n| Anthropic | **AI** models |\n| Neon | Database |");
    expect(out).toContain('<th class="border-b border-foreground/20 py-2 pr-4 text-left font-semibold">Provider</th>');
    expect(out).toContain('<td class="border-b border-foreground/10 py-2 pr-4 align-top"><strong class="font-semibold">AI</strong> models</td>');
    expect(out.match(/<tr>/g)).toHaveLength(3);
  });
});

import type { UIMessage } from "ai";
import { describe, expect, it } from "vitest";

import {
  MAX_ATTACHMENT_BYTES,
  MAX_TOTAL_ATTACHMENT_BYTES,
  attachedBytes,
  attachmentProblem,
  dataUrlBytes,
  invalidAttachments,
} from "./attachments";

const pdfUrl = (bytes: number) =>
  `data:application/pdf;base64,${Buffer.alloc(bytes).toString("base64")}`;
const message = (urls: string[], role: UIMessage["role"] = "user"): UIMessage => ({
  id: crypto.randomUUID(),
  role,
  parts: urls.map((url) => ({ type: "file" as const, mediaType: "application/pdf", url })),
});

describe("attachmentProblem (browser check)", () => {
  it("accepts a PDF within the caps", () => {
    expect(attachmentProblem({ type: "application/pdf", size: 200_000 }, 0)).toBeNull();
  });

  it("explains how to get a PDF when the file isn't one", () => {
    expect(attachmentProblem({ type: "image/png", size: 10 }, 0)).toMatch(/Save to PDF/);
  });

  it("rejects a file over the per-file cap, and one that would pass the conversation cap", () => {
    expect(attachmentProblem({ type: "application/pdf", size: MAX_ATTACHMENT_BYTES + 1 }, 0)).not.toBeNull();
    expect(
      attachmentProblem({ type: "application/pdf", size: 1024 }, MAX_TOTAL_ATTACHMENT_BYTES),
    ).not.toBeNull();
  });
});

describe("dataUrlBytes", () => {
  it("decodes the size of a base64 data URL, including padding", () => {
    for (const n of [0, 1, 2, 3, 1000]) expect(dataUrlBytes(pdfUrl(n))).toBe(n);
  });

  it("returns null for anything that isn't a base64 data URL", () => {
    expect(dataUrlBytes("https://example.com/cv.pdf")).toBeNull();
    expect(dataUrlBytes("data:text/plain,hello")).toBeNull();
  });
});

describe("invalidAttachments (server check)", () => {
  it("allows conversations with inline PDFs within the caps", () => {
    expect(invalidAttachments([message([pdfUrl(1000)]), message([pdfUrl(2000)])])).toBeNull();
    expect(attachedBytes([message([pdfUrl(1000)]), message([pdfUrl(2000)])])).toBe(3000);
  });

  it("rejects remote URLs, other types, assistant files and oversized totals", () => {
    expect(invalidAttachments([message(["https://example.com/cv.pdf"])])).not.toBeNull();
    expect(
      invalidAttachments([
        { id: "x", role: "user", parts: [{ type: "file", mediaType: "text/html", url: "data:text/html;base64,AA==" }] },
      ]),
    ).not.toBeNull();
    expect(invalidAttachments([message([pdfUrl(10)], "assistant")])).not.toBeNull();
    const nearCap = pdfUrl(MAX_ATTACHMENT_BYTES);
    expect(invalidAttachments([message([nearCap]), message([nearCap])])).not.toBeNull();
  });
});

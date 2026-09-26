import type { UIMessage } from "ai";

/**
 * Discovery accepts a resume or LinkedIn "Save to PDF" export. The whole chat,
 * attachments included, is resent every turn, so the caps keep requests well
 * under the 10 MB request body the Next.js proxy buffers by default
 * (experimental.proxyClientMaxBodySize).
 */
export const ACCEPTED_ATTACHMENT_TYPES = ["application/pdf"] as const;
export const MAX_ATTACHMENT_BYTES = 3 * 1024 * 1024;
export const MAX_TOTAL_ATTACHMENT_BYTES = 5 * 1024 * 1024;

const MB = 1024 * 1024;

/** Why a file can't be attached, or null if it can. Checked in the browser before sending. */
export function attachmentProblem(
  file: { type: string; size: number },
  alreadyAttachedBytes: number,
): string | null {
  if (!(ACCEPTED_ATTACHMENT_TYPES as readonly string[]).includes(file.type)) {
    return "Please attach a PDF. For LinkedIn, use More → Save to PDF on your profile.";
  }
  if (file.size > MAX_ATTACHMENT_BYTES) {
    return `That file is over ${MAX_ATTACHMENT_BYTES / MB} MB. A one- or two-page resume is plenty.`;
  }
  if (alreadyAttachedBytes + file.size > MAX_TOTAL_ATTACHMENT_BYTES) {
    return `Attachments in one conversation can add up to ${MAX_TOTAL_ATTACHMENT_BYTES / MB} MB.`;
  }
  return null;
}

/** Decoded size of a base64 data URL, or null if it isn't one. */
export function dataUrlBytes(url: string): number | null {
  const match = /^data:[^;,]+;base64,([\s\S]*)$/.exec(url);
  if (!match) return null;
  const b64 = match[1]!;
  const padding = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
  return Math.floor((b64.length * 3) / 4) - padding;
}

/** Total decoded bytes of the file parts in a conversation. */
export function attachedBytes(messages: UIMessage[]): number {
  let total = 0;
  for (const m of messages) {
    for (const part of m.parts) {
      if (part.type === "file") total += dataUrlBytes(part.url) ?? 0;
    }
  }
  return total;
}

/**
 * Server-side check of every file part the client sent. Only inline PDFs
 * within the caps are allowed: a remote URL would make the server or model
 * provider fetch an arbitrary address.
 */
export function invalidAttachments(messages: UIMessage[]): string | null {
  let total = 0;
  for (const m of messages) {
    for (const part of m.parts) {
      if (part.type !== "file") continue;
      if (m.role !== "user") return "Only the learner can attach files.";
      if (!(ACCEPTED_ATTACHMENT_TYPES as readonly string[]).includes(part.mediaType)) {
        return `Unsupported attachment type: ${part.mediaType}`;
      }
      const bytes = dataUrlBytes(part.url);
      if (bytes == null) return "Attachments must be sent inline.";
      if (bytes > MAX_ATTACHMENT_BYTES) return "An attachment is over the size limit.";
      total += bytes;
    }
  }
  if (total > MAX_TOTAL_ATTACHMENT_BYTES) return "Attachments are over the conversation limit.";
  return null;
}

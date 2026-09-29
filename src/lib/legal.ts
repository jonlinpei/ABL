import { readFileSync } from "node:fs";
import path from "node:path";

/** A legal document's Markdown, read at build time (the pages are static). */
export function legalDocument(name: "privacy-policy" | "terms-of-service"): string {
  return readFileSync(path.join(process.cwd(), "content", "legal", `${name}.md`), "utf8");
}

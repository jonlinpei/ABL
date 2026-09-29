import { describe, expect, it, vi } from "vitest";

import type { GlossarySense } from "./glossary";
import { glossaryKey } from "./glossary";
import { defineTerm } from "./glossary-define";

vi.mock("@/lib/ai/usage-events", () => ({ captureAiGeneration: async () => {} }));

const sense = (headword: string, domain: string, definition: string): GlossarySense => ({
  id: `${headword}-${domain}`, headword, headKey: glossaryKey(headword), domain, definition, skillId: null,
  briefId: null, source: "sidekick", timesSeen: 1, struggled: false, known: false,
});
const auditor = { currentRole: "Senior auditor (public accounting)", goal: "FP&A analyst (B2B SaaS)" };
const marketer = { currentRole: "Marketing operations coordinator (B2B SaaS)", goal: "Data analyst (B2B SaaS)" };

describe.concurrent("glossary definitions", () => {
  it("a word they know from another field becomes its own sense in the field they mean", async () => {
    const e = await defineTerm(
      { term: "leverage", note: null, learner: auditor, existing: [sense("leverage", "physics", "Using a lever to multiply force.")] },
      "eval",
    );
    expect(glossaryKey(e.domain)).not.toBe("physics");
    expect(e.domain).toMatch(/financ|account/i);
    expect(e.definition).toMatch(/debt|borrow/i);
  });

  it("spreadsheet pivot vs SQL PIVOT are separate senses, when they say which they mean", async () => {
    const e = await defineTerm(
      { term: "pivot", note: "the SQL one", learner: marketer, existing: [sense("pivot table", "spreadsheets", "A table that summarizes rows by category.")] },
      "eval",
    );
    expect(glossaryKey(e.domain)).not.toBe("spreadsheets");
    expect(e.definition).toMatch(/sql|rows? (in)?to columns|columns/i);
  });

  it("reuses the exact field of a sense they already have, and of their glossary's fields", async () => {
    const existing = [sense("LEFT JOIN", "data analysis", "Combines two tables, keeping every row from the first.")];
    const same = await defineTerm({ term: "left join", note: null, learner: marketer, existing }, "eval");
    expect(same.domain).toBe("data analysis");
    const cte = await defineTerm({ term: "CTE", note: null, learner: marketer, existing }, "eval");
    expect(cte.domain).toBe("data analysis");
    expect(cte.definition.split(/\s+/).length).toBeLessThanOrEqual(40);
  });
});

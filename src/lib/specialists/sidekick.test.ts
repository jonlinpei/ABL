import { describe, expect, it } from "vitest";

import { learnerTurns, messageLines, sidekickNotes, sidekickSummarySchema } from "./sidekick";

const msg = (role: string, text: string) => ({ role, parts: [{ type: "text", text }, { type: "step-start" }] });

describe("sidekick helpers", () => {
  it("reads the text of UI messages, newest last, and counts learner turns", () => {
    const chat = [msg("user", "what's a CTE?"), msg("assistant", "A named subquery."), { role: "assistant", parts: [{ type: "tool-x" }] }];
    expect(messageLines(chat)).toEqual(["Learner: what's a CTE?", "Tutor: A named subquery."]);
    expect(messageLines(chat, 1)).toEqual(["Tutor: A named subquery."]);
    expect(learnerTurns(chat)).toBe(1);
  });

  it("gives the tutor summaries, or the open question, and nothing when there are none", () => {
    expect(sidekickNotes([])).toBeNull();
    const notes = sidekickNotes([
      { summary: "Asked what a CTE is; got it.", struggled: false, messages: [] },
      { summary: null, struggled: null, messages: [msg("user", "and window functions?")] },
      { summary: null, struggled: null, messages: [] },
    ])!;
    expect(notes).toContain("- Asked what a CTE is; got it.\n");
    expect(notes).toContain('- Asked: "and window functions?" (still open)');
    expect(notes.split("\n")).toHaveLength(3);
  });

  it("limits the summary's skill to the session's skills", () => {
    const schema = sidekickSummarySchema(["sql-querying"]);
    const ok = { summary: "s", term: null, definition: null, skillId: "sql-querying", struggled: false };
    expect(schema.safeParse(ok).success).toBe(true);
    expect(schema.safeParse({ ...ok, skillId: "made-up" }).success).toBe(false);
  });
});

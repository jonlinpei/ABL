import { describe, expect, it } from "vitest";

import { computeGap } from "./gap";
import { definePrompt, familiarity, glossaryDomains, glossaryKey, glossaryNotes, groupByHeadword, type GlossarySense } from "./glossary";
import { sampleProfile, sampleRequirements } from "./test-fixtures";

const gap = computeGap(sampleRequirements, sampleProfile); // sql-querying missing, spreadsheets met
const sense = (over: Partial<GlossarySense> = {}): GlossarySense => ({
  id: "1", headword: "pivot", headKey: "pivot", domain: "data analysis", definition: "d", skillId: null,
  briefId: null, source: "sidekick", timesSeen: 1, struggled: false, known: false, ...over,
});

describe("glossaryKey", () => {
  it("matches the same term however it's written", () => {
    expect(glossaryKey("  Left   JOIN ")).toBe("left join");
    expect(glossaryKey('"Leverage."')).toBe("leverage");
    expect(glossaryKey("C++")).toBe("c++");
    expect(glossaryKey("COUNT(*)")).toBe("count(*)");
  });
});

describe("familiarity", () => {
  it("is solid when marked known or the skill is met, shaky when they struggled or it keeps coming up, else new", () => {
    expect(familiarity(sense({ known: true, struggled: true }), gap)).toBe("solid");
    expect(familiarity(sense({ skillId: "spreadsheets", struggled: true }), gap)).toBe("solid");
    expect(familiarity(sense({ skillId: "sql-querying", struggled: true }), gap)).toBe("shaky");
    expect(familiarity(sense({ timesSeen: 3 }), gap)).toBe("shaky");
    expect(familiarity(sense(), null)).toBe("new");
  });
});

describe("grouping and fields", () => {
  it("groups senses under their headword, alphabetically, and lists fields once", () => {
    const groups = groupByHeadword([
      sense({ id: "a", domain: "sql" }),
      sense({ id: "b", headword: "Leverage", headKey: "leverage", domain: "finance" }),
      sense({ id: "c", domain: "spreadsheets" }),
      sense({ id: "d", headword: "leverage", headKey: "leverage", domain: "physics" }),
    ]);
    expect(groups.map((g) => [g.headword, g.senses.map((s) => s.domain)])).toEqual([
      ["Leverage", ["finance", "physics"]],
      ["pivot", ["spreadsheets", "sql"]],
    ]);
    expect(glossaryDomains([sense({ domain: "Finance" }), sense({ domain: "finance" }), sense({ domain: "sql" })])).toEqual(["Finance", "sql"]);
  });
});

describe("glossaryNotes", () => {
  it("lists fields, and this milestone's shaky terms with their other senses", () => {
    const notes = glossaryNotes(
      [
        sense({ id: "a", domain: "sql", skillId: "sql-querying", struggled: true }),
        sense({ id: "b", domain: "spreadsheets", definition: "a pivot table summarizes rows" }),
        sense({ id: "c", headword: "JOIN", headKey: "join", domain: "sql", skillId: "other-skill", struggled: true }),
      ],
      ["sql-querying"],
      gap,
    )!;
    expect(notes).toContain("fields in use: spreadsheets, sql");
    expect(notes).toContain('- pivot (sql) is still shaky. They also know it from spreadsheets ("a pivot table summarizes rows")');
    expect(notes).not.toContain("JOIN");
    expect(glossaryNotes([], ["sql-querying"], gap)).toBeNull();
  });
});

describe("definePrompt", () => {
  it("gives the term, their note, their goal, their fields and existing senses of that term", () => {
    const p = definePrompt({
      term: "Leverage",
      note: "in finance",
      learner: { currentRole: "Auditor (accounting)", goal: "FP&A analyst (SaaS)" },
      existing: [sense({ headword: "leverage", headKey: "leverage", domain: "physics", definition: "force multiplied by a lever" }), sense()],
    });
    expect(p).toContain("Term they added: Leverage");
    expect(p).toContain("What they said about it: in finance");
    expect(p).toContain("learning toward: FP&A analyst (SaaS)");
    expect(p).toContain("Fields already in their glossary: data analysis, physics");
    expect(p).toContain("- physics: force multiplied by a lever");
    expect(p).not.toContain("- data analysis: d");
  });
});

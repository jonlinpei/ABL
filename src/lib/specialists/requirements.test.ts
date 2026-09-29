import { beforeEach, describe, expect, it, vi } from "vitest";

import { sampleBrief } from "@/lib/goals/test-fixtures";

import type { Posting, RequirementsDraft } from "./schemas";
import { sampleRequirements } from "./test-fixtures";

const generateStructured = vi.fn();
vi.mock("@/lib/ai/structured", () => ({ generateStructured: (...a: unknown[]) => generateStructured(...a) }));

const { groundInPostings, requirementsPrompt, researchPostings, targetKey, usablePostings, withUniqueSkillIds } =
  await import("./requirements");

beforeEach(() => generateStructured.mockReset());

const posting = (i: number, over: Partial<Posting> = {}): Posting => ({
  title: "Data Analyst",
  company: `Co ${i}`,
  url: `https://jobs.example.com/${i}`,
  location: "San Francisco",
  requirements: [
    { text: "SQL", required: true },
    { text: "Tableau", required: false },
  ],
  ...over,
});
const postings = Array.from({ length: 10 }, (_, i) => posting(i));
const draftSkill = (id: string, seenIn: number[], importance: "must" | "nice" = "must") => ({
  id, name: id, category: "technical" as const, level: 2, importance, howEmployersCheck: "Test", howToShow: "A project", seenIn,
});
const draft = (skills: RequirementsDraft["skills"]): RequirementsDraft => ({
  summary: "s", skills, credentials: [], proofOfSkill: [], caveats: [],
});

describe("targetKey", () => {
  it("is the same for targets that differ only in case and spacing", () => {
    const a = targetKey({ ...sampleBrief.target, role: "Data  Analyst " });
    const b = targetKey({ ...sampleBrief.target, role: "data analyst" });
    expect(a).toBe(b);
    expect(a).toBe("data analyst | bay area, b2b software | software");
  });

  it("differs when the market or industry differs", () => {
    expect(targetKey(sampleBrief.target)).not.toBe(
      targetKey({ ...sampleBrief.target, industry: "Healthcare" }),
    );
  });
});

describe("withUniqueSkillIds", () => {
  it("slugs ids and drops repeats and empties", () => {
    const [first] = sampleRequirements.skills;
    const r = withUniqueSkillIds({
      ...sampleRequirements,
      skills: [
        { ...first!, id: "SQL Querying" },
        { ...first!, id: "sql-querying", name: "Duplicate" },
        { ...first!, id: "!!!" },
      ],
    });
    expect(r.skills.map((s) => [s.id, s.name])).toEqual([["sql-querying", "SQL querying"]]);
  });
});

describe("requirementsPrompt", () => {
  it("describes the target and asks for the target, not the learner", () => {
    const p = requirementsPrompt(sampleBrief);
    expect(p).toContain(sampleBrief.target.role);
    expect(p).toContain(sampleBrief.target.market);
    expect(p).toMatch(/not for this learner/);
  });
});

describe("groundInPostings", () => {
  const now = new Date("2026-10-01T12:00:00Z");

  it("sets frequency from how many postings ask, and only core skills are must-haves", () => {
    const r = groundInPostings(
      draft([
        draftSkill("sql", [1, 2, 3, 4, 5, 6, 7]),
        draftSkill("python", [1, 2, 3, 4]),
        draftSkill("dbt", [1, 2], "must"),
        draftSkill("tableau", [1, 2, 3, 4, 5, 6], "nice"),
      ]),
      postings,
      now,
    );
    expect(r.skills.map((s) => [s.id, s.frequency, s.postingShare, s.importance])).toEqual([
      ["sql", "core", 0.7, "must"],
      ["python", "common", 0.4, "nice"],
      ["dbt", "sometimes", 0.2, "nice"],
      ["tableau", "core", 0.6, "must"],
    ]);
    expect(r.sources).toHaveLength(10);
    expect(r.groundedAt).toBe("2026-10-01");
    expect(r.skills[0]).not.toHaveProperty("seenIn");
    expect(r.skills[0]!.howToShow).toBe("A project");
  });

  it("ignores repeated and out-of-range posting numbers", () => {
    const [s] = groundInPostings(draft([draftSkill("sql", [1, 1, 1, 0, 11, 2.5])]), postings, now).skills;
    expect(s!.postingShare).toBe(0.1);
  });

  it("keeps the analyst's call for skills no posting names", () => {
    const [s] = groundInPostings(draft([draftSkill("power-markets", [], "must")]), postings, now).skills;
    expect(s).toMatchObject({ importance: "must" });
    expect(s!.frequency).toBeUndefined();
  });

  it("with too few postings, keeps the analyst's calls and says the list isn't grounded", () => {
    const r = groundInPostings(draft([draftSkill("dbt", [1], "must")]), postings.slice(0, 3), now);
    expect(r.skills[0]).toMatchObject({ importance: "must" });
    expect(r.skills[0]!.frequency).toBeUndefined();
    expect(r.sources).toBeUndefined();
    expect(r.caveats.at(-1)).toMatch(/only 3 current job postings/);
  });
});

describe("usablePostings", () => {
  it("drops repeats and postings with too little to count", () => {
    const kept = usablePostings([
      posting(1),
      posting(1, { url: "https://other.example.com" }),
      posting(2, { url: "https://jobs.example.com/1" }),
      posting(3, { requirements: [{ text: "SQL", required: true }] }),
      posting(4),
    ]);
    expect(kept.map((p) => p.company)).toEqual(["Co 1", "Co 4"]);
  });
});

describe("researchPostings", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => new Response(null, { status: url.endsWith("/gone") ? 404 : 200 })));
    return () => vi.unstubAllGlobals();
  });

  it("drops postings whose page is gone", async () => {
    generateStructured.mockResolvedValueOnce({
      output: { postings: [posting(1), posting(2, { url: "https://jobs.example.com/gone" })], notes: "" },
    });
    expect((await researchPostings(sampleBrief, "u")).postings.map((p) => p.company)).toEqual(["Co 1"]);
  });

  it("searches the web on the research task", async () => {
    generateStructured.mockResolvedValueOnce({ output: { postings: [posting(1), posting(1)], notes: "" } });
    const r = await researchPostings(sampleBrief, "u");
    expect(r.postings).toHaveLength(1);
    expect(generateStructured.mock.calls[0]![0]).toMatchObject({ task: "requirements_research", webSearch: { maxUses: 5 } });
  });

  it("returns no postings when the search fails, so requirements still get built", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    generateStructured.mockRejectedValueOnce(new Error("timeout"));
    expect((await researchPostings(sampleBrief, "u")).postings).toEqual([]);
  });
});

describe("requirementsPrompt with postings", () => {
  it("numbers the postings and separates required from preferred", () => {
    const p = requirementsPrompt(sampleBrief, [posting(1)]);
    expect(p).toContain("1. Data Analyst, Co 1 (San Francisco)");
    expect(p).toContain("Required: SQL");
    expect(p).toContain("Preferred: Tableau");
    expect(requirementsPrompt(sampleBrief)).toMatch(/No current job postings/);
  });
});

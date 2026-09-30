import { beforeEach, describe, expect, it, vi } from "vitest";

import { sampleBrief } from "@/lib/goals/test-fixtures";
import { computeGap } from "@/lib/specialists/gap";
import { sampleProfile, sampleRequirements } from "@/lib/specialists/test-fixtures";

const auth = vi.fn();
const loadGlossary = vi.fn();
const recordTerms = vi.fn();
const setTermKnown = vi.fn();
const deleteTerm = vi.fn();
const defineTerm = vi.fn();
const loadGoalState = vi.fn();
const currentGoal = vi.fn();
vi.mock("@clerk/nextjs/server", () => ({ auth: () => auth() }));
vi.mock("@/db", () => ({ isDatabaseConfigured: () => true }));
vi.mock("@/lib/specialists/glossary-store", () => ({
  loadGlossary: (...a: unknown[]) => loadGlossary(...a),
  recordTerms: (...a: unknown[]) => recordTerms(...a),
  setTermKnown: (...a: unknown[]) => setTermKnown(...a),
  deleteTerm: (...a: unknown[]) => deleteTerm(...a),
}));
vi.mock("@/lib/specialists/glossary-define", () => ({ defineTerm: (...a: unknown[]) => defineTerm(...a) }));
vi.mock("@/lib/specialists/store", () => ({ loadGoalState: (...a: unknown[]) => loadGoalState(...a) }));
vi.mock("@/lib/goals/goal-store", () => ({ currentGoal: (...a: unknown[]) => currentGoal(...a) }));

const { DELETE, GET, PATCH, POST } = await import("./route");

const ID = "3f1c2b8e-4a5d-4c6e-9f7a-1b2c3d4e5f60";
const gap = computeGap(sampleRequirements, sampleProfile);
const sense = (over: Record<string, unknown>) => ({
  id: ID, headword: "pivot", headKey: "pivot", domain: "sql", definition: "d", skillId: "sql-querying",
  briefId: "b1", source: "sidekick", timesSeen: 1, struggled: true, known: false, ...over,
});
const req = (method: string, body: unknown) => new Request("http://t", { method, body: JSON.stringify(body) });

beforeEach(() => {
  for (const m of [loadGlossary, recordTerms, setTermKnown, deleteTerm, defineTerm]) m.mockReset();
  auth.mockResolvedValue({ userId: "user_1" });
  currentGoal.mockReset().mockResolvedValue({ id: "g1", status: "active" });
  loadGoalState.mockReset().mockResolvedValue({ brief: { id: "b1", brief: sampleBrief }, gap: { gap } });
  loadGlossary.mockResolvedValue([sense({}), sense({ id: "t2", domain: "spreadsheets", skillId: null, briefId: "old", struggled: false })]);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("GET /api/glossary", () => {
  it("groups senses under headwords, with familiarity, skill name and whether they belong to the current goal", async () => {
    const body = await (await GET()).json();
    expect(body.currentBriefId).toBe("b1");
    expect(body.headwords).toHaveLength(1);
    expect(body.headwords[0].senses).toEqual([
      expect.objectContaining({ domain: "spreadsheets", familiarity: "new", inCurrentGoal: false, skillName: null }),
      expect.objectContaining({ domain: "sql", familiarity: "shaky", inCurrentGoal: true, skillName: "SQL querying" }),
    ]);
    expect(loadGoalState).toHaveBeenCalledWith("user_1", "g1");
  });

  it("has no current goal before the learner has one", async () => {
    currentGoal.mockResolvedValueOnce(undefined);
    const body = await (await GET()).json();
    expect(body.currentBriefId).toBeNull();
    expect(body.headwords[0].senses.every((s: { inCurrentGoal: boolean }) => !s.inCurrentGoal)).toBe(true);
    expect(loadGoalState).not.toHaveBeenCalled();
  });
});

describe("POST /api/glossary", () => {
  it("defines the term against their goal and existing senses, and records it under the current goal", async () => {
    defineTerm.mockResolvedValueOnce({ term: "Leverage", definition: "Using borrowed money to increase returns.", domain: "finance" });
    expect((await POST(req("POST", { term: " leverage ", note: "finance" }))).status).toBe(200);
    const [input] = defineTerm.mock.calls[0]!;
    expect(input).toMatchObject({ term: "leverage", note: "finance", learner: { goal: `${sampleBrief.target.role} (${sampleBrief.target.industry})` } });
    expect(input.existing).toHaveLength(2);
    expect(recordTerms).toHaveBeenCalledWith("user_1", "b1", "learner", [
      { term: "Leverage", definition: "Using borrowed money to increase returns.", domain: "finance" },
    ]);
  });

  it("rejects an empty term, and says so when defining fails", async () => {
    expect((await POST(req("POST", { term: "  ...  " }))).status).toBe(400);
    defineTerm.mockRejectedValueOnce(new Error("down"));
    expect((await POST(req("POST", { term: "leverage" }))).status).toBe(502);
    expect(recordTerms).not.toHaveBeenCalled();
  });
});

describe("PATCH and DELETE /api/glossary", () => {
  it("only change the learner's own senses", async () => {
    setTermKnown.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    expect((await PATCH(req("PATCH", { id: ID, known: true }))).status).toBe(200);
    expect(setTermKnown).toHaveBeenCalledWith("user_1", ID, true);
    expect((await PATCH(req("PATCH", { id: ID, known: true }))).status).toBe(404);
    deleteTerm.mockResolvedValueOnce(false);
    expect((await DELETE(req("DELETE", { id: ID }))).status).toBe(404);
    expect((await DELETE(req("DELETE", { id: "nope" }))).status).toBe(400);
  });
});

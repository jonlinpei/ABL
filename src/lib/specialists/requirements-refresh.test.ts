import { beforeEach, describe, expect, it, vi } from "vitest";

import { computeGap } from "./gap";
import { sampleProfile, sampleRequirements } from "./test-fixtures";

const loadRequirementsForRefresh = vi.fn();
const loadGapsOnRequirements = vi.fn();
const saveRebasedGap = vi.fn();
vi.mock("./store", () => ({
  loadRequirementsForRefresh: (...a: unknown[]) => loadRequirementsForRefresh(...a),
  loadGapsOnRequirements: (...a: unknown[]) => loadGapsOnRequirements(...a),
  saveRebasedGap: (...a: unknown[]) => saveRebasedGap(...a),
  saveRefreshedRequirements: vi.fn(),
}));
vi.mock("./mastery-store", () => ({ loadMastery: async () => [] }));

const { rebaseLearnerGaps } = await import("./requirements-refresh");

const gap = computeGap(sampleRequirements, sampleProfile);
const harder = {
  ...sampleRequirements,
  skills: sampleRequirements.skills.map((s) => (s.id === "dashboards" ? { ...s, importance: "must" as const, level: 3 } : s)),
};

beforeEach(() => {
  saveRebasedGap.mockReset();
  loadRequirementsForRefresh.mockResolvedValue({ requirements: harder, brief: {} });
});

describe("rebaseLearnerGaps", () => {
  it("rebases every learner's gap, and tells only those with a plan whose must-haves changed", async () => {
    const easy = computeGap({ ...harder }, { ...sampleProfile, skills: sampleProfile.skills.map((s) => ({ ...s, level: 4 })) });
    loadGapsOnRequirements.mockResolvedValue([
      { gapId: "g1", userId: "planned", briefId: "b1", gap, hasActivePlan: true },
      { gapId: "g2", userId: "onboarding", briefId: "b2", gap, hasActivePlan: false },
      { gapId: "g3", userId: "all-met", briefId: "b3", gap: easy, hasActivePlan: true },
    ]);
    expect(await rebaseLearnerGaps("r1")).toEqual(["planned"]);
    expect(saveRebasedGap).toHaveBeenCalledTimes(3);
    const [gapId, userId, rebased, change] = saveRebasedGap.mock.calls[0]!;
    expect([gapId, userId]).toEqual(["g1", "planned"]);
    expect(rebased.items.find((i: { skillId: string }) => i.skillId === "dashboards")).toMatchObject({ importance: "must", status: "partial" });
    expect(change).toEqual({ requirementsId: "r1", added: [{ skillId: "dashboards", name: "Dashboards" }], dropped: [] });
    expect(saveRebasedGap.mock.calls[1]![3]).toBeNull();
    expect(saveRebasedGap.mock.calls[2]![3]).toBeNull();
  });
});

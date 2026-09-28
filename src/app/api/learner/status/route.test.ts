import { beforeEach, describe, expect, it, vi } from "vitest";

import { computeGap } from "@/lib/specialists/gap";
import { samplePlan, sampleProfile, sampleRequirements } from "@/lib/specialists/test-fixtures";

const auth = vi.fn();
const loadLatestBriefAndGap = vi.fn();
vi.mock("@clerk/nextjs/server", () => ({ auth: () => auth() }));
vi.mock("@/db", () => ({ isDatabaseConfigured: () => true }));
vi.mock("@/lib/specialists/store", () => ({
  loadLatestBriefAndGap: (...a: unknown[]) => loadLatestBriefAndGap(...a),
  loadSessions: async () => [],
}));

const { GET } = await import("./route");
const gap = computeGap(sampleRequirements, sampleProfile);

beforeEach(() => {
  auth.mockReset().mockResolvedValue({ userId: "user_1" });
});

describe("GET /api/learner/status", () => {
  it("walks through the stages after discovery", async () => {
    loadLatestBriefAndGap.mockResolvedValueOnce(undefined);
    expect(await (await GET()).json()).toEqual({ stage: "no_brief" });

    loadLatestBriefAndGap.mockResolvedValueOnce({ brief: {}, gap: undefined });
    expect(await (await GET()).json()).toEqual({ stage: "building_gap" });

    loadLatestBriefAndGap.mockResolvedValueOnce({ brief: {}, gap: { gap, assessedAt: null } });
    expect(await (await GET()).json()).toEqual({
      stage: "ready_to_check",
      skills: [{ skillId: "dashboards", name: "Dashboards" }],
    });

    loadLatestBriefAndGap.mockResolvedValueOnce({ brief: {}, gap: { gap, assessedAt: "2026-09-28" } });
    expect(await (await GET()).json()).toMatchObject({ stage: "planning", assessed: true });

    loadLatestBriefAndGap.mockResolvedValueOnce({
      brief: {},
      gap: { gap, assessedAt: "2026-09-28" },
      plan: { id: "plan_1", plan: samplePlan },
    });
    expect(await (await GET()).json()).toMatchObject({
      stage: "plan_ready",
      plan: { title: samplePlan.title },
      progress: { milestoneIndex: 0, sessionsDone: 0, activeSessionId: null, lastReport: null },
    });
  });

  it("requires sign-in", async () => {
    auth.mockResolvedValueOnce({ userId: null });
    expect((await GET()).status).toBe(401);
  });
});

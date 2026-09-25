import { describe, expect, it } from "vitest";

import { MODEL_ALLOWLIST, MODEL_REGISTRY, type ModelSpec } from "./models";
import {
  InvalidUserPrefsError,
  NoEligibleModelError,
  resolveModel,
  type ModelResolution,
} from "./router";
import { TASK_ROUTES, TASK_TYPES } from "./tasks";

const ids = (r: ModelResolution) => [r.primary, ...r.fallbacks].map((x) => x.model.id);

function spec(overrides: Partial<ModelSpec> & Pick<ModelSpec, "id">): ModelSpec {
  return {
    provider: "anthropic",
    tier: "standard",
    capabilities: { structuredOutput: true, toolUse: true, contextWindow: 200_000 },
    pricing: { inputPerMTok: 1, outputPerMTok: 5 },
    status: "stable",
    ...overrides,
  };
}

describe("registry and route table", () => {
  it("allowlist only references registered, non-preview models", () => {
    for (const id of MODEL_ALLOWLIST) {
      const model = MODEL_REGISTRY.find((m) => m.id === id);
      expect(model, `allowlisted model ${id} is not in the registry`).toBeDefined();
      expect(model!.status).toBe("stable");
    }
  });

  it("uses the specified Anthropic model per tier", () => {
    const anthropic = MODEL_REGISTRY.filter((m) => m.provider === "anthropic");
    expect(Object.fromEntries(anthropic.map((m) => [m.tier, m.id]))).toEqual({
      fast: "claude-haiku-4-5",
      standard: "claude-sonnet-5",
      deep: "claude-opus-5-5",
    });
  });

  it("every task resolves with the default registry and no prefs", () => {
    for (const task of TASK_TYPES) {
      const r = resolveModel(task);
      expect(r.primary.model.tier).toBe(TASK_ROUTES[task].tier);
      expect(r.primary.keySource).toBe("platform");
    }
  });
});

describe("resolveModel", () => {
  it("picks the default tier first, then fallback tiers in order", () => {
    const r = resolveModel("roadmap_generate");
    const tiers = [r.primary, ...r.fallbacks].map((x) => x.model.tier);
    const firstStandard = tiers.indexOf("standard");
    expect(tiers[0]).toBe("deep");
    expect(firstStandard).toBeGreaterThan(0);
    // all deep models come before all standard models; fast is not in the chain
    expect(tiers.slice(0, firstStandard).every((t) => t === "deep")).toBe(true);
    expect(tiers.slice(firstStandard).every((t) => t === "standard")).toBe(true);
  });

  it("uses registry order as the default tie-break within a tier", () => {
    const r = resolveModel("glossary_define");
    expect(r.primary.model.id).toBe("claude-haiku-4-5");
  });

  it("returns a fallback list with no duplicates that excludes the primary", () => {
    const r = resolveModel("goal_clarify");
    const all = ids(r);
    expect(new Set(all).size).toBe(all.length);
    expect(r.fallbacks.map((f) => f.model.id)).not.toContain(r.primary.model.id);
  });

  it("restricts to allowed providers", () => {
    const r = resolveModel("replan", { allowedProviders: ["openai"] });
    expect(r.primary.model.id).toBe("gpt-6-sol");
    expect([r.primary, ...r.fallbacks].every((x) => x.model.provider === "openai")).toBe(true);
  });

  it("treats an empty allowedProviders list as no restriction", () => {
    expect(resolveModel("replan", { allowedProviders: [] }).primary.model.id).toBe(
      "claude-sonnet-5",
    );
  });

  it("preferCheaper ranks cheaper models first within the tier but keeps the tier", () => {
    const r = resolveModel("sidekick_answer", { preferCheaper: true });
    expect(r.primary.model.id).toBe("gpt-6-luna");
    expect(r.primary.model.tier).toBe("fast");
  });

  it("preferCheaper sorts unknown pricing last within a tier", () => {
    const r = resolveModel("gap_detect", { preferCheaper: true });
    const fast = [r.primary, ...r.fallbacks].filter((x) => x.model.tier === "fast");
    expect(fast.map((x) => x.model.id)).toEqual([
      "gpt-6-luna",
      "claude-haiku-4-5",
      "gemini-3.5-flash-lite",
    ]);
  });

  it("ranks the BYOK provider first within a tier and marks its key source", () => {
    const r = resolveModel("replan", { byok: { provider: "google", apiKey: "k" } });
    expect(r.primary.model.id).toBe("gemini-3.8-flash");
    expect(r.primary.keySource).toBe("byok");
    const others = r.fallbacks.filter((f) => f.model.provider !== "google");
    expect(others.every((f) => f.keySource === "platform")).toBe(true);
  });

  it("BYOK does not override the task tier", () => {
    const r = resolveModel("roadmap_generate", { byok: { provider: "google", apiKey: "k" } });
    // Google has no allowlisted deep model, so a platform deep model wins.
    expect(r.primary.model.tier).toBe("deep");
    expect(r.primary.keySource).toBe("platform");
  });

  it("rejects a BYOK provider outside allowedProviders", () => {
    expect(() =>
      resolveModel("replan", {
        allowedProviders: ["anthropic"],
        byok: { provider: "openai", apiKey: "k" },
      }),
    ).toThrow(InvalidUserPrefsError);
  });

  it("rejects an empty BYOK key", () => {
    expect(() =>
      resolveModel("replan", { byok: { provider: "openai", apiKey: "  " } }),
    ).toThrow(InvalidUserPrefsError);
  });

  it("falls through to a fallback tier when the default tier has no eligible model", () => {
    const registry = [
      spec({ id: "std", tier: "standard" }),
      spec({ id: "deep", tier: "deep" }),
    ];
    const r = resolveModel(
      "roadmap_generate",
      {},
      { registry, allowlist: new Set(["std"]) },
    );
    expect(r.primary.model.id).toBe("std");
    expect(r.fallbacks).toEqual([]);
  });

  it("skips models that are registered but not allowlisted", () => {
    const registry = [spec({ id: "a" }), spec({ id: "b" })];
    const r = resolveModel("replan", {}, { registry, allowlist: new Set(["b"]) });
    expect(ids(r)).toEqual(["b"]);
  });

  it("skips models that lack a required capability", () => {
    const registry = [
      spec({
        id: "no-tools",
        tier: "deep",
        capabilities: { structuredOutput: true, toolUse: false, contextWindow: 1_000_000 },
      }),
      spec({ id: "small-ctx", tier: "deep", capabilities: { structuredOutput: true, toolUse: true, contextWindow: 100_000 } }),
      spec({ id: "ok", tier: "deep", capabilities: { structuredOutput: true, toolUse: true, contextWindow: 500_000 } }),
    ];
    const r = resolveModel(
      "roadmap_generate",
      {},
      { registry, allowlist: new Set(registry.map((m) => m.id)) },
    );
    expect(ids(r)).toEqual(["ok"]);
  });

  it("throws a clear error when no allowed model meets the requirements", () => {
    const registry = [
      spec({
        id: "text-only",
        capabilities: { structuredOutput: false, toolUse: false, contextWindow: 1_000_000 },
      }),
    ];
    const run = () =>
      resolveModel("assessment_grade", {}, { registry, allowlist: new Set(["text-only"]) });
    expect(run).toThrow(NoEligibleModelError);
    expect(run).toThrow(/assessment_grade/);
    expect(run).toThrow(/structuredOutput/);
    expect(run).toThrow(/meets the requirements/);
  });

  it("throws when the allowed providers have no allowlisted model", () => {
    const registry = [spec({ id: "a", provider: "anthropic" })];
    expect(() =>
      resolveModel(
        "replan",
        { allowedProviders: ["google"] },
        { registry, allowlist: new Set(["a"]) },
      ),
    ).toThrow(/allowed providers \(google\)/);
  });

  it("throws when the allowlist is empty", () => {
    expect(() => resolveModel("replan", {}, { allowlist: new Set() })).toThrow(
      /allowlist is empty/,
    );
  });

  it("throws when capable models exist only outside the task's tier chain", () => {
    const registry = [spec({ id: "fast-only", tier: "fast" })];
    expect(() =>
      resolveModel("assessment_grade", {}, { registry, allowlist: new Set(["fast-only"]) }),
    ).toThrow(/none in tiers standard -> deep/);
  });
});

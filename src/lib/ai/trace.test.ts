import { describe, expect, it } from "vitest";

import { MODEL_REGISTRY } from "./models";
import { estimateCost, estimateCostUsd, sumUsage } from "./trace";

const sonnet = MODEL_REGISTRY.find((m) => m.id === "claude-sonnet-5")!; // $2 in, $10 out per million

describe("estimateCost", () => {
  it("prices uncached input, output, and cache reads and writes at their own rates", () => {
    const c = estimateCost(sonnet, {
      inputTokens: 100_000, // includes the cached tokens below
      outputTokens: 1_000,
      inputTokenDetails: { cacheReadTokens: 80_000, cacheWriteTokens: 10_000 },
    })!;
    // 10k uncached × $2 + 80k read × $0.20 + 10k write × $2.50, per million
    expect(c.input).toBeCloseTo((10_000 * 2 + 80_000 * 0.2 + 10_000 * 2.5) / 1e6, 10);
    expect(c.output).toBeCloseTo(0.01, 10);
    expect(c.total).toBeCloseTo(c.input + c.output, 10);
  });

  it("is far cheaper for a mostly cached call than the old list-price estimate", () => {
    const usage = { inputTokens: 100_000, outputTokens: 0, inputTokenDetails: { cacheReadTokens: 90_000, cacheWriteTokens: 0 } };
    expect(estimateCostUsd(sonnet, usage)).toBeCloseTo((10_000 * 2 + 90_000 * 0.2) / 1e6, 10);
    expect(estimateCostUsd(sonnet, usage)!).toBeLessThan(0.2 * (100_000 * 2) / 1e6 * 2);
  });

  it("prices cached tokens as ordinary input when a model has no cache prices", () => {
    const plain = { ...sonnet, pricing: { inputPerMTok: 2, outputPerMTok: 10 } };
    const usage = { inputTokens: 1_000, outputTokens: 0, inputTokenDetails: { cacheReadTokens: 800, cacheWriteTokens: 0 } };
    expect(estimateCostUsd(plain, usage)).toBeCloseTo((1_000 * 2) / 1e6, 10);
  });

  it("is null without pricing or usage", () => {
    expect(estimateCost({ ...sonnet, pricing: null }, { inputTokens: 1, outputTokens: 1 })).toBeNull();
    expect(estimateCost(sonnet, undefined)).toBeNull();
  });
});

describe("sumUsage", () => {
  it("adds up cache tokens across steps too", () => {
    expect(
      sumUsage([
        { inputTokens: 100, outputTokens: 10, inputTokenDetails: { cacheReadTokens: 60, cacheWriteTokens: 5 } },
        { inputTokens: 50, outputTokens: 5 },
      ]),
    ).toEqual({ inputTokens: 150, outputTokens: 15, inputTokenDetails: { cacheReadTokens: 60, cacheWriteTokens: 5 } });
  });
});

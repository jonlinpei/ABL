import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const generateText = vi.fn();
const captureAiGeneration = vi.fn();

vi.mock("ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("ai")>()),
  generateText: (...args: unknown[]) => generateText(...args),
}));
vi.mock("./providers", () => ({
  configuredProviders: () => ["anthropic"],
  toLanguageModel: (routed: { model: { id: string } }) => routed.model.id,
}));
vi.mock("./usage-events", () => ({
  captureAiGeneration: (...args: unknown[]) => captureAiGeneration(...args),
}));

const { AllModelsFailedError, generateStructured } = await import("./structured");

const call = () =>
  generateStructured({
    task: "requirements_build",
    userId: "user_1",
    instructions: "i",
    prompt: "p",
    schema: z.object({ ok: z.boolean() }),
    traceId: "trace_1",
  });

beforeEach(() => {
  generateText.mockReset();
  captureAiGeneration.mockReset().mockResolvedValue(undefined);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("generateStructured", () => {
  it("returns the primary model's output and reports the call", async () => {
    generateText.mockResolvedValueOnce({ output: { ok: true }, totalUsage: { inputTokens: 10, outputTokens: 5 } });
    const { output, trace } = await call();
    expect(output).toEqual({ ok: true });
    expect(trace.task).toBe("requirements_build");
    expect(trace.failedOver).toEqual([]);
    expect(captureAiGeneration).toHaveBeenCalledTimes(1);
    expect(captureAiGeneration.mock.calls[0]![3]).toBe("trace_1");
  });

  it("falls back to the next model, reporting the failure too", async () => {
    generateText
      .mockRejectedValueOnce(new Error("overloaded"))
      .mockResolvedValueOnce({ output: { ok: true }, totalUsage: {} });
    const { trace } = await call();
    expect(trace.failedOver).toHaveLength(1);
    expect(captureAiGeneration).toHaveBeenCalledTimes(2);
    expect(captureAiGeneration.mock.calls[0]![2]).toBeInstanceOf(Error);
  });

  it("throws AllModelsFailedError when every model fails", async () => {
    generateText.mockRejectedValue(new Error("down"));
    await expect(call()).rejects.toBeInstanceOf(AllModelsFailedError);
  });
});

import { auth } from "@clerk/nextjs/server";
import { generateText, NoObjectGeneratedError, Output } from "ai";
import { after } from "next/server";

import { configuredProviders, toLanguageModel } from "@/lib/ai/providers";
import { resolveModel } from "@/lib/ai/router";
import { finishTrace, startTrace, type CallTrace } from "@/lib/ai/trace";
import { captureAiGeneration } from "@/lib/ai/usage-events";
import { ROADMAP_SYSTEM_PROMPT, roadmapPrompt } from "@/lib/goals/prompts";
import { GoalBriefSchema, RoadmapSchema, type Roadmap } from "@/lib/goals/schema";

// Deep-tier planning can take a while.
export const maxDuration = 300;

export interface RoadmapResponse {
  roadmap: Roadmap;
  trace: CallTrace;
}

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return new Response("Unauthorized", { status: 401 });

  const body = await req.json();
  const parsed = GoalBriefSchema.safeParse(body?.brief);
  if (!parsed.success) {
    return Response.json({ error: "Invalid goal brief", issues: parsed.error.issues }, { status: 400 });
  }
  const brief = parsed.data;

  const providers = configuredProviders();
  if (providers.length === 0) {
    return Response.json(
      { error: "No AI provider key is configured. Set ANTHROPIC_API_KEY in .env.local." },
      { status: 503 },
    );
  }

  const { primary, fallbacks } = resolveModel("roadmap_generate", { allowedProviders: providers });
  const today = new Date().toISOString().slice(0, 10);
  const failedOver: string[] = [];
  // One PostHog trace for this request, so failovers group together.
  const traceId = crypto.randomUUID();

  // Try the primary model, then each fallback, as the router ordered them.
  for (const routed of [primary, ...fallbacks]) {
    const trace = startTrace("roadmap_generate", routed, [...failedOver]);
    const startedAt = Date.now();
    try {
      const result = await generateText({
        model: toLanguageModel(routed),
        instructions: ROADMAP_SYSTEM_PROMPT,
        prompt: roadmapPrompt(brief, today),
        output: Output.object({ schema: RoadmapSchema }),
      });
      const finished = finishTrace(trace, routed.model, result.totalUsage, startedAt);
      after(() => captureAiGeneration(userId, finished, undefined, traceId));
      const response: RoadmapResponse = { roadmap: result.output, trace: finished };
      return Response.json(response);
    } catch (err) {
      console.error(`[roadmap_generate] ${routed.model.id} failed`, err);
      // A response that fails schema parsing was still generated and billed.
      const usage = NoObjectGeneratedError.isInstance(err) ? err.usage : undefined;
      const failed = finishTrace(trace, routed.model, usage, startedAt);
      after(() => captureAiGeneration(userId, failed, err, traceId));
      failedOver.push(routed.model.id);
    }
  }

  return Response.json(
    { error: `Every eligible model failed: ${failedOver.join(", ")}. Check the server log.` },
    { status: 502 },
  );
}

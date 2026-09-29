/**
 * Model registry and allowlist.
 *
 * The registry describes every model the router knows about. The allowlist is
 * the subset that is allowed to serve real traffic. A model gets on the
 * allowlist only after it passes the eval suite for the tasks it may serve
 * (see docs/architecture.md, "AI router"). Adding a model to the registry does
 * not make it routable.
 *
 * Model IDs were checked against provider docs on 2026-09-24:
 * - Anthropic: platform.claude.com model table
 * - OpenAI: developers.openai.com/api/docs/models
 * - Google: ai.google.dev/gemini-api/docs/models
 */

export const PROVIDERS = ["anthropic", "openai", "google"] as const;
export type Provider = (typeof PROVIDERS)[number];

/** Rough capability and cost band. The router picks a tier per task. */
export const TIERS = ["fast", "standard", "deep"] as const;
export type Tier = (typeof TIERS)[number];

export interface ModelCapabilities {
  /** Supports schema-constrained JSON output (AI SDK `Output.object` / `generateObject`). */
  structuredOutput: boolean;
  /** Supports function / tool calling. */
  toolUse: boolean;
  /** Max input tokens. */
  contextWindow: number;
  /** Has a provider web search tool wired up in `webSearchTools`. */
  webSearch?: boolean;
}

export interface ModelPricing {
  /** USD per million input tokens. */
  inputPerMTok: number;
  /** USD per million output tokens. */
  outputPerMTok: number;
  /**
   * USD per million input tokens read from the prompt cache, and written to
   * it. When unset, cached tokens are priced as ordinary input, which
   * overstates cost rather than hiding it.
   */
  cacheReadPerMTok?: number;
  cacheWritePerMTok?: number;
  /** USD per web search request. */
  webSearchPerRequest?: number;
}

/**
 * Anthropic's prompt cache: reads at 10% of the input price, writes (5-minute
 * cache) at 125%. Web search is $10 per 1,000 searches.
 */
function anthropicPricing(inputPerMTok: number, outputPerMTok: number): ModelPricing {
  return {
    inputPerMTok,
    outputPerMTok,
    cacheReadPerMTok: inputPerMTok * 0.1,
    cacheWritePerMTok: inputPerMTok * 1.25,
    webSearchPerRequest: 0.01,
  };
}

export interface ModelSpec {
  /** Provider model ID, passed as-is to the AI SDK provider. */
  id: string;
  provider: Provider;
  tier: Tier;
  capabilities: ModelCapabilities;
  /** `null` when list pricing has not been verified. */
  pricing: ModelPricing | null;
  /** Preview models can change or disappear without notice. */
  status: "stable" | "preview";
}

/**
 * All known models. Within a tier, earlier entries are preferred by default,
 * so this order is the router's default tie-break.
 */
export const MODEL_REGISTRY: readonly ModelSpec[] = [
  // --- Anthropic ---
  {
    id: "claude-haiku-4-5",
    provider: "anthropic",
    tier: "fast",
    capabilities: { structuredOutput: true, toolUse: true, contextWindow: 200_000, webSearch: true },
    pricing: anthropicPricing(1, 5),
    status: "stable",
  },
  {
    id: "claude-sonnet-5",
    provider: "anthropic",
    tier: "standard",
    capabilities: { structuredOutput: true, toolUse: true, contextWindow: 1_000_000, webSearch: true },
    pricing: anthropicPricing(2, 10),
    status: "stable",
  },
  {
    // Note: forced tool_choice ("any"/"tool") returns a 400 on this model.
    // Use structured output or tool_choice "auto" for task calls.
    id: "claude-opus-5-5",
    provider: "anthropic",
    tier: "deep",
    capabilities: { structuredOutput: true, toolUse: true, contextWindow: 1_000_000, webSearch: true },
    pricing: anthropicPricing(4, 20),
    status: "stable",
  },

  // --- OpenAI ---
  {
    id: "gpt-6-luna",
    provider: "openai",
    tier: "fast",
    capabilities: { structuredOutput: true, toolUse: true, contextWindow: 1_050_000 },
    pricing: { inputPerMTok: 0.1, outputPerMTok: 0.5 },
    status: "stable",
  },
  {
    id: "gpt-6-sol",
    provider: "openai",
    tier: "standard",
    capabilities: { structuredOutput: true, toolUse: true, contextWindow: 1_050_000 },
    pricing: { inputPerMTok: 2, outputPerMTok: 10 },
    status: "stable",
  },
  {
    id: "gpt-6-astra",
    provider: "openai",
    tier: "deep",
    capabilities: { structuredOutput: true, toolUse: true, contextWindow: 1_050_000 },
    pricing: { inputPerMTok: 10, outputPerMTok: 50 },
    status: "stable",
  },

  // --- Google ---
  // TODO(pricing): Gemini list prices not verified; router treats unknown
  // pricing as "most expensive" when preferCheaper is set.
  {
    id: "gemini-3.5-flash-lite",
    provider: "google",
    tier: "fast",
    capabilities: { structuredOutput: true, toolUse: true, contextWindow: 1_048_576 },
    pricing: null,
    status: "stable",
  },
  {
    id: "gemini-3.8-flash",
    provider: "google",
    tier: "standard",
    capabilities: { structuredOutput: true, toolUse: true, contextWindow: 1_048_576 },
    pricing: null,
    status: "stable",
  },
  {
    // TODO(google-deep): Gemini Pro is preview-only as of 2026-09-24. Swap in
    // the stable Pro ID once Google ships one, then run evals before allowlisting.
    id: "gemini-3.1-pro-preview",
    provider: "google",
    tier: "deep",
    capabilities: { structuredOutput: true, toolUse: true, contextWindow: 1_048_576 },
    pricing: null,
    status: "preview",
  },
];

/**
 * Models cleared to serve traffic. Gate: the model passes the promptfoo eval
 * suite for every task it can be routed to. Preview models stay off.
 *
 * TODO(evals): no eval suite exists yet, so this list is provisional. It holds
 * every stable model in the registry until the first evals land.
 */
export const MODEL_ALLOWLIST: ReadonlySet<string> = new Set([
  "claude-haiku-4-5",
  "claude-sonnet-5",
  "claude-opus-5-5",
  "gpt-6-luna",
  "gpt-6-sol",
  "gpt-6-astra",
  "gemini-3.5-flash-lite",
  "gemini-3.8-flash",
]);

export function getModel(id: string): ModelSpec | undefined {
  return MODEL_REGISTRY.find((m) => m.id === id);
}

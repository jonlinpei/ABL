import {
  MODEL_ALLOWLIST,
  MODEL_REGISTRY,
  type ModelSpec,
  type Provider,
  type Tier,
} from "./models";
import { TASK_ROUTES, type TaskRequirements, type TaskType } from "./tasks";

/**
 * User settings that narrow the router's choice. They never name a model
 * directly: the router still decides, inside these limits.
 */
export interface UserPrefs {
  /** Only use these providers. Omit or leave empty for "any provider". */
  allowedProviders?: readonly Provider[];
  /** Within a tier, rank cheaper models first. Never drops to a lower tier. */
  preferCheaper?: boolean;
  /**
   * Bring-your-own-key. Models from this provider are billed to the user's key
   * and ranked first within each tier.
   */
  byok?: { provider: Provider; apiKey: string };
}

export interface RoutedModel {
  model: ModelSpec;
  /** Whose API key pays for the call. */
  keySource: "byok" | "platform";
}

export interface ModelResolution {
  task: TaskType;
  /** Best eligible model. */
  primary: RoutedModel;
  /** Remaining eligible models, in the order to try them if `primary` fails. */
  fallbacks: RoutedModel[];
}

export interface RouterConfig {
  registry?: readonly ModelSpec[];
  allowlist?: ReadonlySet<string>;
}

export class NoEligibleModelError extends Error {
  readonly task: TaskType;
  readonly requires: TaskRequirements;

  constructor(task: TaskType, requires: TaskRequirements, detail: string) {
    super(
      `No allowlisted model can serve task "${task}". ` +
        `Required: ${describeRequirements(requires)}. ${detail}`,
    );
    this.name = "NoEligibleModelError";
    this.task = task;
    this.requires = requires;
  }
}

export class InvalidUserPrefsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidUserPrefsError";
  }
}

/**
 * Pick the best allowlisted model for a task within the user's limits.
 *
 * Order of candidates:
 * 1. Tier: the task's default tier, then each fallback tier in order.
 * 2. Within a tier: BYOK provider first, then (if preferCheaper) lowest
 *    blended price, then registry order.
 *
 * Throws NoEligibleModelError when nothing qualifies, so a misconfigured
 * allowlist or overly narrow user settings fail loudly instead of silently
 * using a model that can't do the job.
 */
export function resolveModel(
  task: TaskType,
  userPrefs: UserPrefs = {},
  config: RouterConfig = {},
): ModelResolution {
  const registry = config.registry ?? MODEL_REGISTRY;
  const allowlist = config.allowlist ?? MODEL_ALLOWLIST;
  const route = TASK_ROUTES[task];
  if (!route) {
    throw new Error(`Unknown task type "${String(task)}".`);
  }

  const allowedProviders =
    userPrefs.allowedProviders && userPrefs.allowedProviders.length > 0
      ? new Set(userPrefs.allowedProviders)
      : null;

  if (userPrefs.byok) {
    if (!userPrefs.byok.apiKey.trim()) {
      throw new InvalidUserPrefsError(
        `BYOK key for provider "${userPrefs.byok.provider}" is empty.`,
      );
    }
    if (allowedProviders && !allowedProviders.has(userPrefs.byok.provider)) {
      throw new InvalidUserPrefsError(
        `BYOK provider "${userPrefs.byok.provider}" is not in allowedProviders ` +
          `(${[...allowedProviders].join(", ")}).`,
      );
    }
  }

  const tierOrder = dedupe<Tier>([route.tier, ...route.fallback]);

  const allowlisted = registry.filter((m) => allowlist.has(m.id));
  const providerOk = allowlisted.filter(
    (m) => !allowedProviders || allowedProviders.has(m.provider),
  );
  const capable = providerOk.filter((m) => meetsRequirements(m, route.requires));
  const inTiers = capable.filter((m) => tierOrder.includes(m.tier));

  if (inTiers.length === 0) {
    throw new NoEligibleModelError(
      task,
      route.requires,
      explainEmpty({
        allowlisted: allowlisted.length,
        providerOk: providerOk.length,
        capable: capable.length,
        tiers: tierOrder,
        allowedProviders,
      }),
    );
  }

  const ordered: RoutedModel[] = [];
  for (const tier of tierOrder) {
    const tierModels = inTiers
      .filter((m) => m.tier === tier)
      .map((m, index) => ({ m, index }))
      .sort((a, b) => compareWithinTier(a, b, userPrefs));
    for (const { m } of tierModels) {
      ordered.push({
        model: m,
        keySource: userPrefs.byok?.provider === m.provider ? "byok" : "platform",
      });
    }
  }

  const [primary, ...fallbacks] = ordered;
  return { task, primary: primary!, fallbacks };
}

export function meetsRequirements(model: ModelSpec, req: TaskRequirements): boolean {
  const c = model.capabilities;
  if (req.structuredOutput && !c.structuredOutput) return false;
  if (req.toolUse && !c.toolUse) return false;
  if (req.webSearch && !c.webSearch) return false;
  if (req.minContextWindow !== undefined && c.contextWindow < req.minContextWindow) {
    return false;
  }
  return true;
}

function compareWithinTier(
  a: { m: ModelSpec; index: number },
  b: { m: ModelSpec; index: number },
  prefs: UserPrefs,
): number {
  if (prefs.byok) {
    const aByok = a.m.provider === prefs.byok.provider ? 0 : 1;
    const bByok = b.m.provider === prefs.byok.provider ? 0 : 1;
    if (aByok !== bByok) return aByok - bByok;
  }
  if (prefs.preferCheaper) {
    const diff = blendedPrice(a.m) - blendedPrice(b.m);
    if (diff !== 0) return diff;
  }
  return a.index - b.index;
}

/**
 * Single number for ranking by cost. Assumes a 3:1 input:output token mix,
 * which is typical for tutoring prompts with long context and short answers.
 * Unknown pricing sorts last.
 */
export function blendedPrice(model: ModelSpec): number {
  if (!model.pricing) return Number.POSITIVE_INFINITY;
  return (3 * model.pricing.inputPerMTok + model.pricing.outputPerMTok) / 4;
}

function describeRequirements(req: TaskRequirements): string {
  const parts: string[] = [];
  if (req.structuredOutput) parts.push("structuredOutput");
  if (req.toolUse) parts.push("toolUse");
  if (req.webSearch) parts.push("webSearch");
  if (req.minContextWindow !== undefined) {
    parts.push(`contextWindow >= ${req.minContextWindow}`);
  }
  return parts.length > 0 ? parts.join(", ") : "none";
}

function explainEmpty(s: {
  allowlisted: number;
  providerOk: number;
  capable: number;
  tiers: readonly Tier[];
  allowedProviders: Set<Provider> | null;
}): string {
  if (s.allowlisted === 0) return "The model allowlist is empty.";
  if (s.providerOk === 0) {
    return `No allowlisted model belongs to the allowed providers (${[
      ...(s.allowedProviders ?? []),
    ].join(", ")}).`;
  }
  if (s.capable === 0) {
    return "No allowlisted model from the allowed providers meets the requirements.";
  }
  return `Capable models exist, but none in tiers ${s.tiers.join(" -> ")}.`;
}

function dedupe<T>(items: readonly T[]): T[] {
  return [...new Set(items)];
}

// Server-only: reads provider API keys from the environment.
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";

import type { Provider } from "./models";
import type { RoutedModel, UserPrefs } from "./router";

const PLATFORM_KEY_ENV: Record<Provider, string> = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  google: "GOOGLE_GENERATIVE_AI_API_KEY",
};

/** Providers that have a platform API key set in this environment. */
export function configuredProviders(): Provider[] {
  return (Object.keys(PLATFORM_KEY_ENV) as Provider[]).filter(
    (p) => !!process.env[PLATFORM_KEY_ENV[p]]?.trim(),
  );
}

/**
 * Turn a routed model into an AI SDK LanguageModel, using the user's BYOK key
 * when the router marked it as BYOK, otherwise the platform key.
 */
export function toLanguageModel(routed: RoutedModel, prefs: UserPrefs = {}): LanguageModel {
  const { provider, id } = routed.model;
  const apiKey =
    routed.keySource === "byok" && prefs.byok?.provider === provider
      ? prefs.byok.apiKey
      : process.env[PLATFORM_KEY_ENV[provider]];

  if (!apiKey) {
    throw new Error(
      `Missing API key for provider "${provider}" (set ${PLATFORM_KEY_ENV[provider]}).`,
    );
  }

  switch (provider) {
    case "anthropic":
      return createAnthropic({ apiKey })(id);
    case "openai":
      return createOpenAI({ apiKey })(id);
    case "google":
      return createGoogleGenerativeAI({ apiKey })(id);
  }
}

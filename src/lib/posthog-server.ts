// Server-only PostHog client for capturing events from route handlers,
// server actions and background jobs.
import { PostHog } from "posthog-node";

let client: PostHog | null | undefined;

/**
 * Returns a shared PostHog client, or null when analytics is not configured.
 * Serverless functions can exit before a batch is sent, so either call
 * `await posthog.shutdown()` or use `captureServerEvent`, which flushes.
 */
export function getPostHogServer(): PostHog | null {
  if (client !== undefined) return client;
  const token = process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN;
  client = token
    ? new PostHog(token, {
        host: process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://us.i.posthog.com",
        flushAt: 1,
        flushInterval: 0,
      })
    : null;
  return client;
}

export async function captureServerEvent(
  distinctId: string,
  event: string,
  properties?: Record<string, unknown>,
): Promise<void> {
  const ph = getPostHogServer();
  if (!ph) return;
  ph.capture({ distinctId, event, properties });
  await ph.flush();
}

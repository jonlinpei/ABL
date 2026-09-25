import { neon } from "@neondatabase/serverless";
import { drizzle, type NeonHttpDatabase } from "drizzle-orm/neon-http";

import * as schema from "./schema";

let cached: NeonHttpDatabase<typeof schema> | undefined;

/**
 * Lazily create the Drizzle client over Neon's HTTP driver. Lazy so that
 * importing this module (e.g. during `next build`) doesn't require DATABASE_URL.
 */
export function getDb(): NeonHttpDatabase<typeof schema> {
  if (!cached) {
    const url = process.env.DATABASE_URL;
    if (!url) {
      throw new Error("DATABASE_URL is not set. See .env.example.");
    }
    cached = drizzle({ client: neon(url), schema });
  }
  return cached;
}

export { schema };

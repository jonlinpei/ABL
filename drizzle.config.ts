import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

// Next.js reads .env.local; drizzle-kit runs outside Next, so load it here.
config({ path: [".env.local", ".env"], quiet: true });

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    // Use the direct (non-pooled) Neon connection string for migrations.
    url: process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL ?? "",
  },
  strict: true,
  verbose: true,
});

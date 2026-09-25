# ABL

A personal learning tutor for adults. ABL plans a learner's path around their goals and fits it to the time they actually have.

**Status:** Pre-development. The product spec is in draft and the app skeleton is in place.

## Docs

- [Product Requirements (PRD)](docs/prd.md): problem, goals, features, user stories, acceptance criteria and open questions.
- [Business model](docs/business-model.md): pricing, the 14-day trial and its activity-based responses, AI cost budget and the path to BYOK.
- [Content strategy](docs/content.md): launch subject areas, goal discovery, the source library, the AI and human review pipeline, observability and the data model.
- [Architecture](docs/architecture.md): stack decisions, the reasoning for each, the AI router design and open decisions.

## Stack

- **App:** Next.js (App Router, TypeScript strict) and Tailwind CSS, hosted on Vercel. Web first, then a PWA, then Expo native apps.
- **Data:** Postgres on Neon with Drizzle ORM. The mastery graph will be Postgres tables, with pgvector added later.
- **Auth:** Clerk.
- **Analytics:** PostHog on the client and server.
- **AI:** Vercel AI SDK with Anthropic, OpenAI and Google, behind a task-based router in `src/lib/ai/` that uses an eval-gated model allowlist.
- **Planned:** FSRS for spaced review, Inngest or Trigger.dev for background jobs, Langfuse or PostHog LLM analytics, promptfoo evals.

See [docs/architecture.md](docs/architecture.md) for the reasoning.

## Setup

Requirements: Node.js 22.12 or later (Vitest needs it) and pnpm 10.

1. Install dependencies:

   ```sh
   pnpm install
   ```

2. Create your local env file and fill it in:

   ```sh
   cp .env.example .env.local
   ```

   You need Clerk keys to run the app; the build works without them. You need a Neon `DATABASE_URL` to run migrations. PostHog and the AI provider keys are optional for local work.

3. Apply the database migrations:

   ```sh
   pnpm db:migrate
   ```

## Run

```sh
pnpm dev          # dev server at http://localhost:3000
pnpm build        # production build
pnpm start        # serve the production build
```

### Demo: goal discovery → first roadmap

Sign in and open `/app`. Pick a subject area or describe a goal. The tutor asks a few questions (`goal_discover`, standard tier), then shows a goal brief for you to confirm. Confirming builds a first roadmap (`roadmap_generate`, deep tier, with fallbacks). Each AI call shows the routed model, tokens, estimated cost and latency, and the "Router trace" panel totals them.

You need real Clerk keys and at least one AI provider key (e.g. `ANTHROPIC_API_KEY`). The demo routes only to providers whose key is set. Nothing is saved to the database yet.

## Checks

```sh
pnpm typecheck    # generate Next.js route types, then tsc --noEmit
pnpm lint         # ESLint
pnpm test         # Vitest (AI router tests)
```

## Database

```sh
pnpm db:generate  # write a SQL migration to drizzle/ from src/db/schema.ts
pnpm db:migrate   # apply migrations to DATABASE_URL_UNPOOLED or DATABASE_URL
pnpm db:studio    # browse the database in Drizzle Studio
```

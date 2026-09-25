# ABL Content Strategy and Review Pipeline

**Status:** Decided (v1 direction) · **Date:** 2026-09-24

This file answers PRD Open Questions 5 (launch subject areas) and 7 (where content comes from). It defines how content is made, reviewed and traced. Pricing constraints are in [business-model.md](business-model.md). Stack decisions are in [architecture.md](architecture.md).

## Decisions

| Area | Decision |
|---|---|
| Content model | **Hybrid, entirely in the app.** Each subject area has a reviewed skill map. Lessons are written by AI and grounded in a source library we store. The core of each lesson is cached and shared across learners; only a thin layer is personalized. No external links on the main learning path. |
| Launch subject areas | (1) California real estate salesperson exam and Bay Area residential real estate, (2) data analytics, (3) AI at work. |
| Review | **AI reviewer agents do the ongoing review. People review by exception.** A person approves each skill-map version, handles escalations, and checks a random sample to keep the AI reviewers honest. |
| Observability | Everything that is generated, reviewed, approved or served can be traced from what a learner sees back to its sources, prompts, models, reviewers and human decisions. |
| Region | English, US-focused in v1. Real estate is specific to California; data analytics and AI at work are not tied to a region. |

## Launch subject areas

Real estate and AI at work are the founder's own goals, so the founder is the first learner there, which gives a fast feedback loop. Data analytics matches the PRD's career-pivoter scenario (Maya). Each area needs its own safeguards.

### 1. California Real Estate Salesperson exam, then Bay Area residential expertise

| | |
|---|---|
| Outcome | Pass the state exam, a clear and checkable result (PRD Goal 3), then build working local expertise. |
| Scope limit | The California Department of Real Estate (DRE) requires three approved pre-license college-level courses before the exam. ABL is **not** accredited (PRD non-goal), so it complements those courses as exam prep and deeper understanding. It must never present itself as a replacement. |
| Skill map anchor | The DRE's published exam content outline and topic weights. `[VERIFY against the current DRE outline before building the map]` |
| Grounding sources | California statutes and regulations (public), DRE publications (check their terms), and local ordinances (e.g. rent control and transfer taxes by city). |
| Special checks | Practice questions must be original. Real exam questions are confidential and must never be used or copied. **Fair housing:** content must never model steering or discriminatory practice; this has its own reviewer. Bay Area market facts go out of date quickly, so they carry an "as of" date and get freshness checks. |
| In-app practice | A timed exam simulator weighted like the real exam, plus scenario role-plays (disclosures, agency situations). |

### 2. Data analytics

| | |
|---|---|
| Outcome | Job-ready analysis skills: spreadsheets, SQL, basic statistics, data visualization and communicating findings. Plus, depending on the goal, Python or a BI tool. This is the PRD's Maya scenario. |
| Evidence of skill | Skill checks are real tasks: a query that returns the right result, or a chart that answers the question. The learner also finishes with a small portfolio of projects built from their own work (PRD Goal 3). |
| Grounding sources | Plenty of material can be stored in full: open-source documentation (PostgreSQL, DuckDB, pandas), openly licensed textbooks (e.g. OpenIntro Statistics, CC BY-SA), and public datasets with clear licenses. Proprietary tools (Excel, Tableau, Power BI) are cited and summarized, not reproduced. |
| Special checks | **Code is run, not trusted.** Every SQL or Python example and answer key is executed in a sandbox, and the result must match what the lesson says. Grading works the same way: the learner's query runs and its output is compared, which is deterministic and cheap. Tool-specific UI steps carry an "as of" date. |
| In-app practice | An **SQL and Python sandbox in the browser** (e.g. DuckDB-WASM or Pyodide) loaded with practice datasets. It keeps learners in the app, runs on their own device so it costs us almost no compute, and makes practice hands-on. |
| Privacy | Learners may be tempted to paste real work data. The sandbox warns against pasting confidential or personal data, and we don't keep pasted data beyond the session. `[NEEDS INPUT: confirm]` This applies to AI at work too. |

### 3. AI at work: understand it and use it

| | |
|---|---|
| Outcome | Understand what AI, machine learning and LLMs are and how they behave, then use them in the learner's own job for measurable gains. |
| Grounding sources | Vendor documentation, well-known explainers and papers. Licenses vary: for anything copyrighted we store summaries and citations, never the full text. |
| Special checks | **Content goes out of date fastest here.** Model names, features and prices change every few months, so claims about specific products carry an "as of" date and are rechecked often. Explanations of basic concepts go out of date slowly. |
| In-app practice | The easiest area to keep entirely in the app, because the tutor is itself an AI. Practice is hands-on: write a prompt in a sandbox, see the result, and get feedback tied to the learner's real work tasks. Sandbox calls use the fast tier and count against the learner's soft cost limit. |

## Goal discovery (the first step)

Before any assessment or plan, the tutor finds out **what the learner wants, and why**, and agrees the goal with them. Everything after this depends on it:

- the assessment tests what matters for this goal;
- the plan is built toward it;
- personalization uses its context;
- the Plan reviewer checks the plan against it.

A plan built on a misunderstood goal wastes the learner's scarce time, the exact failure ABL exists to prevent.

### What discovery captures

The result is a structured **goal brief**:

| Field | Examples |
|---|---|
| Goal, in their words and restated | "Pass the CA salesperson exam", restated as a checkable outcome |
| Why: the motivation | Career change, side income, buying a home, a boss's request |
| What success looks like | A passed exam; filing their own return confidently; saving 5 hours a week at work |
| Deadline or key dates | Exam date, filing deadline, a performance review |
| Starting point, as they describe it | Pre-license courses done? Written SQL before? Uses ChatGPT daily? |
| Constraints | Weekly hours, preferred session length and time of day, energy |
| Past attempts | What they tried and why it stopped, which feeds the Keep-Going Engine |
| Speed, depth or practical results | PRD story 10 |
| Interests and work context | Material for analogies and examples (F5) |

### Questions specific to each subject area

The tutor asks only what's missing and infers the rest from what the learner already said.

- **Real estate**
  - Pre-license courses: done, in progress, or not started?
  - Target exam date?
  - The end goal: a full-time agent, part-time, an investor, or understanding their own home purchase?
  - Which Bay Area counties or cities?
- **Data analytics**
  - The end goal: a new analyst job, analysis in their current role, or a specific project?
  - Target role or deadline, if any.
  - Current tools: spreadsheets, SQL, Python, a BI tool?
  - What data they work with now, described in general terms rather than pasted.
  - Any tools their target employer requires?
- **AI at work**
  - Role, and the tasks that take up their week.
  - Their current AI use.
  - Which tools their employer allows, and any AI policy that limits what they can do.

### How it works

- **Conversational and short.** It fits inside the 10-minute onboarding target (PRD Goal 4), and asks only for what matters. If a goal is vague, the tutor offers 2–3 more specific goals to choose from (PRD story 1).
- **The learner confirms the brief.** The tutor plays it back ("Here's what I heard…"), and the learner edits it and approves it before any assessment or plan starts. The brief stays viewable and editable under "what my tutor knows" (PRD story 9).
- **The brief is revisited over time.** Goals change. Replanning, restart weeks and milestones all ask "is this still your goal?" A changed brief creates a new plan version.
- **Checked like any other output.** Deterministic checks confirm the required fields are present and the goal is in a supported subject area. A goal outside the supported areas gets an honest "not yet" instead of a weak plan. The Plan reviewer then checks that the plan serves the brief.

`[NEEDS INPUT]` PRD story 1 limits clarification to "up to 3 clarifying questions." Discovery as described here may need a few more turns. Suggested replacement: "Discovery asks only for missing information, finishes within the 10-minute onboarding budget, and ends with a brief the learner confirms."

## Content model

```
Goal discovery ─► confirmed goal brief ─► assessment ─► plan (see Learner plan below)

Source library (sources, chunks, embeddings; license and effective dates)
        │  grounds
        ▼
Skill map, versioned per subject area (topics, prerequisites, objectives, exam weights, risk level)
        │  human approves each version
        ▼
Content items, versioned (lessons, worked examples, practice, assessment questions)
        │  AI reviewers, and people for escalations and samples
        ▼
Published content (shared across learners, cached)
        │  thin personalization at serve time (analogies, pace, the learner's own examples)
        ▼
Learner plan (per learner, built only from published topics)
```

**Keeping learners in the app** means every lesson is taught in ABL, grounded in stored sources, and shows its citations ("where this comes from"). The source library is what makes that possible:

- **Can be stored in full:** public-domain material (e.g. statutes) and permissively licensed material (open-source docs, CC-licensed textbooks, open datasets).
- **Copyrighted material:** summarized and cited, never reproduced.
- **Every source record** stores its license, the date it was retrieved, the date it takes effect (e.g. a statute version or software release), and a hash of its content so we can detect changes.

**Consequences for the stack:**

- **pgvector moves from "later" to now**, for looking up sources during generation, review and sidekick answers.
- **Background jobs are needed now** for the generation and review pipeline. Recommendation: **Inngest**, for durable multi-step functions that fan out to parallel reviewers and retry each step. `[confirm vs Trigger.dev]`

## Review pipeline

Here, the "reviewer agents" are **independent, single-purpose AI reviewers run as steps in a durable workflow**. They are not free-roaming autonomous agents. Each reviewer gets the item, its cited source text and a rubric, and returns a structured verdict. This makes them predictable, cheap, repeatable and easy to trace. A reviewer can look up extra sources as a tool when it needs more context.

```
generate ─► deterministic checks ─► parallel AI reviewers ─► aggregate ─┬─► publish
               │ fail                                                  ├─► revise (auto-retry with findings, max 2)
               ▼                                                       └─► escalate to a person
            revise
```

### Stage 1: Deterministic checks (no AI)

- Output matches its schema.
- Every claim has a citation, and every citation points to a real source chunk.
- The source is current: its effective date matches the item's.
- Code examples and answer keys run in the sandbox and produce the output the item states (data analytics).
- Topic prerequisites are covered earlier in the map.
- Estimated time fits the topic's budget.
- For plans: each week fits within the learner's stated hours (PRD story 3).

### Stage 2: AI reviewers

| Reviewer | Checks | Applies to |
|---|---|---|
| **Grounding** | Every claim is supported by the cited source text. Unsupported claims are flagged with a quote. | All content |
| **Currency** | Nothing contradicts the effective date. Flags anything that changes over time and lacks an "as of" date. | All content; rechecked often for AI and for Bay Area market facts |
| **Pedagogy** | Objectives can be measured, the order builds understanding, the language is plain, jargon is defined (Pillar 4), and it fits a busy adult's session. | Lessons, skill maps |
| **Assessment** | Exactly one defensible answer, plausible wrong answers, an answer key that matches the sources, original questions (not real exam questions), and coverage matching the exam weights. | Questions, exam simulator |
| **Scope & safety** | Stays within scope (education, not legal advice) and shows disclaimers where needed. Fair-housing compliance for real estate. No discriminatory content. | All content, strictest for high-risk topics |
| **Plan** | The plan follows the skill map, respects prerequisites, fits the time budget, and the goal it states matches what the learner asked for. | Learner plans (a sample, see below) |

Rules:

- **The reviewer uses a different provider from the generator where possible.** Models from the same provider tend to make the same mistakes. The router gets a `mustDifferFrom` constraint for this.
- **Reviewers return structured verdicts:** `pass` / `revise` / `escalate`, a score for each rubric item, findings with evidence quotes, and a confidence level.
- **Reviewer prompts and rubrics are versioned** and have their own promptfoo evals, seeded with items people have labeled.

### Stage 3: People review by exception

| What | When a person looks |
|---|---|
| **Skill-map versions** | Every version before it's published. These are rare: a few per subject area per year, and they have the most impact. |
| **Content items** | Only when an item is escalated: reviewers disagree, confidence is low, the rubric score is below the threshold, the topic is high-risk (legal requirements, fair housing, agency and disclosure duties) and the item is new, or learners have flagged it. |
| **Random sample** | About 5% of items that passed AI review, used to measure how often the AI reviewers miss something. |
| **Learner plans** | Never routinely. Plans get deterministic checks, plus AI review on a sample. |

**Calibrating the reviewers:** track how often people agree with each AI reviewer's decisions on the sample. If a reviewer misses issues that people catch, tighten its rubric or change its model, and raise its sampling rate until agreement recovers. The goal is for human review time to fall as confidence rises, without losing quality.

### Stage 4: After publishing

- Learners can flag any lesson ("this seems wrong or unclear"). Flags send the item back into review.
- Sidekick questions that cluster on one lesson suggest it explains something poorly. They trigger a pedagogy re-review.
- Scheduled rechecks: real estate content when California law or DRE rules change, and Bay Area market facts regularly; AI content every quarter; data-analytics tool steps when a major version ships; source changes detected by comparing content hashes.
- **Versioning:** content is never edited in place. A fix creates a new version, and learners already mid-lesson finish the version they started.

## Observability

We want to be able to answer: why did this learner see this sentence, and who or what approved it?

| Layer | Records |
|---|---|
| **Postgres (system of record, controls publishing)** | Immutable versions of every skill map, content item and plan. Every generation and review run: model, prompt version, rubric version, inputs, verdict, scores, findings, tokens, cost, latency and trace id. Every human decision, with who made it and why. Which content was served to which learner. |
| **LLM tracing** | Nested traces for each pipeline run: generate → checks → each reviewer → aggregate → retry. The Postgres records link to them by trace id. Recommendation: **Langfuse**. Its nested traces, prompt versioning, score tracking and human annotation fit this pipeline better than product analytics does. PostHog stays for product analytics and cost per learner, joined on user id. `[confirm]` |
| **Internal review console** (`/admin`) | The escalation queue. A lineage view that goes from a served lesson to its versions, reviews, sources and traces. Dashboards for reviewer agreement, pass/revise/escalate rates, cost per published item, and content due for recheck. |
| **Learner-facing** | Citations on every lesson ("where this comes from"), "as of" labels, and a flag button. This extends PRD story 9: learners can see how their content was built. |

## Data model (to build next)

**Content side:**

| Table | Key fields |
|---|---|
| `domains` | Slug, title, status |
| `sources` | Domain, title, publisher, URL, license, retrieved at, effective date, content hash |
| `source_chunks` | Source, locator (section or page), text, embedding (pgvector) |
| `skill_map_versions` | Domain, version, status, approver, approved at |
| `topics` | Skill-map version, slug, title, objectives, exam weight, risk level, estimated minutes |
| `topic_edges` | From, to, kind (prerequisite or related) |
| `content_items` | Topic, kind (lesson, example, practice, question), version, status, body, effective date |
| `content_citations` | Content item, claim reference, source chunk |
| `pipeline_runs` | Subject, stage, model, prompt version, tokens, cost, latency, trace id |
| `review_verdicts` | Pipeline run, reviewer kind, rubric version, verdict, scores, findings, confidence |
| `human_reviews` | Subject, reviewer, decision, notes |
| `content_flags` | Learner, content item, reason, status |

**Learner side:**

| Table | Key fields |
|---|---|
| `goals` | Learner's goal |
| `goal_briefs` | Versioned, learner-confirmed brief, linked to a goal |
| `plans` | Plan versions |
| `plan_items` | Items in a plan |
| `mastery` | Per learner and topic, with FSRS state |
| `learner_glossary` | Terms the learner has met |
| `content_served` | Which content version each learner saw |
| `ai_usage` | Metering for each AI call |
| `subscriptions` | Plan state, from [business-model.md](business-model.md) |

## Open

- Confirm the privacy position: warn against pasting confidential work data into sandboxes, and don't keep pasted data beyond the session.
- Confirm Inngest and Langfuse.
- Who is the human reviewer for each subject area? The founder can cover AI at work. Real estate benefits from a licensed California agent or broker, and data analytics from a working analyst. Each would review every skill-map version and a sample of content, even if only part-time.
- Verify the current DRE exam content outline and whether DRE publications can be stored.

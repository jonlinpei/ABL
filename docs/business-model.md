# ABL Business Model

**Status:** Decided (v1) · **Date:** 2026-09-24

This file records the pricing, trial and AI-cost decisions for v1 and the reasoning behind them. It answers PRD Open Question 6. Technical consequences are in [architecture.md](architecture.md).

## Decisions

| Area | Decision |
|---|---|
| Price | **$20/month**. Annual plan to be priced (working figure about $160/year). |
| Trial | **14-day free trial**, with activity tracked so we can respond to how the learner is actually doing (see [Trial](#trial)). |
| Who pays for AI | **Bundled.** ABL pays and the cost is in the price. Learners never see tokens, keys or meters. |
| Target user (v1) | Non-technical learners. |
| BYOK | Not in v1. The design keeps a clear path to it (see [Path to BYOK](#path-to-byok)). |
| Side quests | Included in the subscription at no extra cost. This answers the "free" question in PRD Pillar 3. |

## Unit economics at $20/month

| Line | Per paying learner per month |
|---|---|
| Revenue | $20.00 |
| Payment fees (about 3% + $0.30) | about $0.90 |
| Hosting, database, auth, analytics | about $0.50–1.00 at early scale (estimate) |
| **AI budget for about 70% gross margin** | **about $5** |

AI cost estimates (rough, not measured), for a learner at about 3 hours a week:

- **AI guides, curated content teaches:** about $2–3. Well within budget.
- **AI is the live tutor for every session:** about $8–10, and heavy users about $20. Over budget unless lessons are cached and shared between learners, and cheap tasks go to cheap models.

The content decision (PRD Open Question 7) decides which of these we are in. See [architecture.md § Open decisions](architecture.md#open-decisions).

**Cost guardrails:**

- Meter the cost of every AI call per user in Postgres. This is also needed for BYOK later.
- The router gets a **soft monthly limit per user**, working figure $10. Above it, tasks drop to cheaper tiers where evals show quality holds. Learners are never cut off mid-lesson.
- Track **AI cost per active learner** as a standing metric in PostHog.

## Trial

A 14-day trial, one per person. **Recommendation:** no card at signup. The target user is hesitant and has quit before, so the first step should cost nothing. Asking for a card upfront raises conversion but cuts the number of people who start. `[NEEDS INPUT: confirm no card upfront]`

### What we track

We use data we already collect (PostHog events plus rows in Postgres):

| Signal | Why it matters |
|---|---|
| Onboarding done (goal, assessment, roadmap) | The learner got to a plan |
| Sessions completed, and minutes spent learning | The core habit |
| First milestone reached | PRD Goal 1, and the best sign of value |
| Days active | Whether it has become a habit, or was a single burst |
| Sidekick and side-quest use | Curiosity and engagement |
| Missed scheduled sessions | "Life got in the way", which the Keep-Going Engine exists to handle |

### Segments and responses

We sort each learner into a segment on **day 10**, early enough to act before the trial ends. We check again on day 14.

| Segment | Rule (starting point, to be tuned) | Response |
|---|---|---|
| **Engaged** | First milestone reached, or 3+ sessions | Push to subscribe from day 10. Show a progress summary ("here's what you can do now that you couldn't on day 1"). Offer the annual plan. |
| **Stalled** | Roadmap made, 1–2 sessions, then quiet | Offer a **7-day extension that starts with a lighter "restart" week**. The extension starts when they complete a session, not just by clicking a button, so it rewards coming back. |
| **Never started** | Signed up, but no roadmap or no session | Short re-onboarding nudge. Offer the same extension, which starts on their first session. |
| **Life got in the way** | Was active, then missed several scheduled sessions | Offer to **hold their plan**: the trial pauses, and we check in on a date they pick. |

Other rules:

- **One extension per person.** This limits abuse.
- **Trial ends without a subscription:** the account moves to a free **"Keep my plan"** mode. The roadmap, mastery graph and glossary stay readable, and there's no AI tutoring. It costs almost nothing, keeps the door open, and avoids the "I lost everything" feeling that makes returning harder.
- **Paid subscribers get the same pause option.** "Pause for a month" instead of cancel (the Keep-Going Engine applied to billing).
- **Trial AI spend:** capped with the same soft limit, pro-rated. That's about $5 for 14 days.

### Trial metrics

- Trial → paid conversion, overall and by segment
- Extension → paid conversion
- "Keep my plan" → paid reactivation within 90 days
- Share of trial users who reach the first milestone by day 14 (PRD Goal 1)

## Path to BYOK

v1 does not have BYOK. These pieces go in now because they cost little and keep BYOK possible:

- The router already supports a user-supplied key and marks each call's `keySource`.
- Every AI call logs `keySource`, model, tokens and cost. The same metering drives the soft limit.
- User AI settings live in one place, so a BYOK setting is an addition, not a rewrite.

Later, when we add BYOK:

1. **Who it's for:** power users, and privacy-minded users who want calls billed to their own provider account.
2. **Pricing:** a lower "Bring your own AI" plan, likely $8–10/month. They pay for the product, not the tokens.
3. **Key storage:** encrypted at rest (envelope encryption with a KMS), never logged, and checked with a cheap test call when saved.
4. **Models:** BYOK calls still use only allowlisted models, so learning quality stays eval-backed.
5. **Failures:** no silent fallback to platform-paid models. If a user's key fails (bad key, quota, outage), show a clear message and offer a switch to the bundled plan. A silent fallback would surprise someone with a bill, either us or them.
6. **Out of scope:** local or arbitrary models, because we can't evaluate them.

## Open

- Card upfront or not (recommendation: not)
- Annual price
- Billing provider. Stripe is the default. Clerk Billing runs on Stripe and would tie subscription state to the Clerk user. Evaluate when we build billing.

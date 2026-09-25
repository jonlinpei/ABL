# PRD: ABL — Personal Learning Tutor for Adults

**Status:** Draft · **Date:** 2026-09-24 · **Owner:** [NEEDS INPUT]

> `[NEEDS INPUT]` What does "ABL" stand for? This draft uses it as the product name.

---

## 1. Problem Statement

Adults stop learning, but the world keeps changing, and they fall behind.

In school, the institution does the planning. It sets the curriculum, the pace and the checkpoints, and students get some choice inside that structure. Once people leave school, all of that becomes their job. Most adults have no framework for it.

At the same time, life gets busier. Work, family and other responsibilities use up time, energy and focus. Adults end up just keeping up with their jobs and lives, and growth gets pushed aside. Each missed attempt to learn something makes the next attempt feel less possible. Feeling helpless leads to more helplessness.

People already pay personal trainers and coaches for their bodies and careers. Very few have anything like that for learning. **ABL is a personal tutor that plans an adult's learning around their goals and fits it to their life.** It aims for the best mix of speed, depth and real results.

**Why now:** `[ASSUMPTION]` AI can now tailor lessons to one person cheaply. Skills also go out of date faster than they used to. Together, that makes a 1:1 tutor affordable at scale for the first time.

## 2. Goals

1. Get **40% of new users** to finish their first personalized learning plan milestone within 14 days of signing up. `[ASSUMPTION]`
2. Keep **30% of users** active every week at day 60. `[ASSUMPTION]`
3. Get **50% of users** who finish a plan to report they can do something they couldn't before, measured by self-report plus a skill check, within 90 days. `[ASSUMPTION]`
4. Keep the median time a user needs to create a usable learning plan **under 10 minutes**. `[ASSUMPTION]`
5. Keep the median weekly learning time **at 2–4 hours or less**, so it fits into a busy adult's schedule. `[ASSUMPTION]`

## 3. Non-Goals

- **Not a course marketplace.** We don't host or sell third-party courses.
- **Not accredited.** No degrees, certificates or formal credentials in v1.
- **Not for K-12 or college students** who already have an institution structuring their learning.
- **No live human tutors in v1.** The tutor is software-guided. Human coaching may come later.
- **Not a corporate L&D or compliance training tool** in v1. We sell to individuals, not employers.
- **Not a content creator.** We won't produce original video courses. We curate and sequence existing material and add guidance.
- **No "learning styles" labels.** We don't personalize based on labels like "I'm a visual learner." We adapt based on what measurably works for each learner.
- **Side quests don't run on autopilot in v1.** The learner always chooses to start one and chooses when to return.

## 4. Product Pillars

1. **Growth means learning, connecting, applying and mastering.** `[NEEDS INPUT: "connecting" ideas, people, or both?]`
2. **Give people a map** and help them reach their goals.
3. **Side quests are fully explorable.** Curiosity is never punished. `[NEEDS INPUT: does "free" mean no cost?]`
4. **Vocabulary matters.** Learner and tutor agree on specialist language before building on it.
5. **Meet people where they are.** Start from what they already know, their schedule and their interests.
6. **Recommend, don't dictate.** The tutor always suggests a next step, and the learner decides.

## 5. Core Features

| # | Feature | What it does | Pillars |
|---|---|---|---|
| F1 | **Learning Roadmap** | Shows the big picture, where the learner is on it, and how the current module connects to the goal. This helps the learner build a mental model and see their progress. | 2, 5 |
| F2 | **Knowledge & Mastery Graph** | A long-term record of what the learner knows and how well. It feeds the roadmap, personalization and spaced review, and points to related topics worth exploring. | 1, 5 |
| F3 | **Sidekicks** | Short side sessions for quick questions, vocabulary checks or a different explanation. They don't clutter the main lesson, but anything learned gets saved to the graph. | 4, 6 |
| F4 | **Side Quests & Deep Dives** | Exploration on a branch or related topic. The tutor shows how it affects the finish date, and the learner decides whether to go. | 3, 6 |
| F5 | **Personal Coach** | Adapts delivery based on what has actually worked for this learner, finds where they excel and struggle, and uses their interests in analogies and practice. | 5 |
| F6 | **Personal Glossary** | Terms the learner has met, how well they know each one, and plain-English definitions. | 4 |
| F7 | **Keep-Going Engine** | Adaptive replanning, check-ins at times the learner chooses, restart weeks and small visible wins. This addresses the core problem: life gets in the way. | 5 |

`[NEEDS INPUT]` Proposed v1 scope: F1, a simple version of F2, F3, F5 and F7. F4 and F6 could launch in a lighter form or in a later release.

## 6. Users & Use Cases

**Primary user:** Adults who want or need to learn a new skill, whether for a career change, a job requirement or personal growth, and who have limited time.

**Scenario 1: The career pivoter.** Maya is 34 and works in marketing operations. She wants to move into data analytics within a year. She has tried free courses twice and quit both times around week three, when work got busy. With ABL, she states her goal and says she has 3 hours a week. The tutor builds a 9-month roadmap with short weekly sessions. When she misses a week, it adjusts the plan instead of letting her fall behind. When she runs into the term "join," she opens a sidekick, gets an explanation that uses her marketing funnel work as the example, and goes right back to her lesson.

**Scenario 2: The forced upskiller.** David is 48 and manages a warehouse team. His company is rolling out new automation software, and he needs to understand it well enough to lead his team. He feels intimidated and unsure where to start. ABL checks what he already knows, skips the basics he's already solid on, and gives him a practical 6-week track. Each step builds his confidence with a small, visible win, and his mastery graph shows how far he's come.

**Scenario 3: The curious professional.** Priya is a lawyer who wants to learn Spanish for a client base that's growing. She has 20 minutes on weekday mornings. ABL fits sessions to that window. It aims for depth in legal vocabulary and moves quickly through general conversation she doesn't need yet. When she gets curious about regional dialects, she starts a side quest. The tutor tells her it will push her finish date back by a week, and she decides it's worth it.

## 7. User Stories

### Must-have
1. As an adult learner, I want to state a learning goal in plain language so that I don't need to know the "right" curriculum to get started.
2. As an adult learner, I want the tutor to assess what I already know so that I don't waste time on things I've mastered.
3. As an adult learner, I want to tell the tutor how much time and energy I have each week so that my plan fits my real life.
4. As an adult learner, I want a personalized, step-by-step learning roadmap so that I always know what to do next.
5. As an adult learner, I want the plan to adjust when I miss sessions or fall behind so that one bad week doesn't derail me.
6. As an adult learner, I want to see my progress toward my goal so that I stay motivated.
7. As an adult learner, I want to ask a quick question in a side window so that I can clarify something without losing my place.
8. As an adult learner, I want to see how my current lesson fits into my roadmap so that I understand why it matters.
9. As an adult learner, I want to see what the tutor knows about me and edit it so that I trust how my information is used.

### Should-have
10. As an adult learner, I want to choose whether to prioritize speed, depth or practical outcomes so that the plan matches why I'm learning.
11. As an adult learner, I want check-ins and reminders at times I choose so that learning becomes a habit.
12. As an adult learner, I want short skill checks so that I can prove to myself I'm actually improving.
13. As an adult learner, I want to start a side quest and see how it affects my timeline so that I can explore without losing track.
14. As an adult learner, I want examples tied to my own interests so that new ideas stick.
15. As an adult learner, I want a personal glossary so that I can look up and review terms I've learned.
16. As an adult learner, I want spaced review of past skills so that I don't lose what I've mastered.

### Nice-to-have
17. As an adult learner, I want the tutor to suggest related topics based on my graph so that I discover what to learn next.
18. As an adult learner, I want to connect with others learning the same skill so that I feel less alone.
19. As an adult learner, I want to share a summary of my progress with a manager or mentor so that my growth is visible.
20. As an adult learner, I want the tutor to suggest my next goal when I finish one so that I keep growing.

## 8. Acceptance Criteria

**Story 1: State a goal**
- **Given** a new user on the goal-setting screen, **when** they type a goal in plain language (e.g., "I want to get a data analyst job"), **then** the tutor restates the goal back to them and asks up to 3 clarifying questions.
- **Given** a goal that's too vague (e.g., "get smarter"), **when** the user submits it, **then** the tutor suggests 2–3 more specific goals to pick from.

**Story 2: Assess what I know**
- **Given** a user has set a goal, **when** onboarding continues, **then** the user completes a short assessment of 10 minutes or less.
- **Given** the user shows mastery of a topic, **when** the plan is generated, **then** that topic is marked "skipped — already known," and the user can undo that.

**Story 3: Set time and energy**
- **Given** a user is in onboarding, **when** they enter their weekly hours and preferred session length, **then** the plan never schedules more than that total per week.

**Story 4: Personalized roadmap**
- **Given** goal, assessment and time inputs are complete, **when** the roadmap is generated, **then** the user sees milestones, weekly sessions, an estimated finish date, and one recommended next step.
- **Given** a user opens the app at any time, **when** they land on the home screen, **then** their recommended next step is visible without scrolling, along with a way to choose something else.

**Story 5: Adaptive replanning**
- **Given** a user misses one or more scheduled sessions, **when** they return, **then** the plan updates automatically, the new finish date is shown, and no "overdue" backlog is displayed.
- **Given** a user misses 2 weeks in a row, **when** they return, **then** the tutor offers a lighter "restart" week before resuming the normal pace.

**Story 6: Progress visibility**
- **Given** a user has completed at least one session, **when** they view their progress, **then** they see percent of goal completed, milestones reached, and total time invested.

**Story 7: Sidekick**
- **Given** a learner is in a lesson, **when** they open a sidekick and ask a question, **then** the answer appears in a separate panel, the main lesson stays where they left it, and they can return with one click.
- **Given** a sidekick session shows a gap in understanding (e.g., the learner asked what a term means), **when** the session closes, **then** that term or concept is added to the graph and the glossary.

**Story 8: Roadmap context**
- **Given** a learner is in any module, **when** they view the roadmap, **then** the current module is highlighted and its connection to the goal is explained in one sentence.

**Story 9: Learner profile**
- **Given** a learner opens their profile, **when** they view "what my tutor knows," **then** they see every stored interest and preference, and can edit or delete each one.

## 9. Risks & Assumptions

| **Risks** | **Assumptions** |
|---|---|
| Users drop off after the first 2–3 weeks, the same pattern they show with online courses | Adults will pay for guided, personalized learning the way they pay for trainers `[ASSUMPTION]` |
| Tutor quality is uneven across subjects, e.g. strong on coding and weak on hands-on trades | Enough good free or licensable content exists to build plans for most goals `[ASSUMPTION]` |
| AI-generated guidance is wrong or outdated, which damages trust | Users can describe their goals well enough for the tutor to build a useful plan `[ASSUMPTION]` |
| Relying on third-party content that may change, disappear or go behind paywalls | A short assessment can estimate current skill level accurately enough `[ASSUMPTION]` |
| Users feel judged by assessments, which feeds the helplessness we're trying to break | 2–4 hours a week is a realistic commitment for the target user `[ASSUMPTION]` |
| Privacy concerns around storing personal goals and career plans | Visible progress is a strong enough motivator to keep users coming back `[ASSUMPTION]` |
| Side quests pull learners away from their main goal until they quit | Learners will use the graph to understand their own progress `[ASSUMPTION]` |
| Mastery scores are inaccurate, so the roadmap and personalization give bad guidance | The system can reliably tell when a question shows a real knowledge gap `[ASSUMPTION]` |
| Using personal interests in content feels invasive | Learners are comfortable sharing interests in exchange for more relevant examples `[ASSUMPTION]` |
| Too many features for v1 dilutes quality | |

## 10. Open Questions

1. What does "ABL" stand for, and is it the final product name? — **Owner:** [NEEDS INPUT]
2. What is the timeline for v1? — **Owner:** [NEEDS INPUT]
3. Are there technical constraints: platform (web, mobile, both), AI provider or budget? — **Owner:** [NEEDS INPUT]
4. Which features are v1 and which come later? — **Owner:** [NEEDS INPUT]
5. Which 2–3 skill areas should v1 launch with, instead of trying to support "any skill"? — **Owner:** [NEEDS INPUT]
6. What is the business model: subscription, freemium or pay per goal? Does "side quests are free" mean no cost? — **Owner:** [NEEDS INPUT]
7. Where does learning content come from: curated links, licensed content or AI-generated lessons? — **Owner:** [NEEDS INPUT]
8. Are there compliance requirements, such as data privacy laws (GDPR, CCPA) or rules on storing user data? — **Owner:** [NEEDS INPUT]
9. How is "mastery" defined and measured: self-rated, tested or both? — **Owner:** [NEEDS INPUT]
10. What are the side quest rules: a time limit, a cap on how deep to go, or only a timeline warning? — **Owner:** [NEEDS INPUT]
11. Does "connecting" in Pillar 1 mean connecting ideas, connecting with people, or both? — **Owner:** [NEEDS INPUT]

## 11. Success Metrics

**Leading indicators (early signals, first 2–4 weeks)**
- Onboarding completion rate: goal, assessment and roadmap created
- Time from signup to first completed session
- Share of scheduled sessions completed in week 1 and week 2
- Share of users who come back after a missed week, which tests whether the Keep-Going Engine works
- Sidekick usage per session, and share of learners who return to the main lesson afterward
- Share of side quests that end with the learner back on the main roadmap

**Lagging indicators (final outcomes, 60–180 days)**
- Weekly active retention at day 30, 60 and 90
- Share of users who reach their stated goal
- Skill-check improvement from the first assessment to the final one
- Mastery retention: share of mastered skills still passing spaced review after 60 days
- Self-reported confidence change, before vs. after
- Paid conversion and renewal rate `[ASSUMPTION: subscription model]`
- Share of users who set a second goal after finishing the first

---

Review the [ASSUMPTION] and [NEEDS INPUT] sections before sharing with engineering.

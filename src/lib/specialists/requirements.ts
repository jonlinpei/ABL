import { generateStructured } from "@/lib/ai/structured";
import type { GoalBrief } from "@/lib/goals/schema";

import { POSTING_RESEARCHER_SKILL } from "./posting-researcher.generated";
import { REQUIREMENTS_ANALYST_SKILL } from "./requirements-analyst.generated";
import {
  PostingResearchSchema,
  RequirementsDraftSchema,
  type Posting,
  type PostingResearch,
  type RequiredSkill,
  type RequirementsDraft,
  type TargetRequirements,
} from "./schemas";

/** Fewest postings to count from. With fewer, the analyst's own must/nice call stands. */
export const MIN_POSTINGS = 5;
/** Searching takes minutes; stop well inside the 300-second function limit. */
const RESEARCH_TIMEOUT_MS = 240_000;

/**
 * Cache key for a target. Learners whose briefs name the same role, market and
 * industry share one requirements set. Differently worded targets miss the
 * cache; matching near-duplicates is a later improvement.
 */
export function targetKey(target: GoalBrief["target"]): string {
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
  return [target.role, target.market, target.industry].map(norm).join(" | ");
}

function targetLines(brief: GoalBrief): string {
  const t = brief.target;
  return `Target:
- Role: ${t.role}
- What the role involves: ${t.work}
- Market: ${t.market}
- Industry: ${t.industry}`;
}

export function researchPrompt(brief: GoalBrief): string {
  return `${targetLines(brief)}

The learner aiming here is moving from ${brief.current.role} (${brief.current.industry}), so look for roles a career switcher could be hired into.`;
}

/**
 * Current job postings for a brief's target. Never throws: if the search
 * fails, requirements are built from the analyst's knowledge instead.
 */
export async function researchPostings(brief: GoalBrief, userId: string): Promise<PostingResearch> {
  try {
    const { output } = await generateStructured({
      task: "requirements_research",
      userId,
      instructions: POSTING_RESEARCHER_SKILL,
      prompt: researchPrompt(brief),
      schema: PostingResearchSchema,
      webSearch: { maxUses: 5 },
      timeoutMs: RESEARCH_TIMEOUT_MS,
      // Finding and copying out postings needs little reasoning, and more
      // thinking makes the search much slower.
      effort: "low",
    });
    return { ...output, postings: await withoutGonePostings(usablePostings(output.postings)) };
  } catch (err) {
    console.error("[requirements_research] no postings", err);
    return { postings: [], notes: "The posting search failed." };
  }
}

/** One per company and title, and only postings that list at least two requirements. */
export function usablePostings(postings: Posting[]): Posting[] {
  const seen = new Set<string>();
  return postings.filter((p) => {
    const key = `${p.company} | ${p.title}`.toLowerCase().replace(/\s+/g, " ").trim();
    if (seen.has(key) || seen.has(p.url) || p.requirements.length < 2) return false;
    seen.add(key);
    seen.add(p.url);
    return true;
  });
}

/**
 * Drop postings whose page is gone (404 or 410): usually closed since the
 * search index saw them. Pages that block scripted requests or time out are
 * kept, since that isn't evidence the posting is gone.
 */
export async function withoutGonePostings(postings: Posting[]): Promise<Posting[]> {
  const gone = await Promise.all(
    postings.map(async (p) => {
      try {
        const res = await fetch(p.url, { redirect: "follow", signal: AbortSignal.timeout(10_000) });
        return res.status === 404 || res.status === 410;
      } catch {
        return false;
      }
    }),
  );
  return postings.filter((_, i) => !gone[i]);
}

export function requirementsPrompt(brief: GoalBrief, postings: Posting[] = []): string {
  const list = postings.length
    ? `Current job postings for this target:\n\n${postings.map(postingLines).join("\n\n")}`
    : "No current job postings were found for this target. Work from what you know.";
  return `${targetLines(brief)}

${list}

For context, the learner aiming here is moving from: ${brief.current.role} (${brief.current.industry}), ${brief.current.experience}. Write requirements for the target itself, not for this learner.`;
}

function postingLines(p: Posting, i: number): string {
  const items = (required: boolean) => p.requirements.filter((r) => r.required === required).map((r) => r.text);
  const lines = [`${i + 1}. ${p.title}, ${p.company} (${p.location})`];
  if (items(true).length) lines.push(`   Required: ${items(true).join("; ")}`);
  if (items(false).length) lines.push(`   Preferred: ${items(false).join("; ")}`);
  return lines.join("\n");
}

/** Build the requirements for a brief's target, grounded in postings when there are enough. */
export async function buildRequirements(
  brief: GoalBrief,
  userId: string,
  research: PostingResearch = { postings: [], notes: "" },
): Promise<TargetRequirements> {
  const { output } = await generateStructured({
    task: "requirements_build",
    userId,
    instructions: REQUIREMENTS_ANALYST_SKILL,
    prompt: requirementsPrompt(brief, research.postings),
    schema: RequirementsDraftSchema,
  });
  return withUniqueSkillIds(groundInPostings(output, research.postings, new Date()));
}

/** Share of postings at or above which a skill is core (a must-have), and common. */
const CORE_SHARE = 0.6;
const COMMON_SHARE = 0.3;

/**
 * Count how many postings ask for each skill and set its frequency. Only core
 * skills are must-haves: postings over-ask, so a skill half of them mention
 * is worth learning but shouldn't block a learner. Skills no posting names
 * (often domain knowledge) keep the analyst's call.
 */
export function groundInPostings(draft: RequirementsDraft, postings: Posting[], now: Date): TargetRequirements {
  const n = postings.length;
  const grounded = n >= MIN_POSTINGS;
  const skills: RequiredSkill[] = draft.skills.map(({ seenIn, ...skill }) => {
    const hits = new Set(seenIn.filter((i) => Number.isInteger(i) && i >= 1 && i <= n)).size;
    if (!grounded || hits === 0) return skill;
    const share = hits / n;
    const frequency = share >= CORE_SHARE ? "core" : share >= COMMON_SHARE ? "common" : "sometimes";
    return { ...skill, frequency, postingShare: Math.round(share * 100) / 100, importance: frequency === "core" ? "must" : "nice" };
  });
  if (!grounded) {
    const found = n === 0 ? "no current job postings were found" : `only ${n} current job postings were found`;
    return { ...draft, skills, caveats: [...draft.caveats, `Built from general knowledge: ${found} for this target.`] };
  }
  return {
    ...draft,
    skills,
    sources: postings.map(({ title, company, url }) => ({ title, company, url })),
    groundedAt: now.toISOString().slice(0, 10),
  };
}

/** Slug the ids and drop repeats, so profiles and gaps can key on them. */
export function withUniqueSkillIds(req: TargetRequirements): TargetRequirements {
  const seen = new Set<string>();
  const skills = [];
  for (const skill of req.skills) {
    const id = skill.id
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
    if (!id || seen.has(id)) continue;
    seen.add(id);
    skills.push({ ...skill, id });
  }
  return { ...req, skills };
}

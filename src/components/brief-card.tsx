import type { CareerDimension, GoalBrief, InferableField } from "@/lib/goals/schema";

export const PRIORITY_LABEL: Record<GoalBrief["priority"], string> = {
  speed: "Speed",
  depth: "Depth",
  practical: "Practical results",
};

export const DIMENSION_LABEL: Record<CareerDimension, string> = {
  role: "Role",
  market: "Market",
  industry: "Industry",
};

export const SOURCE_LABEL: Record<GoalBrief["profileSources"][number], string> = {
  resume: "your resume",
  linkedin: "your LinkedIn profile",
  conversation: "our conversation",
};

/** The career brief: now vs. where they're going, and the details, with guesses flagged. */
export function BriefCard({
  brief,
  active = false,
  confirmed = false,
  onConfirm,
}: {
  brief: GoalBrief;
  /** Show the confirm button (during discovery). */
  active?: boolean;
  confirmed?: boolean;
  onConfirm?: () => void;
}) {
  const guessed = (fields: InferableField[]) => fields.some((f) => brief.inferred.includes(f));
  const rows: [string, string | null, InferableField[]][] = [
    ["Experience", brief.current.experience, ["current.experience"]],
    [
      "What carries over",
      brief.current.strengths.length ? brief.current.strengths.join(", ") : null,
      [],
    ],
    ["Why", brief.motivation, ["motivation"]],
    ["Success looks like", brief.successLooksLike, ["successLooksLike"]],
    ["Deadline", brief.deadline ?? "None set", ["deadline"]],
    ["Starting point", brief.startingPoint, ["startingPoint"]],
    [
      "Time",
      `${brief.weeklyHours} h/week · ${brief.sessionMinutes}-min sessions${
        brief.preferredTimes ? ` · ${brief.preferredTimes}` : ""
      }`,
      ["weeklyHours", "sessionMinutes", "preferredTimes"],
    ],
    ["Tried before", brief.pastAttempts ?? "First time", ["pastAttempts"]],
    ["Priority", PRIORITY_LABEL[brief.priority], ["priority"]],
    ["Interests", brief.interests.length ? brief.interests.join(", ") : null, []],
  ];
  const sources = brief.profileSources.map((s) => SOURCE_LABEL[s]);
  return (
    <div className="mt-3 rounded-xl border border-foreground/20 p-4">
      <div className="text-xs uppercase tracking-wide text-foreground/50">
        Career brief · {brief.headline}
      </div>
      <div className="mt-1 text-lg font-medium">{brief.restatedGoal}</div>
      <div className="mt-1 text-sm text-foreground/60">&ldquo;{brief.goalInTheirWords}&rdquo;</div>

      <div className="mt-4 rounded-lg border border-foreground/10">
        <div className="hidden grid-cols-[6rem_1fr_1fr] gap-x-4 border-b border-foreground/10 px-3 py-2 text-xs uppercase tracking-wide text-foreground/50 sm:grid">
          <span />
          <span>Now</span>
          <span>Where you&apos;re going</span>
        </div>
        {(["role", "market", "industry"] as const).map((dim) => {
          const changing = brief.changes.includes(dim);
          return (
            <div
              key={dim}
              className="grid gap-x-4 gap-y-1 border-b border-foreground/10 px-3 py-2.5 text-sm last:border-b-0 sm:grid-cols-[6rem_1fr_1fr]"
            >
              <div className="flex items-center gap-2 sm:flex-col sm:items-start sm:gap-1">
                <span className="text-foreground/50">{DIMENSION_LABEL[dim]}</span>
                {changing && (
                  <span className="rounded bg-sky-500/15 px-1.5 py-0.5 text-xs text-sky-700 dark:text-sky-300">
                    changing
                  </span>
                )}
              </div>
              <Position brief={brief} side="current" dim={dim} guessed={guessed} />
              <Position brief={brief} side="target" dim={dim} guessed={guessed} unchanged={!changing} />
            </div>
          );
        })}
      </div>
      <div className="mt-2 text-xs text-foreground/50">
        {brief.changes.length === 0
          ? "Growing in your current career"
          : `Changing ${listJoin(brief.changes.map((d) => DIMENSION_LABEL[d].toLowerCase()))}`}
        {sources.length > 0 && ` · Based on ${listJoin(sources)}`}
      </div>

      <dl className="mt-4 grid gap-x-4 gap-y-2 text-sm sm:grid-cols-[10rem_1fr]">
        {rows
          .filter(([, v]) => v)
          .map(([k, v, fields]) => (
            <div key={k} className="contents">
              <dt className="text-foreground/50">{k}</dt>
              <dd>
                {v}
                {guessed(fields) && <GuessTag />}
              </dd>
            </div>
          ))}
      </dl>
      {active && (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            onClick={onConfirm}
            className="rounded-lg bg-foreground px-4 py-2 text-sm text-background"
          >
            Looks right
          </button>
          <span className="text-sm text-foreground/50">
            Or tell me what to change below
            {brief.inferred.length > 0 && ", especially anything marked \"my guess\""}.
          </span>
        </div>
      )}
      {confirmed && <div className="mt-4 text-sm text-foreground/60">✓ Confirmed</div>}
    </div>
  );
}

/** One cell of the now / where-you're-going comparison. */
function Position({
  brief,
  side,
  dim,
  guessed,
  unchanged = false,
}: {
  brief: GoalBrief;
  side: "current" | "target";
  dim: CareerDimension;
  guessed: (fields: InferableField[]) => boolean;
  /** Mutes the target cell when this dimension isn't changing. */
  unchanged?: boolean;
}) {
  const pos = brief[side];
  const label = side === "current" ? "Now" : "Going to";
  const fields: InferableField[] =
    dim === "role" ? [`${side}.role`, `${side}.work`] : [`${side}.${dim}`];
  return (
    <div className={unchanged ? "text-foreground/60" : undefined}>
      <span className="mr-1.5 text-xs text-foreground/40 sm:hidden">{label}:</span>
      {dim === "role" ? (
        <>
          <span className="font-medium">{pos.role}</span>
          <span className="block text-foreground/60">{pos.work}</span>
        </>
      ) : (
        pos[dim]
      )}
      {guessed(fields) && <GuessTag />}
    </div>
  );
}

export function GuessTag() {
  return (
    <span className="ml-2 inline-block rounded bg-amber-500/15 px-1.5 py-0.5 text-xs text-amber-700 dark:text-amber-300">
      my guess
    </span>
  );
}

function listJoin(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}


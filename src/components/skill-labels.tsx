import type { Gap } from "@/lib/specialists/schemas";

export const LEVEL_LABEL = ["None", "Aware", "With help", "Independent", "Can lead"];

export const BASIS_LABEL: Record<Gap["items"][number]["basis"], string> = {
  assessed: "checked",
  practiced: "from your sessions",
  work_history: "from your work history",
  self_reported: "you said",
  inferred: "estimate",
};

/** Four segments: filled to the current level, outlined up to the required level. */
export function LevelBar({ current, required }: { current: number; required: number }) {
  return (
    <div className="flex gap-1" aria-label={`Level ${current} of ${required} needed`}>
      {[1, 2, 3, 4].map((n) => (
        <span
          key={n}
          className={`h-2 flex-1 rounded-sm ${
            n <= current
              ? "bg-foreground/70"
              : n <= required
                ? "border border-foreground/40"
                : "bg-foreground/5"
          }`}
        />
      ))}
    </div>
  );
}

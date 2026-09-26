// Pure helpers for grade.mjs, kept separate so they can be unit-tested.

const NO_VALUE_CLAUSE =
  /^(none|nothing|n\/a|no|not|nope|never|first (real |actual |serious )?(time|attempt|try)|hasn't|has not|haven't|have not|this is (my|the|their|his|her) first)\b/i;
const CLAUSE_BREAK = /[,;]|\s+[—–-]\s+|\s+(?:but|though|although|except|however)\s+/i;

/**
 * Whether a brief field says something, as a reader would judge it.
 * "None", "No deadline" and "Never tried, first time" say nothing.
 * "No formal lessons, but used Duolingo for 2 months" does: a value is
 * present when any clause isn't itself a "no value" phrase.
 */
export function hasValue(v) {
  if (v == null) return false;
  const text = String(v).trim();
  if (text === "") return false;
  return text
    .split(CLAUSE_BREAK)
    .map((c) => c.trim().replace(/^(?:and|but|so)\s+/i, ""))
    .filter((c) => c !== "")
    .some((c) => !NO_VALUE_CLAUSE.test(c));
}

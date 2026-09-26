import type { GoalBrief } from "./schema";

/** A complete, valid career brief for tests. */
export const sampleBrief: GoalBrief = {
  headline: "Marketing ops to data analyst",
  current: {
    role: "Marketing operations coordinator",
    work: "Builds campaign performance reports in Excel and keeps the CRM clean.",
    market: "Bay Area, mid-market B2B software",
    industry: "Software",
    experience: "6 years, individual contributor",
    strengths: ["Excel pivot tables", "CRM data clean-up", "presenting results to managers"],
  },
  target: {
    role: "Data analyst",
    work: "Answers business questions with SQL and dashboards.",
    market: "Bay Area, B2B software",
    industry: "Software",
  },
  changes: ["role"],
  profileSources: ["resume", "conversation"],
  goalInTheirWords: "I want to move into a data analyst role within a year",
  restatedGoal: "Land a junior data analyst role at a B2B software company by next September.",
  motivation: "Wants work that's more analytical and better paid.",
  successLooksLike: "An offer for an analyst role, with a small portfolio of SQL projects.",
  deadline: "2027-09-01",
  startingPoint: "Advanced Excel; has never written SQL.",
  weeklyHours: 3,
  sessionMinutes: 45,
  preferredTimes: "Weekday evenings",
  pastAttempts: "Two free online courses; quit both around week three when work got busy.",
  priority: "practical",
  interests: ["running", "cooking"],
  inferred: ["target.market", "priority"],
};

import type { LearnerProfile, Plan, TargetRequirements } from "./schemas";

/** A small, complete requirements set for tests. */
export const sampleRequirements: TargetRequirements = {
  summary: "Junior data analysts answer business questions with SQL and dashboards.",
  skills: [
    { id: "sql-querying", name: "SQL querying", category: "technical", level: 3, importance: "must", howEmployersCheck: "Take-home SQL test" },
    { id: "spreadsheets", name: "Spreadsheets", category: "tool", level: 3, importance: "must", howEmployersCheck: "Interview exercise" },
    { id: "dashboards", name: "Dashboards", category: "tool", level: 2, importance: "nice", howEmployersCheck: "Portfolio" },
    { id: "stakeholder-communication", name: "Presenting findings", category: "professional", level: 3, importance: "must", howEmployersCheck: "Portfolio walkthrough" },
  ],
  credentials: [],
  proofOfSkill: ["Three portfolio analyses with SQL"],
  caveats: [],
};

export const sampleProfile: LearnerProfile = {
  summary: "Strong spreadsheet and reporting background; no SQL yet.",
  skills: [
    { skillId: "sql-querying", level: 0, basis: "self_reported", evidence: "Has never written SQL." },
    { skillId: "spreadsheets", level: 3, basis: "work_history", evidence: "Builds weekly pivot-table reports." },
    { skillId: "dashboards", level: 2, basis: "self_reported", evidence: "Says she's built HubSpot dashboards." },
    { skillId: "stakeholder-communication", level: 2, basis: "work_history", evidence: "Presents at monthly reviews." },
  ],
  otherStrengths: ["CRM data hygiene"],
};

/** A plan that passes every check against sampleRequirements and sampleProfile. */
export const samplePlan: Plan = {
  title: "From marketing reports to SQL analysis",
  summary: "Short early milestones so a busy week doesn't derail you.",
  weeklyHours: 3,
  sessionMinutes: 45,
  milestones: [
    {
      title: "Write your first SQL queries on funnel data",
      weeks: 4,
      whyItMatters: "SQL is the first thing analyst interviews test.",
      skills: [{ skillId: "sql-querying", toLevel: 2 }],
      topics: ["SELECT, WHERE, GROUP BY"],
      project: null,
      projectShows: [],
      visibleWin: "Recreate your weekly campaign report in SQL.",
    },
    {
      title: "Joins and window functions",
      weeks: 5,
      whyItMatters: "Real questions span several tables.",
      skills: [{ skillId: "sql-querying", toLevel: 3 }],
      topics: ["JOIN", "window functions"],
      project: "A cohort retention analysis",
      projectShows: ["sql-querying"],
      visibleWin: "Answer a retention question end to end.",
    },
    {
      title: "Present an analysis",
      weeks: 3,
      whyItMatters: "Hiring managers want to hear you explain findings.",
      skills: [{ skillId: "stakeholder-communication", toLevel: 3 }],
      topics: ["one-page write-ups"],
      project: "A one-page recommendation",
      projectShows: ["stakeholder-communication"],
      visibleWin: "Walk a friend through your analysis in five minutes.",
    },
  ],
  firstSession: { title: "Your first query", minutes: 30, whatYouWillDo: "Query a sample funnel table.", outcome: "One working query." },
  notCovered: [],
  deadlineFit: "12 weeks, well before your deadline.",
  assumptions: [],
};

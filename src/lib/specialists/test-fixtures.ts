import type { LearnerProfile, TargetRequirements } from "./schemas";

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

import "server-only";

// Knobs tuned against `npm run eval`. Kept in one place so they are easy to
// change and explain.

/** Ranking weights passed to Postgres. */
export const RANK_WEIGHTS = {
  /** Each matched preferred constraint. */
  preferred: 3,
  /** A required role/title/company/trait constraint that also holds in the current role. */
  current: 2,
  /** A requested skill named in the person's headline (their main skills). */
  skill_in_headline: 1,
  /** A requested skill named in their current job's description ("working mostly with React"). */
  skill_in_current_job: 1,
};

/** Minimum trigram similarity for a typed value to map onto a value in the data. */
export const FUZZY = {
  skill: 0.6,
  location: 0.75,
  company: 0.8,
  title: 0.75,
  school: 0.7,
  field_of_study: 0.7,
};

/** How a seniority word in a brief widens to levels in the data. */
export const SENIORITY_EXPANSION: Record<string, string[]> = {
  junior: ["junior"],
  mid: ["mid"],
  senior: ["senior"],
  staff_plus: ["staff_plus"],
};

/** How much vocabulary the prompt carries (the server maps anything else). */
export const PROMPT_VOCAB = { skills: 300, titles: 150, locations: 150, companies: 150 };

export const LLM_TIMEOUT_MS = 2500;

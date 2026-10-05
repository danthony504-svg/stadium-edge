/** Coach QA — sport ids without pulling @expo/vector-icons. */
export const COACH_QA_SPORTS = [
  "mlb",
  "wnba",
  "nba",
  "nhl",
  "soccer",
  "ufc",
  "tennis",
  "nfl",
  "ncaaf",
  "ncaab",
] as const;

export type CoachQaSport = (typeof COACH_QA_SPORTS)[number];

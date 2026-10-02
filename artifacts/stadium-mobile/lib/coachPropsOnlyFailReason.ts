/**
 * Phone-visible props-only empty reasons.
 *
 * When "9 leg NFL player prop" still empties after #542/#543, Coach must show
 * WHY (pool / candidates / history / grade / odds gate) — not a bare quality bar.
 */

export type PropsOnlyFailCode =
  | "PROPS_ONLY_POOL_EMPTY"
  | "PROPS_ONLY_NO_CANDIDATES"
  | "PROPS_ONLY_NO_HISTORY"
  | "PROPS_ONLY_NO_GRADE"
  | "PROPS_ONLY_ODDS_GATE"
  | "PROPS_ONLY_STAGED_SHORT"
  | "PROPS_ONLY_EMPTY";

export type PropsOnlyFailDiag = {
  code: PropsOnlyFailCode;
  target: number;
  pool: number;
  athleteLinked: number;
  candidates: number;
  historyLoaded: number;
  graded: number;
  bestEvSides: number;
  oddsCleared: number;
  staged: number;
  /** Distinct games among odds-cleared legs (thin-slate diagnosis). */
  uniqueGames?: number;
  /** nullReason → count from history/MC misses */
  nullReasons: Record<string, number>;
  /** Top sports in the pool (e.g. nfl:12 wnba:80) */
  sports?: Record<string, number>;
};

function topEntries(map: Record<string, number>, limit = 4): string {
  return Object.entries(map)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([k, v]) => `${k}:${v}`)
    .join(" ");
}

/** Pick the most actionable code from counters. */
export function derivePropsOnlyFailCode(
  d: Omit<PropsOnlyFailDiag, "code">,
): PropsOnlyFailCode {
  if (d.pool <= 0) return "PROPS_ONLY_POOL_EMPTY";
  if (d.candidates <= 0) return "PROPS_ONLY_NO_CANDIDATES";
  // Sparse history (e.g. 2 of 48) is still a history bottleneck, not a grade bug.
  const histFloor = Math.max(3, Math.ceil(d.candidates * 0.2));
  if (d.graded <= 0 && d.historyLoaded < histFloor) return "PROPS_ONLY_NO_HISTORY";
  if (d.graded <= 0) return "PROPS_ONLY_NO_GRADE";
  if (d.oddsCleared <= 0) return "PROPS_ONLY_ODDS_GATE";
  if (d.staged > 0 && d.staged < d.target) return "PROPS_ONLY_STAGED_SHORT";
  return "PROPS_ONLY_EMPTY";
}

export function formatPropsOnlyFailTrace(d: PropsOnlyFailDiag): string {
  const parts = [
    `pool=${d.pool}`,
    `athleteId=${d.athleteLinked}`,
    `cand=${d.candidates}`,
    `hist=${d.historyLoaded}`,
    `graded=${d.graded}`,
    `bestEv=${d.bestEvSides}`,
    `oddsOk=${d.oddsCleared}`,
    `staged=${d.staged}/${d.target}`,
  ];
  if (d.uniqueGames != null) parts.push(`games=${d.uniqueGames}`);
  const nulls = topEntries(d.nullReasons);
  if (nulls) parts.push(`nulls=${nulls}`);
  const sports = d.sports ? topEntries(d.sports) : "";
  if (sports) parts.push(`sports=${sports}`);
  return ` [${d.code}: ${parts.join(" ")}]`;
}

export function buildPropsOnlyFailDiag(opts: {
  target: number;
  pool: number;
  athleteLinked: number;
  candidates: number;
  historyLoaded: number;
  graded: number;
  bestEvSides: number;
  oddsCleared: number;
  staged: number;
  uniqueGames?: number;
  nullReasons?: Record<string, number>;
  sports?: Record<string, number>;
}): PropsOnlyFailDiag {
  const base = {
    target: opts.target,
    pool: opts.pool,
    athleteLinked: opts.athleteLinked,
    candidates: opts.candidates,
    historyLoaded: opts.historyLoaded,
    graded: opts.graded,
    bestEvSides: opts.bestEvSides,
    oddsCleared: opts.oddsCleared,
    staged: opts.staged,
    uniqueGames: opts.uniqueGames,
    nullReasons: opts.nullReasons ?? {},
    sports: opts.sports,
  };
  return { ...base, code: derivePropsOnlyFailCode(base) };
}

/** Human lead for the Coach chat bubble — never append machine `[CODE: …]` traces. */
export function propsOnlyFailNote(lead: string, diag: PropsOnlyFailDiag): string {
  void diag;
  return lead.trim();
}

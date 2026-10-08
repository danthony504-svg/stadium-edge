/** Trim alternate prop rungs before responding — keeps UI/chat lean by default. */

export type PropAltRow = {
  player: string;
  market: string;
  line: number | null;
  overPrice: number | null;
  underPrice: number | null;
  alt: boolean;
};

export function canonicalPropMarket(market: string): string {
  let k = String(market ?? "").trim().toLowerCase();
  if (k.endsWith("_alternate")) k = k.slice(0, -"_alternate".length);
  k = k.replace(/_(q1|q2|q3|q4|h1|h2|1h|2h|f5)$/i, "");
  return k;
}

const YARDS_FAMILY = new Set([
  "player_rush_yds",
  "player_pass_yds",
  "player_reception_yds",
  "player_pass_rush_yds",
  "player_rush_reception_yds",
  "player_pass_rush_reception_yds",
]);

/** Basketball scoring/counting props with posted alternate ladders. */
const BASKETBALL_ALT_FAMILY = new Set([
  "player_points",
  "player_rebounds",
  "player_assists",
  "player_threes",
]);

/** Baseball props with alternate ladders on the Odds API. */
const BASEBALL_ALT_FAMILY = new Set([
  "batter_hits",
  "batter_total_bases",
  "batter_home_runs",
  "pitcher_strikeouts",
  "batter_hits_runs_rbis",
  "batter_rbis",
  "batter_runs",
  "batter_runs_scored",
  "pitcher_outs",
]);

/** Hockey props with alternate ladders. */
const HOCKEY_ALT_FAMILY = new Set([
  "player_points",
  "player_assists",
  "player_shots_on_goal",
  "player_goals",
]);

/** Numeric props where fullBoard should keep far/milestone alt rungs for Coach. */
const FULL_BOARD_NUMERIC_FAMILY = new Set([
  ...YARDS_FAMILY,
  "player_pass_attempts",
  "player_pass_completions",
  "player_rush_attempts",
  "player_pass_tds",
  "player_receptions",
  "player_sacks",
  "player_pass_interceptions",
  ...BASKETBALL_ALT_FAMILY,
  ...BASEBALL_ALT_FAMILY,
  ...HOCKEY_ALT_FAMILY,
]);

const COUNT_ALT_FAMILY = new Set([
  "player_pass_tds",
  "player_receptions",
  "player_sacks",
  "player_pass_interceptions",
  "player_pass_attempts",
  "player_pass_completions",
  "player_rush_attempts",
  "player_threes",
  "batter_hits",
  "batter_home_runs",
  "pitcher_strikeouts",
  "player_goals",
  "player_assists",
  "player_shots_on_goal",
]);

export function isYardsFamilyMarket(market: string): boolean {
  return YARDS_FAMILY.has(canonicalPropMarket(market));
}

export function isFullBoardNumericFamily(market: string): boolean {
  return FULL_BOARD_NUMERIC_FAMILY.has(canonicalPropMarket(market));
}

function inPriceBand(overPrice: number | null, underPrice: number | null): boolean {
  const inBand = (p: number | null) => p != null && p >= -600 && p <= 600;
  return inBand(overPrice) || inBand(underPrice);
}

function isHalfPointLine(line: number): boolean {
  const whole = Math.round(line);
  return Math.abs(line - whole) <= 0.6 && Math.abs(line - whole) > 0.1;
}

/**
 * Common milestone / sportsbook “N+” alt numbers.
 * Half-point lines settle as Over (N−0.5); also keep classic 25-yard steps.
 */
export function isMilestonePropLine(line: number, market: string): boolean {
  if (!Number.isFinite(line)) return false;
  const canon = canonicalPropMarket(market);
  // Prefer floor+0.5 form used by books (59.5 → "60+", 174.5 → "175+").
  const wholeUp = Math.ceil(line);
  const isHalf = Math.abs(line - Math.floor(line) - 0.5) < 0.05;
  const whole = Math.round(line);

  if (YARDS_FAMILY.has(canon) || canon === "player_reception_yds") {
    // 25-yard steps (174.5/199.5) OR skill milestones (24.5/39.5/59.5/…).
    const on25 = Math.abs(line - whole) <= 0.6 && whole % 25 <= 1;
    const skillMilestone =
      isHalf &&
      (wholeUp === 25 ||
        wholeUp === 30 ||
        wholeUp === 40 ||
        wholeUp === 50 ||
        wholeUp === 60 ||
        wholeUp === 75 ||
        wholeUp === 100 ||
        wholeUp % 25 === 0);
    if (!on25 && !skillMilestone) return false;
    if (canon === "player_reception_yds") return wholeUp >= 25 || whole >= 25;
    return wholeUp >= 25 || whole >= 25;
  }
  if (canon === "player_pass_attempts" || canon === "player_pass_completions") {
    return isHalf && wholeUp >= 20;
  }
  if (canon === "player_rush_attempts") {
    return isHalf && wholeUp >= 10;
  }
  // Basketball + hockey share Odds API keys (player_points / assists). Accept
  // either sport's milestone band so hockey 1.5–3.5 rungs are not dropped.
  if (BASKETBALL_ALT_FAMILY.has(canon) || HOCKEY_ALT_FAMILY.has(canon)) {
    if (canon === "player_threes") return isHalf && wholeUp >= 2 && wholeUp <= 8;
    if (canon === "player_shots_on_goal") return isHalf && wholeUp >= 3;
    if (canon === "player_goals") return isHalf && wholeUp >= 1 && wholeUp <= 4;
    // Points/assists: basketball 10+/15+/… OR hockey 1+…4+
    if (canon === "player_points" || canon === "player_assists") {
      const bb = isHalf && wholeUp >= 10 && wholeUp % 5 === 0;
      const nhl = isHalf && wholeUp >= 1 && wholeUp <= 4;
      return bb || nhl;
    }
    if (BASKETBALL_ALT_FAMILY.has(canon)) {
      return isHalf && wholeUp >= 10 && wholeUp % 5 === 0;
    }
    return isHalf && wholeUp >= 1 && wholeUp <= 4;
  }
  if (BASEBALL_ALT_FAMILY.has(canon)) {
    if (canon === "pitcher_strikeouts") return isHalf && wholeUp >= 5;
    if (canon === "batter_home_runs") return isHalf && wholeUp >= 1 && wholeUp <= 2;
    if (canon === "batter_hits" || canon === "batter_total_bases") {
      return isHalf && wholeUp >= 2 && wholeUp <= 6;
    }
    return isHalf && wholeUp >= 2;
  }
  return false;
}

/** Higher count alts for sacks / pass TDs / receptions (1.5, 2.5, …). */
export function isHigherCountAltLine(line: number, market: string, mainLine: number | undefined): boolean {
  if (!Number.isFinite(line) || !isHalfPointLine(line)) return false;
  const canon = canonicalPropMarket(market);
  if (!COUNT_ALT_FAMILY.has(canon)) return false;
  const whole = Math.round(line);
  const mainWhole = Math.round(mainLine ?? 0);
  if (whole <= mainWhole) return false;
  if (canon === "player_pass_tds") return whole >= 1 && whole <= 5;
  if (canon === "player_sacks") return whole >= 1 && whole <= 3;
  if (canon === "player_receptions") return whole >= 2 && whole <= 12;
  if (canon === "player_pass_interceptions") return whole >= 1 && whole <= 2;
  if (canon === "player_pass_attempts" || canon === "player_pass_completions") return whole >= mainWhole + 3;
  if (canon === "player_rush_attempts") return whole >= mainWhole + 2;
  return false;
}

const ALT_CAP_DEFAULT = 12;
const ALT_CAP_FULL_BOARD_NEAREST = 12;
const ALT_CAP_FULL_BOARD_HIGH = 10;

function sortAltsByMainDistance<T extends PropAltRow>(list: T[], mainLine: number | undefined): T[] {
  return [...list].sort((a, b) => {
    const da = a.line != null ? Math.abs(a.line - (mainLine ?? 0)) : Infinity;
    const db = b.line != null ? Math.abs(b.line - (mainLine ?? 0)) : Infinity;
    return da - db;
  });
}

function pickFullBoardAlts<T extends PropAltRow>(
  sorted: T[],
  mainLine: number | undefined,
  market: string,
): T[] {
  const picked = new Map<number, T>();
  const canon = canonicalPropMarket(market);

  for (const r of sorted.slice(0, ALT_CAP_FULL_BOARD_NEAREST)) {
    if (r.line != null) picked.set(r.line, r);
  }

  // Keep sportsbook milestones across football / basketball / baseball / hockey.
  for (const r of sorted) {
    if (r.line != null && isMilestonePropLine(r.line, market)) {
      picked.set(r.line, r);
    }
  }
  if (COUNT_ALT_FAMILY.has(canon)) {
    for (const r of sorted) {
      if (r.line != null && isHigherCountAltLine(r.line, market, mainLine)) {
        picked.set(r.line, r);
      }
    }
  }
  // Far high rungs for continuous yards / points ladders.
  if (YARDS_FAMILY.has(canon) || canon === "player_points") {
    const high = sorted
      .filter((r) => r.line != null && r.line >= (mainLine ?? 0) + 35)
      .sort((a, b) => (b.line ?? 0) - (a.line ?? 0))
      .slice(0, ALT_CAP_FULL_BOARD_HIGH);
    for (const r of high) {
      if (r.line != null) picked.set(r.line, r);
    }
  }

  return [...picked.values()];
}

/**
 * Per (player, market) keep bettable alt rungs near the main line.
 * fullBoard mode (Coach scan only) also keeps milestone yard/attempt numbers
 * and higher count alts (pass TDs, sacks, receptions) too far for the default cap.
 */
export function trimAlternatePropRungs<T extends PropAltRow>(
  allRows: T[],
  opts?: { fullBoard?: boolean },
): T[] {
  const fullBoard = !!opts?.fullBoard;
  const mainLineByPM = new Map<string, number>();
  for (const r of allRows) {
    if (!r.alt && r.line != null) {
      const pm = `${r.player}|${r.market}`;
      if (!mainLineByPM.has(pm)) mainLineByPM.set(pm, r.line);
    }
  }

  const altByPM = new Map<string, T[]>();
  for (const r of allRows) {
    if (!r.alt) continue;
    if (!inPriceBand(r.overPrice, r.underPrice)) continue;
    const pm = `${r.player}|${r.market}`;
    const list = altByPM.get(pm) ?? [];
    list.push(r);
    altByPM.set(pm, list);
  }

  const trimmedAlts: T[] = [];
  for (const [pm, list] of altByPM) {
    const mainLine = mainLineByPM.get(pm);
    const market = pm.slice(pm.indexOf("|") + 1);
    const sorted = sortAltsByMainDistance(list, mainLine);

    if (!fullBoard || !isFullBoardNumericFamily(market)) {
      trimmedAlts.push(...sorted.slice(0, ALT_CAP_DEFAULT));
      continue;
    }

    trimmedAlts.push(...pickFullBoardAlts(sorted, mainLine, market));
  }
  return trimmedAlts;
}

/** Mains first, then trimmed alts — same order the props route has always used. */
export function aggregatePropRowsWithAltTrim<T extends PropAltRow>(
  allRows: T[],
  opts?: { fullBoard?: boolean },
): T[] {
  const mains = allRows.filter((r) => !r.alt);
  const trimmedAlts = trimAlternatePropRungs(allRows, opts);
  return [...mains, ...trimmedAlts];
}

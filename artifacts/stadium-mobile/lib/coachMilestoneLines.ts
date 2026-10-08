/**
 * Sportsbook “N+” / milestone alt recognition for Coach deep-sim selection.
 * Mirrors server propAltTrim.isMilestonePropLine + isHigherCountAltLine so
 * posted milestones (40+ yards, 200+ pass, 5+ receptions, 20+ points, 2+ hits)
 * are preferred inside the existing 3-rung-per-ladder sim budget.
 * Does not invent lines or odds — only classifies posted half-point thresholds.
 */

function canonMarket(market: string | null | undefined): string {
  let k = String(market ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");
  if (k.endsWith("_alternate")) k = k.slice(0, -"_alternate".length);
  k = k.replace(/_(q1|q2|q3|q4|h1|h2|1h|2h|f5)$/i, "");
  return k;
}

function isHalfPoint(line: number): boolean {
  return Math.abs(line - Math.floor(line) - 0.5) < 0.05;
}

const YARDS = new Set([
  "player_rush_yds",
  "player_pass_yds",
  "player_reception_yds",
  "player_pass_rush_yds",
  "player_rush_reception_yds",
  "player_pass_rush_reception_yds",
  "pass_yds",
  "rush_yds",
  "reception_yds",
  "receiving_yards",
  "passing_yards",
  "rushing_yards",
]);

const BASKETBALL = new Set([
  "player_points",
  "player_rebounds",
  "player_assists",
  "player_threes",
  "points",
  "rebounds",
  "assists",
  "threes",
]);

const BASEBALL = new Set([
  "batter_hits",
  "batter_total_bases",
  "batter_home_runs",
  "pitcher_strikeouts",
  "batter_hits_runs_rbis",
  "batter_rbis",
  "batter_runs",
  "batter_runs_scored",
  "pitcher_outs",
  "hits",
  "total_bases",
  "strikeouts",
]);

const HOCKEY = new Set([
  "player_points",
  "player_assists",
  "player_shots_on_goal",
  "player_goals",
  "shots_on_goal",
  "goals",
]);

const COUNT = new Set([
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
  "receptions",
  "pass_tds",
  "sacks",
]);

/** True when a posted line is a common sportsbook N+ / milestone threshold. */
export function isPostedMilestoneAltLine(
  line: number | null | undefined,
  market: string | null | undefined,
  mainLine?: number | null,
): boolean {
  if (line == null || !Number.isFinite(line)) return false;
  const canon = canonMarket(market);
  const wholeUp = Math.ceil(line);
  const whole = Math.round(line);
  const half = isHalfPoint(line);

  if (YARDS.has(canon) || /yard/.test(canon) || /\byds?\b/.test(canon.replace(/_/g, " "))) {
    const on25 = Math.abs(line - whole) <= 0.6 && whole % 25 <= 1;
    const skill =
      half &&
      (wholeUp === 25 ||
        wholeUp === 30 ||
        wholeUp === 40 ||
        wholeUp === 50 ||
        wholeUp === 60 ||
        wholeUp === 75 ||
        wholeUp === 100 ||
        wholeUp % 25 === 0);
    return (on25 || skill) && (wholeUp >= 25 || whole >= 25);
  }

  if (canon === "player_pass_attempts" || canon === "player_pass_completions") {
    return half && wholeUp >= 20;
  }
  if (canon === "player_rush_attempts") {
    return half && wholeUp >= 10;
  }

  if (BASKETBALL.has(canon) || HOCKEY.has(canon)) {
    if (canon === "player_threes" || canon === "threes") {
      return half && wholeUp >= 2 && wholeUp <= 8;
    }
    if (canon === "player_shots_on_goal" || canon === "shots_on_goal") {
      return half && wholeUp >= 3;
    }
    if (canon === "player_goals" || canon === "goals") {
      return half && wholeUp >= 1 && wholeUp <= 4;
    }
    if (
      canon === "player_points" ||
      canon === "player_assists" ||
      canon === "points" ||
      canon === "assists"
    ) {
      const bb = half && wholeUp >= 10 && wholeUp % 5 === 0;
      const nhl = half && wholeUp >= 1 && wholeUp <= 4;
      return bb || nhl;
    }
    if (BASKETBALL.has(canon)) return half && wholeUp >= 10 && wholeUp % 5 === 0;
    return half && wholeUp >= 1 && wholeUp <= 4;
  }

  if (BASEBALL.has(canon)) {
    if (canon === "pitcher_strikeouts" || canon === "strikeouts") {
      return half && wholeUp >= 5;
    }
    if (canon === "batter_home_runs") return half && wholeUp >= 1 && wholeUp <= 2;
    if (canon === "batter_hits" || canon === "hits" || canon === "batter_total_bases" || canon === "total_bases") {
      return half && wholeUp >= 2 && wholeUp <= 6;
    }
    return half && wholeUp >= 2;
  }

  // Higher count alts (5+ receptions, 2+ pass TDs, …) relative to main when known.
  if (COUNT.has(canon) && half) {
    const mainWhole = mainLine != null && Number.isFinite(mainLine) ? Math.round(mainLine) : null;
    if (mainWhole != null && whole <= mainWhole) return false;
    if (canon === "player_pass_tds" || canon === "pass_tds") return whole >= 1 && whole <= 5;
    if (canon === "player_sacks" || canon === "sacks") return whole >= 1 && whole <= 3;
    if (canon === "player_receptions" || canon === "receptions") return whole >= 2 && whole <= 12;
    if (canon === "player_pass_interceptions") return whole >= 1 && whole <= 2;
    if (canon === "player_pass_attempts" || canon === "player_pass_completions") {
      return mainWhole == null || whole >= mainWhole + 3;
    }
    if (canon === "player_rush_attempts") {
      return mainWhole == null || whole >= mainWhole + 2;
    }
  }

  return false;
}

/** Market-family key for alt eligibility reporting (yards / volume / points / …). */
export function milestoneMarketFamily(market: string | null | undefined): string {
  const c = canonMarket(market);
  if (YARDS.has(c) || /yard|\byds?\b/.test(c.replace(/_/g, " "))) return "yards";
  if (c.includes("reception") || c === "receptions") return "receptions";
  if (c.includes("pass_td") || c.includes("touchdown")) return "touchdowns";
  if (BASKETBALL.has(c) && (c.includes("point") || c === "points")) return "points";
  if (BASKETBALL.has(c)) return "basketball_counting";
  if (BASEBALL.has(c)) return "baseball";
  if (HOCKEY.has(c)) return "hockey";
  if (COUNT.has(c)) return "volume";
  return "other";
}

// Which markets have a dedicated Monte Carlo model — only these get AI recommendations.

export type SimModelKind =
  | "fullGame"
  | "period"
  | "teamTotal"
  | "raceTo"
  | "playerProp"
  | "unsupported";

export type SimPeriodScope =
  | "fg"
  | "h1"
  | "h2"
  | "q1"
  | "q2"
  | "q3"
  | "q4"
  | "f5"
  | "i1"
  | "p1"
  | "p2"
  | "p3";

const PERIOD_UNSUPPORTED_SPORTS = new Set(["tennis", "tabletennis", "cricket", "ufc", "mma", "soccer"]);

export function parseMarketPeriod(market: string): SimPeriodScope {
  const m = String(market ?? "").toLowerCase();
  if (/\bq1\b|first quarter|1st quarter/.test(m)) return "q1";
  if (/\bq2\b|second quarter|2nd quarter/.test(m)) return "q2";
  if (/\bq3\b|third quarter|3rd quarter/.test(m)) return "q3";
  if (/\bq4\b|fourth quarter|4th quarter/.test(m)) return "q4";
  if (/\b1h\b|first half|1st half/.test(m)) return "h1";
  if (/\b2h\b|second half|2nd half/.test(m)) return "h2";
  if (/\bf5\b|first 5|1st 5|five innings/.test(m)) return "f5";
  if (/\b1st inning\b|first inning/.test(m)) return "i1";
  if (/\b1p\b|first period|1st period/.test(m)) return "p1";
  if (/\b2p\b|second period|2nd period/.test(m)) return "p2";
  if (/\b3p\b|third period|3rd period/.test(m)) return "p3";
  return "fg";
}

export function simModelForMarket(
  market: string,
  opts: { isProp?: boolean; sport?: string },
): SimModelKind {
  if (opts.isProp) return "playerProp";
  const m = String(market ?? "").toLowerCase();
  if (/race to/.test(m)) return "raceTo";
  if (/team total/.test(m)) return "teamTotal";
  const period = parseMarketPeriod(market);
  if (period !== "fg") {
    const sport = (opts.sport ?? "").toLowerCase();
    if (PERIOD_UNSUPPORTED_SPORTS.has(sport)) return "unsupported";
    if (period === "p1" || period === "p2" || period === "p3") {
      return sport === "nhl" ? "period" : "unsupported";
    }
    if (period === "f5" || period === "i1") {
      return sport === "mlb" ? "period" : "unsupported";
    }
    return "period";
  }
  if (/moneyline|spread|run line|puck line|total|alt spread|alt total/.test(m)) return "fullGame";
  return "unsupported";
}

export function marketSupportsSimulation(
  market: string,
  opts: { isProp?: boolean; sport?: string },
): boolean {
  return simModelForMarket(market, opts) !== "unsupported";
}

/** True when a pick has a real sim-backed grade (not rubric-only). */
export function pickHasSimGrade(
  pick: { market?: string; isProp?: boolean; sport?: string },
  simHit: number | null | undefined,
): boolean {
  if (!marketSupportsSimulation(pick.market ?? "", pick)) return false;
  return simHit != null && Number.isFinite(simHit) && simHit > 0 && simHit < 1;
}

export const NOT_YET_AI_GRADED = "Not yet AI graded";

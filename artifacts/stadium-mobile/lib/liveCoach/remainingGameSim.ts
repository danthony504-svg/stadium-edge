/**
 * Live Coach remaining-game Monte Carlo (NBA / WNBA / NFL / NHL).
 *
 * Separate from pregame /sports/simulate/game-outcome and runGameMonteCarlo.
 * Simulates ONLY from the current live state through the remainder of the game.
 * Never invents possession, fouls, lineups, injuries, or player stats.
 *
 * NHL Phase 3A uses a dedicated remaining-game path (not full-game nhl-shift).
 */

import {
  resolveNhlLiveMarketSettlement,
  type NhlSettlementHorizon,
} from "./nhlMarketSettlement.ts";

/** Sports with a live remaining-game path. */
export type LiveCoachSport = "nba" | "wnba" | "nfl" | "nhl";
/** @deprecated Use LiveCoachSport — kept for existing Phase 2A imports. */
export type LiveBasketballSport = Exclude<LiveCoachSport, "nfl" | "nhl">;

export type LiveCoverQuery = {
  id: string;
  kind: "ml" | "spread" | "total";
  teamSide?: "home" | "away";
  line?: number | null;
  totalSide?: "over" | "under";
  /** NHL only — settlement horizon for this specific market. */
  nhlSettlement?: NhlSettlementHorizon;
};

export type RemainingGameSimInput = {
  sport: LiveCoachSport;
  homeScore: number;
  awayScore: number;
  /** Basketball/NFL: 1–4 regulation, 5+ OT. NHL: 1–3 regulation, 4+ OT/SO. */
  period: number;
  /** Countdown "M:SS", or halftime / end-of-period markers. */
  clock: string;
  periodLabel?: string | null;
  /** Pregame / season PPG (or GPG for NHL) when reliable data exists. */
  homeBaselinePpg?: number | null;
  awayBaselinePpg?: number | null;
  simulations?: number;
  seed?: number;
  coverQueries?: LiveCoverQuery[];
};

export type RemainingGameSimResult = {
  simulations: number;
  remainingMinutes: number;
  elapsedMinutes: number;
  homeProjectedFinal: number;
  awayProjectedFinal: number;
  homeWinProbability: number;
  awayWinProbability: number;
  tieProbability: number;
  coverHitRates: Record<string, number>;
  /** True when this path used remaining-game math (always for this module). */
  remainingGameOnly: true;
};

const NBA_Q_MIN = 12;
const WNBA_Q_MIN = 10;
const NFL_Q_MIN = 15;
const NHL_P_MIN = 20;
const NBA_OT_MIN = 5;
const WNBA_OT_MIN = 5;
const NFL_OT_MIN = 10;
/** NHL regular-season OT is 5:00; playoff OT periods are 20:00 (clock-capped). */
const NHL_OT_MIN = 5;
const NHL_OT_MAX = 20;
const NBA_LEAGUE_PPG = 112;
const WNBA_LEAGUE_PPG = 82;
const NFL_LEAGUE_PPG = 22;
const NHL_LEAGUE_GPG = 3.1;

const round2 = (n: number) => Math.round(n * 100) / 100;
const round3 = (n: number) => Math.round(n * 1000) / 1000;

/** Mulberry32 — same family as prop sim for deterministic seeds. */
export function createLiveSimRng(seed?: number): () => number {
  if (seed == null || !Number.isFinite(seed)) {
    return () => Math.random();
  }
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function normalSample(mean: number, std: number, rng: () => number): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  const z = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
  return mean + z * std;
}

export function isLiveCoachSport(sport: string | null | undefined): sport is LiveCoachSport {
  const s = String(sport ?? "").trim().toLowerCase();
  return s === "nba" || s === "wnba" || s === "nfl" || s === "nhl";
}

/** Regulation periods: NHL 3; basketball/NFL 4. */
export function regulationPeriodCount(sport: LiveCoachSport): number {
  return sport === "nhl" ? 3 : 4;
}

/** First overtime period number (NHL=4, others=5). */
export function overtimePeriodNumber(sport: LiveCoachSport): number {
  return sport === "nhl" ? 4 : 5;
}

export function periodLengthMinutes(sport: LiveCoachSport): number {
  if (sport === "wnba") return WNBA_Q_MIN;
  if (sport === "nfl") return NFL_Q_MIN;
  if (sport === "nhl") return NHL_P_MIN;
  return NBA_Q_MIN;
}

export function regulationMinutes(sport: LiveCoachSport): number {
  return periodLengthMinutes(sport) * regulationPeriodCount(sport);
}

export function otLengthMinutes(sport: LiveCoachSport): number {
  if (sport === "wnba") return WNBA_OT_MIN;
  if (sport === "nfl") return NFL_OT_MIN;
  if (sport === "nhl") return NHL_OT_MIN;
  return NBA_OT_MIN;
}

export function leagueBaselinePpg(sport: LiveCoachSport): number {
  if (sport === "wnba") return WNBA_LEAGUE_PPG;
  if (sport === "nfl") return NFL_LEAGUE_PPG;
  if (sport === "nhl") return NHL_LEAGUE_GPG;
  return NBA_LEAGUE_PPG;
}

/** Parse countdown clock "M:SS" → seconds remaining in the period. */
export function parseCountdownClockSeconds(clock: string | null | undefined): number | null {
  if (clock == null) return null;
  const s = String(clock).trim();
  if (!s) return null;
  const m = s.match(/^(\d{1,3}):(\d{2})$/);
  if (!m) return null;
  const mins = parseInt(m[1]!, 10);
  const secs = parseInt(m[2]!, 10);
  if (!Number.isFinite(mins) || !Number.isFinite(secs) || secs >= 60) return null;
  return mins * 60 + secs;
}

/**
 * ESPN period-transition labels ("End of 4th", "Halftime", "End of 3rd", …).
 * When present, a reset displayClock like "20:00" must NOT be read as time
 * still left in the period that just ended.
 */
export type EndOfPeriodTransition =
  | { kind: "halftime"; completedPeriod: 2 }
  | { kind: "end_of_quarter"; completedPeriod: 1 | 2 | 3 | 4 };

export function parseEndOfPeriodLabel(
  periodLabel?: string | null,
): EndOfPeriodTransition | null {
  const pl = String(periodLabel ?? "").toLowerCase().replace(/\s+/g, " ").trim();
  if (!pl) return null;
  if (/halftime|half\s*time/.test(pl) || pl === "ht" || pl === "half") {
    return { kind: "halftime", completedPeriod: 2 };
  }
  const m = pl.match(
    /\bend(?:\s+of)?\s+(?:the\s+)?(1st|2nd|3rd|4th|first|second|third|fourth)(?:\s+(?:q(?:tr|uarter)?|p(?:eriod)?))?\b/,
  );
  if (!m) return null;
  const token = m[1]!;
  const completedPeriod =
    token === "1st" || token === "first"
      ? 1
      : token === "2nd" || token === "second"
        ? 2
        : token === "3rd" || token === "third"
          ? 3
          : 4;
  // Basketball/NFL: End of 2nd ≡ halftime. NHL uses the same completedPeriod
  // number but remaining-time math is sport-aware (1 period left, not 2).
  if (completedPeriod === 2) return { kind: "halftime", completedPeriod: 2 };
  return { kind: "end_of_quarter", completedPeriod };
}

export function isHalftimeClock(
  clock: string | null | undefined,
  periodLabel?: string | null,
  sport?: LiveCoachSport,
): boolean {
  const c = String(clock ?? "").trim().toLowerCase();
  const pl = String(periodLabel ?? "").trim().toLowerCase();
  if (c === "ht" || c === "half" || c === "halftime") return true;
  if (/halftime|half\s*time/.test(pl)) return true;
  // NHL: "End of 2nd" is an intermission, not basketball halftime.
  if (sport === "nhl") return false;
  const end = parseEndOfPeriodLabel(periodLabel);
  return end?.kind === "halftime";
}

export function isExplicitShootoutState(
  period: number | null | undefined,
  periodLabel?: string | null,
): boolean {
  const pl = String(periodLabel ?? "").toLowerCase();
  if (/\bshootout\b|\bso\b/.test(pl) && !/\bend\s+of\b/.test(pl)) return true;
  // ESPN sometimes uses period 5 for shootout in NHL.
  if (period != null && Number.isFinite(period) && period >= 5 && /\bso\b|\bshootout\b/.test(pl)) {
    return true;
  }
  return false;
}

export function isFinalState(periodLabel?: string | null): boolean {
  const pl = String(periodLabel ?? "").toLowerCase();
  return /\bfinal\b|\bf\/?\s*ot\b|\bf\/?\s*so\b/.test(pl);
}

/**
 * Explicit OT — sport-aware period thresholds.
 * Basketball/NFL: period ≥ 5 or OT label (not "End of …").
 * NHL: period ≥ 4 or OT label; shootout is separate.
 */
export function isExplicitOvertimeState(
  period: number | null | undefined,
  periodLabel?: string | null,
  sport: LiveCoachSport = "nba",
): boolean {
  if (isExplicitShootoutState(period, periodLabel)) return false;
  const pl = String(periodLabel ?? "").toLowerCase();
  if (/\bend\s+of\b/.test(pl)) return false;
  const otPeriod = overtimePeriodNumber(sport);
  if (period != null && Number.isFinite(period) && period >= otPeriod) {
    // NHL period≥4 without OT/SO label during End of 3rd transition is handled
    // by end-of-regulation gate; bare period≥4 with live clock counts as OT.
    if (sport === "nhl") {
      if (/\bot\b|\bovertime\b/.test(pl)) return true;
      // Period 4+ with no End-of label → OT (ESPN often sends period=4 in OT).
      return !parseEndOfPeriodLabel(periodLabel);
    }
    return true;
  }
  if (!pl) return false;
  return /\bot\b|\bovertime\b/.test(pl);
}

/**
 * True when regulation has ended and we are not yet in an explicit OT/SO state.
 * NBA/NFL: End of 4th. NHL: End of 3rd.
 */
export function isEndOfRegulationTransition(
  period: number | null | undefined,
  periodLabel?: string | null,
  sport: LiveCoachSport = "nba",
): boolean {
  if (isExplicitOvertimeState(period, periodLabel, sport)) return false;
  if (isExplicitShootoutState(period, periodLabel)) return false;
  const end = parseEndOfPeriodLabel(periodLabel);
  const regEnd = regulationPeriodCount(sport);
  if (!end || end.completedPeriod !== regEnd) return false;
  return true;
}

/**
 * Usable clock for Live Coach eligibility:
 * - parseable M:SS countdown, or
 * - known halftime / end-of-period transition marker, or
 * - explicit shootout (no countdown)
 */
export function hasUsableLiveClock(
  clock: string | null | undefined,
  periodLabel?: string | null,
  sport?: LiveCoachSport,
): boolean {
  if (isExplicitShootoutState(null, periodLabel)) return true;
  if (parseEndOfPeriodLabel(periodLabel)) return true;
  if (isHalftimeClock(clock, periodLabel, sport)) return true;
  return parseCountdownClockSeconds(clock) != null;
}

function nhlOtCapMinutes(clockMin: number): number {
  // Playoff OT can show up to 20:00; regular season OT is 5:00.
  if (clockMin > NHL_OT_MIN + 0.01) return Math.min(NHL_OT_MAX, clockMin);
  return Math.min(NHL_OT_MIN, clockMin);
}

/**
 * Remaining regulation (+ OT period) minutes from current period + clock.
 * Returns null when period/clock cannot ground a remaining-time estimate.
 *
 * End-of-period labels force the completed period to 0:00 remaining so a
 * reset ESPN displayClock ("20:00" / "12:00") is never treated as time left.
 */
export function remainingMinutesFromState(opts: {
  sport: LiveCoachSport;
  period: number;
  clock: string;
  periodLabel?: string | null;
}): number | null {
  const qLen = periodLengthMinutes(opts.sport);
  const regPeriods = regulationPeriodCount(opts.sport);
  const otLen = otLengthMinutes(opts.sport);
  const period = opts.period;

  if (!Number.isFinite(period) || period < 1) return null;

  // Shootout: no timed remaining (handled in NHL sim path).
  if (opts.sport === "nhl" && isExplicitShootoutState(period, opts.periodLabel)) {
    return 0;
  }

  // Period-transition / end-of-period: completed period → 0 remaining in it.
  const end = parseEndOfPeriodLabel(opts.periodLabel);
  if (end) {
    if (end.completedPeriod === regPeriods) {
      // Regulation over. OT only when explicitly active (caller gate).
      if (isExplicitOvertimeState(period, opts.periodLabel, opts.sport)) {
        const clockSec = parseCountdownClockSeconds(opts.clock);
        if (clockSec == null) return null;
        const clockMin = clockSec / 60;
        if (opts.sport === "nhl") return Math.max(0, nhlOtCapMinutes(clockMin));
        return Math.max(0, Math.min(otLen, clockMin));
      }
      return 0;
    }
    // End of earlier periods → only later regulation periods remain.
    // NHL End of 1st → 40; End of 2nd → 20. NBA End of 2nd → 24.
    return Math.max(0, (regPeriods - end.completedPeriod) * qLen);
  }

  if (isHalftimeClock(opts.clock, opts.periodLabel, opts.sport)) {
    if (opts.sport === "nhl") return qLen; // P3 remaining
    return qLen * 2; // Q3+Q4
  }

  const clockSec = parseCountdownClockSeconds(opts.clock);
  if (clockSec == null) return null;
  const clockMin = clockSec / 60;

  if (isExplicitOvertimeState(period, opts.periodLabel, opts.sport)) {
    if (opts.sport === "nhl") return Math.max(0, nhlOtCapMinutes(clockMin));
    return Math.max(0, Math.min(otLen, clockMin));
  }

  // Still in regulation.
  if (period > regPeriods) {
    // Ambiguous: period past regulation without OT/SO label.
    return null;
  }

  const futurePeriods = Math.max(0, regPeriods - period);
  return Math.max(0, clockMin + futurePeriods * qLen);
}

export function elapsedMinutesFromState(opts: {
  sport: LiveCoachSport;
  period: number;
  clock: string;
  periodLabel?: string | null;
}): number | null {
  if (opts.sport === "nhl" && isExplicitShootoutState(opts.period, opts.periodLabel)) {
    return regulationMinutes(opts.sport) + otLengthMinutes(opts.sport);
  }
  const rem = remainingMinutesFromState(opts);
  if (rem == null) return null;
  if (isExplicitOvertimeState(opts.period, opts.periodLabel, opts.sport)) {
    const otLen =
      opts.sport === "nhl"
        ? Math.max(otLengthMinutes(opts.sport), rem)
        : otLengthMinutes(opts.sport);
    return regulationMinutes(opts.sport) + (otLen - rem);
  }
  const end = parseEndOfPeriodLabel(opts.periodLabel);
  if (end) {
    return end.completedPeriod * periodLengthMinutes(opts.sport);
  }
  if (isHalftimeClock(opts.clock, opts.periodLabel, opts.sport)) {
    if (opts.sport === "nhl") return periodLengthMinutes(opts.sport) * 2;
    return regulationMinutes(opts.sport) / 2;
  }
  return Math.max(0, regulationMinutes(opts.sport) - rem);
}

function coverHits(
  q: LiveCoverQuery,
  homeFinal: number,
  awayFinal: number,
): boolean {
  if (q.kind === "ml") {
    if (q.teamSide === "home") return homeFinal > awayFinal;
    if (q.teamSide === "away") return awayFinal > homeFinal;
    return false;
  }
  if (q.kind === "spread") {
    const line = q.line ?? 0;
    if (q.teamSide === "home") return homeFinal + line > awayFinal;
    if (q.teamSide === "away") return awayFinal + line > homeFinal;
    return false;
  }
  if (q.kind === "total") {
    const line = q.line ?? 0;
    const total = homeFinal + awayFinal;
    if (q.totalSide === "over") return total > line;
    if (q.totalSide === "under") return total < line;
    return false;
  }
  return false;
}

/**
 * Expected remaining points/goals for one team from baseline + observed pace.
 */
function expectedRemainingPoints(opts: {
  sport: LiveCoachSport;
  currentScore: number;
  elapsedMin: number;
  remainingMin: number;
  baselinePpg: number | null | undefined;
  homeCourtBoost?: number;
}): number {
  const full = regulationMinutes(opts.sport);
  const league = leagueBaselinePpg(opts.sport);
  const baseline =
    opts.baselinePpg != null && Number.isFinite(opts.baselinePpg)
      ? opts.baselinePpg
      : league;

  let pacePpg = baseline;
  const blendAfter = opts.sport === "nhl" ? 8 : 6;
  if (opts.elapsedMin >= blendAfter && opts.elapsedMin > 0) {
    const observedPpg = (opts.currentScore / opts.elapsedMin) * full;
    if (Number.isFinite(observedPpg) && observedPpg > 0) {
      const w = Math.min(0.65, opts.elapsedMin / full);
      pacePpg = baseline * (1 - w) + observedPpg * w;
    }
  }

  const mean = (pacePpg / full) * opts.remainingMin;
  const boost = opts.homeCourtBoost ?? 0;
  return Math.max(0, mean * (1 + boost));
}

function sampleNonNegInt(mean: number, std: number, rng: () => number): number {
  return Math.max(0, Math.round(normalSample(mean, std, rng)));
}

/**
 * NHL remaining-game sim: goals from current score/period/clock only.
 * Settlement horizon per cover query — ML may go through SO; totals stop at OT.
 */
function runNhlRemainingGameSim(
  input: RemainingGameSimInput,
): RemainingGameSimResult | null {
  if (isFinalState(input.periodLabel)) return null;
  if (isEndOfRegulationTransition(input.period, input.periodLabel, "nhl")) {
    return null;
  }

  const inShootout = isExplicitShootoutState(input.period, input.periodLabel);
  const inOt = isExplicitOvertimeState(input.period, input.periodLabel, "nhl");

  const remainingMin = remainingMinutesFromState({
    sport: "nhl",
    period: input.period,
    clock: input.clock,
    periodLabel: input.periodLabel,
  });
  const elapsedMin = elapsedMinutesFromState({
    sport: "nhl",
    period: input.period,
    clock: input.clock,
    periodLabel: input.periodLabel,
  });
  if (remainingMin == null || elapsedMin == null) return null;

  // Timed remaining required unless we are in an explicit shootout.
  if (!inShootout && remainingMin < 0.05 && !inOt) return null;
  if (inOt && !inShootout && remainingMin < 0.05) return null;

  const queries = input.coverQueries ?? [];
  // Every NHL query must carry a resolved settlement horizon.
  for (const q of queries) {
    if (!q.nhlSettlement) return null;
  }

  const n = input.simulations ?? 10_000;
  const rng = createLiveSimRng(input.seed);

  const hits: Record<string, number> = {};
  for (const q of queries) hits[q.id] = 0;

  let homeWins = 0;
  let awayWins = 0;
  let ties = 0;
  let homeFinalSum = 0;
  let awayFinalSum = 0;

  const homeBoost = 0.03;

  for (let i = 0; i < n; i++) {
    let home = input.homeScore;
    let away = input.awayScore;
    let mlHome = home;
    let mlAway = away;
    let scoreHome = home;
    let scoreAway = away;

    if (inShootout) {
      // Tied entering SO — only ML through_shootout is meaningful.
      if (home !== away) {
        // Non-tied shootout board is ambiguous → treat as already decided for scores.
        scoreHome = home;
        scoreAway = away;
        mlHome = home;
        mlAway = away;
      } else {
        const homeWinsSo = rng() < 0.5 + homeBoost / 2;
        mlHome = homeWinsSo ? home + 1 : home;
        mlAway = homeWinsSo ? away : away + 1;
        // Totals/spreads exclude SO — scores unchanged.
        scoreHome = home;
        scoreAway = away;
      }
    } else if (inOt) {
      const rem = Math.max(remainingMin, 0.05);
      const homeMean = expectedRemainingPoints({
        sport: "nhl",
        currentScore: home,
        elapsedMin: elapsedMin,
        remainingMin: rem,
        baselinePpg: input.homeBaselinePpg,
        homeCourtBoost: homeBoost,
      });
      const awayMean = expectedRemainingPoints({
        sport: "nhl",
        currentScore: away,
        elapsedMin: elapsedMin,
        remainingMin: rem,
        baselinePpg: input.awayBaselinePpg,
      });
      // Sudden-death OT: at most one deciding goal in the remaining OT window
      // for regular-season 3v3; still sample low means.
      const homeStd = Math.max(0.25, homeMean * 0.9);
      const awayStd = Math.max(0.25, awayMean * 0.9);
      let hAdd = sampleNonNegInt(homeMean, homeStd, rng);
      let aAdd = sampleNonNegInt(awayMean, awayStd, rng);
      // Sudden death: if both would score, keep only the earlier (random).
      if (hAdd > 0 && aAdd > 0) {
        if (rng() < 0.5) aAdd = 0;
        else hAdd = 0;
      }
      if (hAdd > 1) hAdd = 1;
      if (aAdd > 1) aAdd = 1;
      home += hAdd;
      away += aAdd;
      scoreHome = home;
      scoreAway = away;
      mlHome = home;
      mlAway = away;
      if (home === away) {
        // Still tied after OT → shootout for ML horizons that include SO.
        const homeWinsSo = rng() < 0.5 + homeBoost / 2;
        mlHome = homeWinsSo ? home + 1 : home;
        mlAway = homeWinsSo ? away : away + 1;
      }
    } else {
      // Regulation remaining (+ possible OT/SO continuation).
      const rem = Math.max(remainingMin, 0.05);
      const homeMean = expectedRemainingPoints({
        sport: "nhl",
        currentScore: home,
        elapsedMin,
        remainingMin: rem,
        baselinePpg: input.homeBaselinePpg,
        homeCourtBoost: homeBoost,
      });
      const awayMean = expectedRemainingPoints({
        sport: "nhl",
        currentScore: away,
        elapsedMin,
        remainingMin: rem,
        baselinePpg: input.awayBaselinePpg,
      });
      const homeStd = Math.max(0.35, homeMean * 0.85, rem * 0.045);
      const awayStd = Math.max(0.35, awayMean * 0.85, rem * 0.045);
      home += sampleNonNegInt(homeMean, homeStd, rng);
      away += sampleNonNegInt(awayMean, awayStd, rng);
      scoreHome = home;
      scoreAway = away;
      mlHome = home;
      mlAway = away;

      if (home === away) {
        // OT sample (5:00 regular season).
        const otRem = NHL_OT_MIN;
        const hOtMean = expectedRemainingPoints({
          sport: "nhl",
          currentScore: home,
          elapsedMin: regulationMinutes("nhl"),
          remainingMin: otRem,
          baselinePpg: input.homeBaselinePpg,
          homeCourtBoost: homeBoost,
        });
        const aOtMean = expectedRemainingPoints({
          sport: "nhl",
          currentScore: away,
          elapsedMin: regulationMinutes("nhl"),
          remainingMin: otRem,
          baselinePpg: input.awayBaselinePpg,
        });
        let hAdd = sampleNonNegInt(hOtMean, Math.max(0.25, hOtMean * 0.9), rng);
        let aAdd = sampleNonNegInt(aOtMean, Math.max(0.25, aOtMean * 0.9), rng);
        if (hAdd > 0 && aAdd > 0) {
          if (rng() < 0.5) aAdd = 0;
          else hAdd = 0;
        }
        if (hAdd > 1) hAdd = 1;
        if (aAdd > 1) aAdd = 1;
        home += hAdd;
        away += aAdd;
        scoreHome = home;
        scoreAway = away;
        mlHome = home;
        mlAway = away;
        if (home === away) {
          const homeWinsSo = rng() < 0.5 + homeBoost / 2;
          mlHome = homeWinsSo ? home + 1 : home;
          mlAway = homeWinsSo ? away : away + 1;
        }
      }
    }

    // Projected finals for display: scoreboard goals (exclude SO).
    homeFinalSum += scoreHome;
    awayFinalSum += scoreAway;
    if (mlHome > mlAway) homeWins += 1;
    else if (mlAway > mlHome) awayWins += 1;
    else ties += 1;

    for (const q of queries) {
      const horizon = q.nhlSettlement!;
      let h = scoreHome;
      let a = scoreAway;
      if (horizon === "through_shootout" && q.kind === "ml") {
        h = mlHome;
        a = mlAway;
      }
      // through_ot / regulation_only: use scoreboard goals (no SO).
      if (horizon === "regulation_only") {
        // Should not reach sim — settlement rejects regulation-only.
        continue;
      }
      if (coverHits(q, h, a)) hits[q.id] = (hits[q.id] ?? 0) + 1;
    }
  }

  const coverHitRates: Record<string, number> = {};
  for (const q of queries) {
    coverHitRates[q.id] = round3((hits[q.id] ?? 0) / n);
  }

  return {
    simulations: n,
    remainingMinutes: round2(inShootout ? 0 : remainingMin),
    elapsedMinutes: round2(elapsedMin),
    homeProjectedFinal: round2(homeFinalSum / n),
    awayProjectedFinal: round2(awayFinalSum / n),
    homeWinProbability: round3(homeWins / n),
    awayWinProbability: round3(awayWins / n),
    tieProbability: round3(ties / n),
    coverHitRates,
    remainingGameOnly: true,
  };
}

/**
 * Expected remaining points path for NBA/WNBA/NFL (unchanged math).
 */
function runBasketballFootballRemainingGameSim(
  input: RemainingGameSimInput,
): RemainingGameSimResult | null {
  const remainingMin = remainingMinutesFromState({
    sport: input.sport,
    period: input.period,
    clock: input.clock,
    periodLabel: input.periodLabel,
  });
  const elapsedMin = elapsedMinutesFromState({
    sport: input.sport,
    period: input.period,
    clock: input.clock,
    periodLabel: input.periodLabel,
  });
  if (remainingMin == null || elapsedMin == null) return null;
  if (remainingMin < 0.05) return null;

  const n = input.simulations ?? 10_000;
  const rng = createLiveSimRng(input.seed);

  const homeMean = expectedRemainingPoints({
    sport: input.sport,
    currentScore: input.homeScore,
    elapsedMin,
    remainingMin,
    baselinePpg: input.homeBaselinePpg,
    homeCourtBoost: 0.02,
  });
  const awayMean = expectedRemainingPoints({
    sport: input.sport,
    currentScore: input.awayScore,
    elapsedMin,
    remainingMin,
    baselinePpg: input.awayBaselinePpg,
  });

  const homeStd = Math.max(2.5, homeMean * 0.28, remainingMin * 0.55);
  const awayStd = Math.max(2.5, awayMean * 0.28, remainingMin * 0.55);

  const queries = input.coverQueries ?? [];
  const hits: Record<string, number> = {};
  for (const q of queries) hits[q.id] = 0;

  let homeWins = 0;
  let awayWins = 0;
  let ties = 0;
  let homeFinalSum = 0;
  let awayFinalSum = 0;

  for (let i = 0; i < n; i++) {
    const homeAdd = Math.max(0, normalSample(homeMean, homeStd, rng));
    const awayAdd = Math.max(0, normalSample(awayMean, awayStd, rng));
    const homeFinal = Math.round(input.homeScore + homeAdd);
    const awayFinal = Math.round(input.awayScore + awayAdd);
    homeFinalSum += homeFinal;
    awayFinalSum += awayFinal;
    if (homeFinal > awayFinal) homeWins += 1;
    else if (awayFinal > homeFinal) awayWins += 1;
    else ties += 1;
    for (const q of queries) {
      if (coverHits(q, homeFinal, awayFinal)) hits[q.id] = (hits[q.id] ?? 0) + 1;
    }
  }

  const coverHitRates: Record<string, number> = {};
  for (const q of queries) {
    coverHitRates[q.id] = round3((hits[q.id] ?? 0) / n);
  }

  return {
    simulations: n,
    remainingMinutes: round2(remainingMin),
    elapsedMinutes: round2(elapsedMin),
    homeProjectedFinal: round2(homeFinalSum / n),
    awayProjectedFinal: round2(awayFinalSum / n),
    homeWinProbability: round3(homeWins / n),
    awayWinProbability: round3(awayWins / n),
    tieProbability: round3(ties / n),
    coverHitRates,
    remainingGameOnly: true,
  };
}

/**
 * Run 10k remaining-game simulations from the current live state.
 * Returns null when remaining time cannot be grounded.
 * NHL uses a dedicated remaining-game model (not full-game nhl-shift).
 */
export function runRemainingGameSim(
  input: RemainingGameSimInput,
): RemainingGameSimResult | null {
  if (input.sport === "nhl") return runNhlRemainingGameSim(input);
  return runBasketballFootballRemainingGameSim(input);
}

/** Attach NHL settlement horizon onto cover queries (builder helper). */
export function attachNhlSettlementToCoverQuery(
  q: LiveCoverQuery,
  market: string,
  pick: string,
): LiveCoverQuery | null {
  const resolved = resolveNhlLiveMarketSettlement({ market, pick });
  if (!resolved.ok) return null;
  return { ...q, nhlSettlement: resolved.horizon };
}

/**
 * Live Coach Phase 2A — NBA/WNBA remaining-game Monte Carlo.
 *
 * Separate from pregame /sports/simulate/game-outcome and runGameMonteCarlo.
 * Simulates ONLY from the current live state through the remainder of the game.
 * Never invents possession, fouls, lineups, injuries, or player stats.
 */

export type LiveBasketballSport = "nba" | "wnba";

export type LiveCoverQuery = {
  id: string;
  kind: "ml" | "spread" | "total";
  teamSide?: "home" | "away";
  line?: number | null;
  totalSide?: "over" | "under";
};

export type RemainingGameSimInput = {
  sport: LiveBasketballSport;
  homeScore: number;
  awayScore: number;
  /** 1–4 regulation; 5+ = OT. */
  period: number;
  /** Countdown "M:SS", or halftime markers ("HT", "Half"). */
  clock: string;
  periodLabel?: string | null;
  /** Pregame / season PPG when reliable data exists. */
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
const NBA_OT_MIN = 5;
const WNBA_OT_MIN = 5;
const NBA_LEAGUE_PPG = 112;
const WNBA_LEAGUE_PPG = 82;

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

export function periodLengthMinutes(sport: LiveBasketballSport): number {
  return sport === "wnba" ? WNBA_Q_MIN : NBA_Q_MIN;
}

export function regulationMinutes(sport: LiveBasketballSport): number {
  return periodLengthMinutes(sport) * 4;
}

export function otLengthMinutes(sport: LiveBasketballSport): number {
  return sport === "wnba" ? WNBA_OT_MIN : NBA_OT_MIN;
}

export function leagueBaselinePpg(sport: LiveBasketballSport): number {
  return sport === "wnba" ? WNBA_LEAGUE_PPG : NBA_LEAGUE_PPG;
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

export function isHalftimeClock(
  clock: string | null | undefined,
  periodLabel?: string | null,
): boolean {
  const c = String(clock ?? "").trim().toLowerCase();
  const pl = String(periodLabel ?? "").trim().toLowerCase();
  if (c === "ht" || c === "half" || c === "halftime") return true;
  if (/halftime|half\s*time/.test(pl)) return true;
  // "End of 2nd" / Halftime transition — completedPeriod 2.
  const end = parseEndOfPeriodLabel(periodLabel);
  return end?.kind === "halftime";
}

/**
 * ESPN period-transition labels ("End of 4th", "Halftime", …).
 * When present, a reset displayClock like "12:00" must NOT be read as time
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
    /\bend(?:\s+of)?\s+(?:the\s+)?(1st|2nd|3rd|4th|first|second|third|fourth)(?:\s+q(?:tr|uarter)?)?\b/,
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
  if (completedPeriod === 2) return { kind: "halftime", completedPeriod: 2 };
  return { kind: "end_of_quarter", completedPeriod };
}

/** True when regulation has ended and we are not yet in an explicit OT state. */
export function isEndOfRegulationTransition(
  period: number | null | undefined,
  periodLabel?: string | null,
): boolean {
  const end = parseEndOfPeriodLabel(periodLabel);
  if (!end || end.completedPeriod !== 4) return false;
  return !isExplicitOvertimeState(period, periodLabel);
}

/** Explicit OT / OT clock — not "End of 4th" awaiting OT. */
export function isExplicitOvertimeState(
  period: number | null | undefined,
  periodLabel?: string | null,
): boolean {
  if (period != null && Number.isFinite(period) && period >= 5) return true;
  const pl = String(periodLabel ?? "").toLowerCase();
  if (!pl) return false;
  if (/\bend\s+of\b/.test(pl)) return false;
  return /\bot\b|\bovertime\b/.test(pl);
}

/**
 * Usable clock for Live Coach eligibility:
 * - parseable M:SS countdown, or
 * - known halftime / end-of-period transition marker
 */
export function hasUsableLiveClock(
  clock: string | null | undefined,
  periodLabel?: string | null,
): boolean {
  if (parseEndOfPeriodLabel(periodLabel)) return true;
  if (isHalftimeClock(clock, periodLabel)) return true;
  return parseCountdownClockSeconds(clock) != null;
}

/**
 * Remaining regulation (+ OT period) minutes from current period + clock.
 * Returns null when period/clock cannot ground a remaining-time estimate.
 *
 * End-of-period labels force the completed period to 0:00 remaining so a
 * reset ESPN displayClock ("12:00") is never treated as time still left.
 */
export function remainingMinutesFromState(opts: {
  sport: LiveBasketballSport;
  period: number;
  clock: string;
  periodLabel?: string | null;
}): number | null {
  const qLen = periodLengthMinutes(opts.sport);
  const otLen = otLengthMinutes(opts.sport);
  const period = opts.period;

  if (!Number.isFinite(period) || period < 1) return null;

  // Period-transition / end-of-period: completed period → 0 remaining in it.
  const end = parseEndOfPeriodLabel(opts.periodLabel);
  if (end) {
    if (end.completedPeriod === 4) {
      // Regulation over. OT only when explicitly active (caller gate).
      if (isExplicitOvertimeState(period, opts.periodLabel)) {
        const clockSec = parseCountdownClockSeconds(opts.clock);
        if (clockSec == null) return null;
        return Math.max(0, Math.min(otLen, clockSec / 60));
      }
      return 0;
    }
    // End of 1st / 2nd(halftime) / 3rd → only later regulation quarters remain.
    return Math.max(0, (4 - end.completedPeriod) * qLen);
  }

  if (isHalftimeClock(opts.clock, opts.periodLabel)) {
    // Start of 2nd half = Q3 + Q4.
    return qLen * 2;
  }

  const clockSec = parseCountdownClockSeconds(opts.clock);
  if (clockSec == null) return null;
  const clockMin = clockSec / 60;

  if (period >= 5 || isExplicitOvertimeState(period, opts.periodLabel)) {
    // In OT: only current OT clock remains (do not invent further OTs).
    return Math.max(0, Math.min(otLen, clockMin));
  }

  const futurePeriods = Math.max(0, 4 - period);
  return Math.max(0, clockMin + futurePeriods * qLen);
}

export function elapsedMinutesFromState(opts: {
  sport: LiveBasketballSport;
  period: number;
  clock: string;
  periodLabel?: string | null;
}): number | null {
  const rem = remainingMinutesFromState(opts);
  if (rem == null) return null;
  if (opts.period >= 5 || isExplicitOvertimeState(opts.period, opts.periodLabel)) {
    // Elapsed = full regulation + (OT length - remaining in this OT).
    const otLen = otLengthMinutes(opts.sport);
    return regulationMinutes(opts.sport) + (otLen - rem);
  }
  const end = parseEndOfPeriodLabel(opts.periodLabel);
  if (end) {
    return end.completedPeriod * periodLengthMinutes(opts.sport);
  }
  if (isHalftimeClock(opts.clock, opts.periodLabel)) {
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
 * Expected remaining points for one team from baseline + observed pace blend.
 * Does not invent possessions/fouls — scales PPG by remaining fraction of a game.
 */
function expectedRemainingPoints(opts: {
  sport: LiveBasketballSport;
  currentScore: number;
  elapsedMin: number;
  remainingMin: number;
  baselinePpg: number | null | undefined;
  /** Small home-court boost applied to home mean only (known constant, not invented lineup). */
  homeCourtBoost?: number;
}): number {
  const full = regulationMinutes(opts.sport);
  const league = leagueBaselinePpg(opts.sport);
  const baseline = opts.baselinePpg != null && Number.isFinite(opts.baselinePpg)
    ? opts.baselinePpg
    : league;

  let pacePpg = baseline;
  // When enough clock has elapsed, blend in observed scoring rate.
  if (opts.elapsedMin >= 6 && opts.elapsedMin > 0) {
    const observedPpg = (opts.currentScore / opts.elapsedMin) * full;
    if (Number.isFinite(observedPpg) && observedPpg > 0) {
      // Weight observed more as the game progresses (cap 0.65).
      const w = Math.min(0.65, opts.elapsedMin / full);
      pacePpg = baseline * (1 - w) + observedPpg * w;
    }
  }

  const mean = (pacePpg / full) * opts.remainingMin;
  const boost = opts.homeCourtBoost ?? 0;
  return Math.max(0, mean * (1 + boost));
}

/**
 * Run 10k remaining-game simulations from the current live state.
 * Returns null when remaining time cannot be grounded.
 */
export function runRemainingGameSim(
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
  // No meaningful basketball left in regulation/OT clock.
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

  // Std scales with remaining time (more variance early / long remaining).
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

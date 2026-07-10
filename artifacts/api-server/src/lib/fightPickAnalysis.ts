// Structured pre-pick UFC analysis — every requested factor is either grounded in
// real ESPN data or explicitly marked unavailable. Never fabricates UFC record,
// fight logs, injuries, betting splits, or prop markets.

import type { FightComparison, Fighter, FighterRecentFight, FighterStyle } from "./ufc.js";
import type { FightSimResult } from "./ufcMonteCarlo.js";

export type AnalysisFactor<T = string | number | null> = {
  value: T;
  available: boolean;
};

export type FighterPickFactors = {
  style: AnalysisFactor<FighterStyle>;
  age: AnalysisFactor<number>;
  height: AnalysisFactor<string>;
  reach: AnalysisFactor<string>;
  stance: AnalysisFactor<string>;
  record: AnalysisFactor<string>;
  ufcRecord: AnalysisFactor<string>;
  finishRateKoTko: AnalysisFactor<number>;
  finishRateSubmission: AnalysisFactor<number>;
  finishRateDecision: AnalysisFactor<number>;
  sigStrikesPerMin: AnalysisFactor<number>;
  sigStrikeAccuracy: AnalysisFactor<number>;
  sigStrikeDefense: AnalysisFactor<number>;
  knockdownsPerFight: AnalysisFactor<number>;
  takedownsPer15: AnalysisFactor<number>;
  takedownAccuracy: AnalysisFactor<number>;
  takedownDefense: AnalysisFactor<number>;
  submissionAttemptsPer15: AnalysisFactor<number>;
  avgFightTime: AnalysisFactor<number>;
  controlTime: AnalysisFactor<number>;
  recentFormLast5: AnalysisFactor<string>;
  strengthOfSchedule: AnalysisFactor<string>;
  winLossStreak: AnalysisFactor<string>;
  daysSinceLastFight: AnalysisFactor<number>;
  weightMisses: AnalysisFactor<number>;
  injuryHistory: AnalysisFactor<string>;
  fiveRoundVsThreeRound: AnalysisFactor<string>;
  cardioRating: AnalysisFactor<string>;
  chinDurability: AnalysisFactor<string>;
};

export type FightAdvantages = {
  styleMatchup: AnalysisFactor<string>;
  reachAdvantage: AnalysisFactor<string>;
  ageAdvantage: AnalysisFactor<string>;
  reachAdvantageIn: number | null;
  ageGapYears: number | null;
};

export type BettingContext = {
  publicBettingPct: AnalysisFactor<number>;
  sharpMoneyPct: AnalysisFactor<number>;
  lineMovement: AnalysisFactor<string>;
  bestOddsEveryBook: AnalysisFactor<string>;
};

export type FightPickAnalysis = {
  away: FighterPickFactors;
  home: FighterPickFactors;
  advantages: FightAdvantages;
  betting: BettingContext;
  dataCoveragePct: number;
  resolvedFighters: number;
  unavailableFactors: string[];
  unavailableMarkets: string[];
};

export const UFC_UNAVAILABLE_MARKETS = [
  "Method of victory",
  "Fight goes the distance / doesn't go the distance",
  "Over/Under rounds",
  "Fighter total strikes",
  "Significant strikes props",
  "Takedowns props",
  "Submission attempts props",
  "Alternate lines",
  "Same-game parlays (no secondary UFC markets in feed)",
] as const;

const UNAVAILABLE_FACTOR_LABELS = [
  "UFC-specific record (ESPN carries overall MMA record only)",
  "Significant strike defense",
  "Knockdowns per fight",
  "Takedown defense",
  "Average fight time",
  "Control time",
  "Recent form (last 5 fights)",
  "Strength of schedule",
  "Win/loss streak",
  "Days since last fight",
  "Weight misses",
  "Injury history",
  "Five-round vs three-round splits",
  "Cardio rating",
  "Chin durability",
  "Public betting %",
  "Sharp money %",
  "Line movement history",
] as const;

function factor<T>(value: T | null | undefined, available = value != null): AnalysisFactor<T | null> {
  return { value: available ? (value as T) : null, available: available && value != null };
}

function subFinishPct(f: Fighter): number | null {
  const w = f.record?.wins ?? 0;
  const subs = f.methods.subWins ?? 0;
  if (w <= 0 || f.methods.subWins == null) return null;
  return Math.round((subs / w) * 1000) / 10;
}

function formLabel(form: FighterRecentFight[], n: number): string | null {
  const slice = form.slice(0, n);
  if (!slice.length) return null;
  return slice
    .map((r) => {
      const mark = r.result ?? "?";
      const opp = r.opponent ?? "unknown";
      return `${mark} vs ${opp}`;
    })
    .join(", ");
}

function unavailableFactorLabels(away: Fighter, home: Fighter): string[] {
  const hasRecentForm = away.recentForm.length > 0 || home.recentForm.length > 0;
  return UNAVAILABLE_FACTOR_LABELS.filter((s) => {
    if (s === "Recent form (last 5 fights)" && hasRecentForm) return false;
    return true;
  });
}

function decFinishPct(f: Fighter): number | null {
  if (f.stats.decisionPct != null) return f.stats.decisionPct;
  const w = f.record?.wins ?? 0;
  const d = f.methods.decisionWins;
  if (w <= 0 || d == null) return null;
  return Math.round((d / w) * 1000) / 10;
}

export function buildFighterPickFactors(f: Fighter): FighterPickFactors {
  const rec = f.record
    ? `${f.record.wins}-${f.record.losses}-${f.record.draws} (${f.record.winPct}% win)`
    : null;
  return {
    style: factor(f.style),
    age: factor(f.profile.age),
    height: factor(f.profile.displayHeight),
    reach: factor(f.profile.displayReach),
    stance: factor(f.profile.stance),
    record: factor(rec),
    ufcRecord: { value: null, available: false },
    finishRateKoTko: factor(f.stats.finishPct),
    finishRateSubmission: factor(subFinishPct(f)),
    finishRateDecision: factor(decFinishPct(f)),
    sigStrikesPerMin: factor(f.stats.strikeLPM),
    sigStrikeAccuracy: factor(f.stats.strikeAccuracy),
    sigStrikeDefense: { value: null, available: false },
    knockdownsPerFight: { value: null, available: false },
    takedownsPer15: factor(f.stats.takedownAvg),
    takedownAccuracy: factor(f.stats.takedownAccuracy),
    takedownDefense: { value: null, available: false },
    submissionAttemptsPer15: factor(f.stats.submissionAvg),
    avgFightTime: { value: null, available: false },
    controlTime: { value: null, available: false },
    recentFormLast5: factor(formLabel(f.recentForm, 5), f.recentForm.length > 0),
    strengthOfSchedule: { value: null, available: false },
    winLossStreak: { value: null, available: false },
    daysSinceLastFight: { value: null, available: false },
    weightMisses: { value: null, available: false },
    injuryHistory: { value: null, available: false },
    fiveRoundVsThreeRound: { value: null, available: false },
    cardioRating: { value: null, available: false },
    chinDurability: { value: null, available: false },
  };
}

function countAvailable(f: FighterPickFactors): number {
  return Object.values(f).filter((x) => x.available).length;
}

function totalFactors(): number {
  return Object.keys(buildFighterPickFactors({
    name: "",
    resolvedName: null,
    athleteId: null,
    weightClass: null,
    record: null,
    stats: {
      strikeAccuracy: null,
      strikeLPM: null,
      takedownAccuracy: null,
      takedownAvg: null,
      submissionAvg: null,
      finishPct: null,
      decisionPct: null,
    },
    profile: {
      age: null,
      heightIn: null,
      displayHeight: null,
      reachIn: null,
      displayReach: null,
      stance: null,
      citizenship: null,
    },
    methods: {
      koWins: null,
      tkoWins: null,
      subWins: null,
      decisionWins: null,
      koLosses: null,
      tkoLosses: null,
      subLosses: null,
    },
    style: null,
    dataSources: [],
    recentForm: [],
  })).length;
}

const FACTOR_TOTAL = totalFactors();

export function buildFightPickAnalysis(
  away: Fighter,
  home: Fighter,
  comparison: FightComparison,
  booksCount: number,
): FightPickAnalysis {
  const awayF = buildFighterPickFactors(away);
  const homeF = buildFighterPickFactors(home);
  const resolved =
    (away.record ? 1 : 0) + (home.record ? 1 : 0);

  const ageGap =
    away.profile.age != null && home.profile.age != null
      ? away.profile.age - home.profile.age
      : null;
  let ageAdv: string | null = null;
  if (ageGap != null && Math.abs(ageGap) >= 2) {
    ageAdv =
      ageGap < 0
        ? `${away.resolvedName || away.name} younger by ${Math.abs(ageGap)} yrs`
        : `${home.resolvedName || home.name} younger by ${Math.abs(ageGap)} yrs`;
  }

  const avail = countAvailable(awayF) + countAvailable(homeF) + (comparison.styleMatchup ? 1 : 0) + (comparison.reachAdvantageFighter ? 1 : 0) + (ageAdv ? 1 : 0);
  const maxAvail = FACTOR_TOTAL * 2 + 3;

  return {
    away: awayF,
    home: homeF,
    advantages: {
      styleMatchup: factor(comparison.styleMatchup),
      reachAdvantage: factor(
        comparison.reachAdvantageFighter && comparison.reachAdvantageIn != null
          ? `${comparison.reachAdvantageFighter} +${Math.abs(comparison.reachAdvantageIn)}"`
          : null,
      ),
      ageAdvantage: factor(ageAdv),
      reachAdvantageIn: comparison.reachAdvantageIn,
      ageGapYears: ageGap,
    },
    betting: {
      publicBettingPct: { value: null, available: false },
      sharpMoneyPct: { value: null, available: false },
      lineMovement: { value: null, available: false },
      bestOddsEveryBook: factor(
        booksCount > 0 ? `${booksCount} posted moneyline lines across books` : null,
        booksCount > 0,
      ),
    },
    dataCoveragePct: Math.round((avail / maxAvail) * 1000) / 10,
    resolvedFighters: resolved,
    unavailableFactors: unavailableFactorLabels(away, home),
    unavailableMarkets: [...UFC_UNAVAILABLE_MARKETS],
  };
}

export type FightSimMetrics = {
  winProbability: { away: number; home: number };
  finishProbability: { away: number; home: number };
  koProbability: { away: number; home: number };
  submissionProbability: { away: number; home: number };
  decisionProbability: { away: number; home: number };
  roundWinPct: {
    away: { r1: number; r2: number; r3: number };
    home: { r1: number; r2: number; r3: number };
  } | null;
};

export function simMetricsFromResult(sim: FightSimResult): FightSimMetrics {
  const mr = sim.methodRates;
  const awayFinish = mr
    ? mr.away.ko + mr.away.tko + mr.away.sub
    : 0;
  const homeFinish = mr
    ? mr.home.ko + mr.home.tko + mr.home.sub
    : 0;

  return {
    winProbability: { away: sim.awayWinProbability, home: sim.homeWinProbability },
    finishProbability: { away: awayFinish, home: homeFinish },
    koProbability: {
      away: (mr?.away.ko ?? 0) + (mr?.away.tko ?? 0),
      home: (mr?.home.ko ?? 0) + (mr?.home.tko ?? 0),
    },
    submissionProbability: {
      away: mr?.away.sub ?? 0,
      home: mr?.home.sub ?? 0,
    },
    decisionProbability: {
      away: mr?.away.decision ?? 0,
      home: mr?.home.decision ?? 0,
    },
    roundWinPct: sim.roundWinPct ?? null,
  };
}

/** Minimum grounded data before surfacing a UFC moneyline recommendation. */
export function passesDataCoverageGate(analysis: FightPickAnalysis): boolean {
  if (analysis.resolvedFighters === 0) return false;
  if (analysis.dataCoveragePct < 18) return false;
  return true;
}

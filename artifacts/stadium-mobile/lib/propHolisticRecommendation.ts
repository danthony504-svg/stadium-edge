// Holistic player-prop recommendation — every prop is scored across recent form,
// matchup history, pitcher/opponent tendencies, injuries, projected playing time,
// weather (when applicable), line movement, sportsbook value, and the 10k Monte
// Carlo simulation. Missing contextual data reduces confidence instead of being
// silently renormalized away.

import type { ParsedPick } from "../components/PickCard.tsx";
import type { PickSubScores } from "./pickScore.ts";
import {
  scoreInjury,
  scoreLineShopping,
  scoreLineValue,
  scoreMatchup,
  scoreSimulation,
  scoreTrend,
} from "./pickScore.ts";
import { COACH_SIM_MIN_CONFIDENCE, COACH_SIM_MIN_GRADE } from "./gameSimQualityGates.ts";
import { pickHasSimGrade } from "./simMarketSupport.ts";
import { impliedProb } from "./format.ts";
import { simEvPct } from "./gameSimQualityGates.ts";

export type PropHolisticFactorKey =
  | "recentForm"
  | "matchup"
  | "opponentTendency"
  | "injury"
  | "playingTime"
  | "weather"
  | "lineMovement"
  | "sportsbookValue"
  | "simulation";

export type PropHolisticFactor = {
  key: PropHolisticFactorKey;
  label: string;
  score: number | null;
  display?: string;
  applicable: boolean;
  present: boolean;
};

export type PropHolisticScore = {
  composite: number | null;
  grade: string | null;
  confidencePct: number | null;
  coveragePct: number;
  missingCount: number;
  applicableCount: number;
  factors: PropHolisticFactor[];
  recommends: boolean;
};

/** Base weights — renormalized over present factors for composite; missing ones penalize confidence. */
export const PROP_HOLISTIC_WEIGHTS: Record<PropHolisticFactorKey, number> = {
  simulation: 0.2,
  recentForm: 0.14,
  matchup: 0.12,
  opponentTendency: 0.12,
  injury: 0.08,
  playingTime: 0.1,
  weather: 0.05,
  lineMovement: 0.05,
  sportsbookValue: 0.14,
};

export const PROP_HOLISTIC_MIN_GRADE = "B+";
/** Advisory coverage target — missing factors penalize confidence instead of hard-blocking. */
export const PROP_HOLISTIC_MIN_COVERAGE = 0.35;
export const PROP_HOLISTIC_TICKET_FILL_MIN_GRADE = "B-";
export const CONFIDENCE_PENALTY_PER_MISSING = 5;

const GRADE_RANK: Record<string, number> = {
  F: 0, D: 1, "C-": 2, C: 3, "C+": 4, "B-": 5, B: 6, "B+": 7, "A-": 8, A: 9, "A+": 10,
};

const round1 = (n: number) => Math.round(n * 10) / 10;
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

function gradeRank(g: string | null | undefined): number {
  if (!g) return -1;
  return GRADE_RANK[g] ?? -1;
}

export function gradeFromComposite(composite: number | null): string | null {
  if (composite == null) return null;
  if (composite >= 9.0) return "A+";
  if (composite >= 8.5) return "A";
  if (composite >= 8.0) return "A-";
  if (composite >= 7.5) return "B+";
  if (composite >= 7.0) return "B";
  if (composite >= 6.5) return "B-";
  if (composite >= 6.0) return "C+";
  if (composite >= 5.5) return "C";
  if (composite >= 5.0) return "C-";
  if (composite >= 4.0) return "D";
  return "F";
}

export type PitcherTendencySlice = {
  hrPer9?: number | null;
  kPer9?: number | null;
  flyBallPct?: number | null;
  groundFlyRatio?: number | null;
  oppOPS?: number | null;
  barrelPctAllowed?: number | null;
  hardHitPctAllowed?: number | null;
  battedBallEvents?: number | null;
};

export type MlbPlatoonSlice = {
  platoon?: string | null;
  opposingPitcherTendency?: PitcherTendencySlice | null;
  vsThatHand?: { slg?: number | null; hr?: number | null; ops?: number | null } | null;
};

export type MlbGameEnvSlice = {
  park?: { hrIndex?: number | null; dome?: boolean } | null;
  weather?: { tempF?: number | null; windMph?: number | null; condition?: string | null } | null;
  climateControlled?: boolean;
  homePitcher?: { name?: string | null; throws?: string | null; tendency?: PitcherTendencySlice | null } | null;
  awayPitcher?: { name?: string | null; throws?: string | null; tendency?: PitcherTendencySlice | null } | null;
};

export type PropHolisticContext = {
  sport?: string;
  marketKey?: string;
  propSide?: string | null;
  rubricScores?: PickSubScores;
  edgePct?: number | null;
  simHit?: number | null;
  minutesTrend?: {
    l5?: number | null;
    l10?: number | null;
    season?: number | null;
    direction?: string | null;
  } | null;
  vsOpponentGames?: number;
  mlbPlatoon?: MlbPlatoonSlice | null;
  mlbGameEnv?: MlbGameEnvSlice | null;
  playerTeamIsHome?: boolean | null;
  lineMovementPct?: number | null;
};

function weatherApplicable(sport: string): boolean {
  const s = sport.toLowerCase();
  return s === "mlb" || s === "nfl" || s === "ncaaf";
}

function playingTimeApplicable(sport: string): boolean {
  const s = sport.toLowerCase();
  return s === "nba" || s === "wnba" || s === "ncaab" || s === "nhl" || s === "soccer";
}

function isOverSide(side: string | null | undefined): boolean {
  return String(side ?? "").toLowerCase() === "over";
}

function isUnderSide(side: string | null | undefined): boolean {
  return String(side ?? "").toLowerCase() === "under";
}

function lin01(x: number, lo: number, hi: number): number {
  return clamp((x - lo) / (hi - lo), 0, 1);
}

function favorFrom01(v: number, over: boolean): number {
  const centered = (v - 0.5) * 2;
  return over ? centered : -centered;
}

function scoreSportsbookValue(
  lineValue: number | null | undefined,
  lineShopping: number | null | undefined,
): number | null {
  const parts = [lineValue, lineShopping].filter(
    (s): s is number => s != null && Number.isFinite(s),
  );
  if (!parts.length) return null;
  return round1(parts.reduce((a, b) => a + b, 0) / parts.length);
}

function scorePlayingTime(
  trend: PropHolisticContext["minutesTrend"],
  side: string | null | undefined,
): { score: number | null; display?: string } {
  if (!trend) return { score: null };
  const dir = String(trend.direction ?? "").toLowerCase();
  const l5 = trend.l5;
  const season = trend.season;
  let momentum: number | null = null;
  if (l5 != null && season != null && season > 5) {
    momentum = clamp((l5 - season) / season, -0.35, 0.35) * 2;
  } else if (dir === "up") {
    momentum = 0.35;
  } else if (dir === "down") {
    momentum = -0.35;
  } else if (dir === "steady") {
    momentum = 0;
  }
  if (momentum == null) return { score: null };
  const over = isOverSide(side);
  const under = isUnderSide(side);
  if (!over && !under) return { score: null };
  const favor = over ? momentum : -momentum;
  const display =
    l5 != null && season != null
      ? `${l5.toFixed(0)} mpg L5 vs ${season.toFixed(0)} season`
      : dir
        ? `Minutes ${dir}`
        : undefined;
  return { score: scoreTrend(favor), display };
}

function scoreWeather(
  env: MlbGameEnvSlice | null | undefined,
  marketKey: string,
  side: string | null | undefined,
): { score: number | null; display?: string } {
  if (!env) return { score: null };
  const dome = env.climateControlled === true || env.park?.dome === true;
  if (dome) {
    return { score: 5.5, display: "Dome — weather neutral" };
  }
  const w = env.weather;
  const hrIndex = env.park?.hrIndex;
  const isHr = /home ?run|\bhr\b|to hit a hr/.test(marketKey.toLowerCase());
  const over = isOverSide(side);
  const under = isUnderSide(side);
  if (!over && !under && !isHr) return { score: null };

  let favor = 0;
  const bits: string[] = [];
  if (hrIndex != null) {
    favor += favorFrom01(lin01(hrIndex, 90, 115), over || isHr);
    bits.push(`HR index ${hrIndex}`);
  }
  if (w?.tempF != null) {
    favor += favorFrom01(lin01(w.tempF, 55, 85), over || isHr) * 0.4;
    bits.push(`${w.tempF}°F`);
  }
  if (w?.windMph != null && w.windMph >= 8) {
    favor += favorFrom01(lin01(w.windMph, 8, 18), over || isHr) * 0.35;
    bits.push(`wind ${w.windMph} mph`);
  }
  if (!bits.length) return { score: null };
  if (under && !isHr) favor = -favor;
  return { score: scoreTrend(clamp(favor, -1, 1)), display: bits.join(", ") };
}

function scoreLineMovement(movementPct: number | null | undefined): number | null {
  if (movementPct == null || !Number.isFinite(movementPct)) return null;
  return scoreLineValue(movementPct);
}

function scoreOpponentTendency(
  ctx: PropHolisticContext,
): { score: number | null; display?: string } {
  const sport = (ctx.sport ?? "").toLowerCase();
  const key = (ctx.marketKey ?? "").toLowerCase();
  const side = ctx.propSide;
  const over = isOverSide(side);
  const under = isUnderSide(side);

  if (sport === "mlb") {
    const tend = ctx.mlbPlatoon?.opposingPitcherTendency ?? null;
    const platoon = ctx.mlbPlatoon?.platoon;
    if (!tend && !platoon) return { score: null };

    const isPitcher = /pitcher|strikeout|\bouts\b|earned run|hits allowed|walks allowed/.test(key);
    const isHr = /home ?run|\bhr\b|to hit a hr/.test(key);
    const isContact = /\bhit|total bas|\btb\b|\brbi|single|double|triple/.test(key);
    const isK = /strikeout|\bk\b/.test(key);

    let favor = 0;
    const bits: string[] = [];

    if (platoon === "advantage") {
      favor += 0.25;
      bits.push("platoon edge");
    } else if (platoon === "disadvantage") {
      favor -= 0.25;
      bits.push("tough platoon");
    }

    if (tend) {
      const bbe = tend.battedBallEvents;
      const scOk = bbe != null && bbe >= 40;
      if (isHr || isContact) {
        if (tend.hrPer9 != null) favor += favorFrom01(lin01(tend.hrPer9, 0.7, 1.6), over) * 0.35;
        if (tend.oppOPS != null) favor += favorFrom01(lin01(tend.oppOPS, 0.65, 0.8), over) * 0.25;
        if (scOk && tend.barrelPctAllowed != null) {
          favor += favorFrom01(lin01(tend.barrelPctAllowed, 5, 11), over) * 0.2;
        }
        if (tend.kPer9 != null && tend.kPer9 >= 9) favor -= over ? 0.2 : -0.2;
      }
      if (isK && isPitcher && tend.kPer9 != null) {
        favor += favorFrom01(lin01(tend.kPer9, 7, 10.5), over) * 0.5;
        bits.push(`${tend.kPer9.toFixed(1)} K/9`);
      }
      if (tend.hrPer9 != null) bits.push(`${tend.hrPer9.toFixed(2)} HR/9`);
    }

    if (!bits.length && favor === 0) return { score: null };
    if (under) favor = -favor;
    return { score: scoreTrend(clamp(favor, -1, 1)), display: bits.join(", ") || undefined };
  }

  if (ctx.vsOpponentGames != null && ctx.vsOpponentGames > 0) {
    return {
      score: 5.8,
      display: `${ctx.vsOpponentGames} recent vs opponent`,
    };
  }

  return { score: null };
}

function scoreMatchupHistory(
  rubricMatchup: number | null | undefined,
  vsOppGames: number | undefined,
): { score: number | null; display?: string } {
  if (rubricMatchup != null) {
    return {
      score: rubricMatchup,
      display: vsOppGames ? `Team lean + ${vsOppGames} H2H games` : undefined,
    };
  }
  return { score: null };
}

export function combinePropHolisticFactors(factors: PropHolisticFactor[]): number | null {
  let wSum = 0;
  let acc = 0;
  for (const f of factors) {
    if (!f.applicable || !f.present || f.score == null) continue;
    const w = PROP_HOLISTIC_WEIGHTS[f.key];
    wSum += w;
    acc += w * f.score;
  }
  if (wSum <= 0) return null;
  return round1(acc / wSum);
}

function confidenceFromHolisticFactors(factors: PropHolisticFactor[]): number | null {
  const applicable = factors.filter((f) => f.applicable);
  if (!applicable.length) return null;

  let present = 0;
  let pts = 50;
  const neutral = 5.5;
  for (const f of applicable) {
    if (!f.present || f.score == null) continue;
    present += 1;
    pts += ((f.score - neutral) / (10 - neutral)) * 10;
  }
  if (present === 0) return null;

  const missing = applicable.filter((f) => !f.present).length;
  const simFactor = factors.find((f) => f.key === "simulation" && f.present && f.score != null);
  const missingPenalty =
    simFactor && (simFactor.score ?? 0) >= 5.5
      ? Math.min(missing * CONFIDENCE_PENALTY_PER_MISSING, 18)
      : missing * CONFIDENCE_PENALTY_PER_MISSING;
  pts -= missingPenalty;
  return clamp(Math.round(pts), 5, 95);
}

export function buildPropHolisticScore(ctx: PropHolisticContext): PropHolisticScore {
  const sport = (ctx.sport ?? "").toLowerCase();
  const rubric = ctx.rubricScores;
  const marketKey = (ctx.marketKey ?? "").toLowerCase();

  const sportsbook =
    scoreSportsbookValue(rubric?.lineValue, rubric?.lineShopping) ??
    (ctx.edgePct != null ? scoreLineValue(ctx.edgePct) : null);
  const playing = scorePlayingTime(ctx.minutesTrend, ctx.propSide);
  const weather = weatherApplicable(sport)
    ? scoreWeather(ctx.mlbGameEnv, marketKey, ctx.propSide)
    : { score: null as number | null };
  const opponent = scoreOpponentTendency(ctx);
  const matchup = scoreMatchupHistory(rubric?.matchup, ctx.vsOpponentGames);
  const movement =
    scoreLineMovement(ctx.lineMovementPct) ?? rubric?.lineShopping ?? null;
  const recentFormScore = rubric?.trend ?? playing.score;

  const factors: PropHolisticFactor[] = [
    {
      key: "recentForm",
      label: "Recent Form",
      score: recentFormScore,
      display: playing.display,
      applicable: true,
      present: recentFormScore != null,
    },
    {
      key: "matchup",
      label: "Matchup History",
      score: matchup.score,
      display: matchup.display,
      applicable: true,
      present: matchup.score != null,
    },
    {
      key: "opponentTendency",
      label: "Opponent Tendency",
      score: opponent.score,
      display: opponent.display,
      applicable: true,
      present: opponent.score != null,
    },
    {
      key: "injury",
      label: "Injuries",
      score: rubric?.injury ?? null,
      applicable: true,
      present: rubric?.injury != null,
    },
    {
      key: "playingTime",
      label: "Playing Time",
      score: playing.score,
      display: playing.display,
      applicable: playingTimeApplicable(sport),
      present: playing.score != null,
    },
    {
      key: "weather",
      label: "Weather",
      score: weather.score,
      display: weather.display,
      applicable: weatherApplicable(sport),
      present: weather.score != null,
    },
    {
      key: "lineMovement",
      label: "Market Efficiency",
      score: movement,
      applicable: true,
      present: movement != null,
    },
    {
      key: "sportsbookValue",
      label: "Expected Value",
      score: sportsbook,
      applicable: true,
      present: sportsbook != null,
    },
    {
      key: "simulation",
      label: "10k Simulation",
      score: scoreSimulation(ctx.simHit),
      display: ctx.simHit != null ? `${Math.round(ctx.simHit * 100)}% hit` : undefined,
      applicable: true,
      present: ctx.simHit != null,
    },
  ];

  const applicable = factors.filter((f) => f.applicable);
  const presentCount = applicable.filter((f) => f.present).length;
  const applicableCount = applicable.length;
  const missingCount = applicableCount - presentCount;
  const coveragePct =
    applicableCount > 0 ? Math.round((presentCount / applicableCount) * 100) : 0;

  const composite = combinePropHolisticFactors(factors);
  const grade = gradeFromComposite(composite);
  const confidencePct = confidenceFromHolisticFactors(factors);

  return {
    composite,
    grade,
    confidencePct,
    coveragePct,
    missingCount,
    applicableCount,
    factors,
    recommends: false,
  };
}

export function propHolisticRecommends(
  pick: ParsedPick,
  holistic: PropHolisticScore,
  opts: {
    edgePct?: number | null;
    simHit?: number | null;
    odds?: number | null;
  },
): boolean {
  if (!pick.isProp) return false;
  if (!pickHasSimGrade(pick, opts.simHit)) return false;
  if ((opts.edgePct ?? 0) <= 0) return false;
  if (gradeRank(holistic.grade) < gradeRank(PROP_HOLISTIC_MIN_GRADE)) return false;
  if ((holistic.confidencePct ?? 0) < COACH_SIM_MIN_CONFIDENCE) return false;
  if (holistic.composite == null) return false;

  if (opts.simHit != null && opts.odds != null) {
    const ev = simEvPct(opts.simHit, opts.odds);
    if (ev != null && ev <= 0) return false;
  }

  const simFactor = holistic.factors.find((f) => f.key === "simulation");
  const valueFactor = holistic.factors.find((f) => f.key === "sportsbookValue");
  const contextFactors = holistic.factors.filter(
    (f) =>
      f.applicable &&
      f.present &&
      f.key !== "simulation" &&
      f.key !== "sportsbookValue",
  );

  const strongContextCount = contextFactors.filter((f) => (f.score ?? 0) >= 6).length;
  const strongContext =
    strongContextCount >= 2 ||
    (strongContextCount >= 1 && (holistic.composite ?? 0) >= 7.5);
  const simSupports = (simFactor?.score ?? 0) >= 5.8;
  const valueSupports = (valueFactor?.score ?? 0) >= 5.5;

  return strongContext && simSupports && valueSupports;
}

/** Softer bar for filling fixed-leg tickets when strict AI Recommended pool is short. */
export function propQualifiesForTicketFill(
  pick: ParsedPick,
  holistic: PropHolisticScore,
  opts: {
    edgePct?: number | null;
    simHit?: number | null;
    odds?: number | null;
  },
): boolean {
  if (!pick.isProp) return false;
  if (!pickHasSimGrade(pick, opts.simHit)) return false;
  if ((opts.edgePct ?? 0) <= 0) return false;
  if ((holistic.confidencePct ?? 0) < COACH_SIM_MIN_CONFIDENCE) return false;
  if (gradeRank(holistic.grade) < gradeRank(PROP_HOLISTIC_TICKET_FILL_MIN_GRADE)) return false;
  if (holistic.composite == null) return false;

  if (opts.simHit != null && opts.odds != null) {
    const ev = simEvPct(opts.simHit, opts.odds);
    if (ev != null && ev <= 0) return false;
  }

  const simFactor = holistic.factors.find((f) => f.key === "simulation");
  const valueFactor = holistic.factors.find((f) => f.key === "sportsbookValue");
  const thinContext = holistic.missingCount >= 4;
  const simMin = thinContext ? 5.0 : 5.5;
  const valueMin = thinContext ? 5.0 : 5.2;
  return (simFactor?.score ?? 0) >= simMin && (valueFactor?.score ?? 0) >= valueMin;
}

function mergePropHolisticScores(a: PropHolisticScore, b: PropHolisticScore): PropHolisticScore {
  const keys = new Set<PropHolisticFactorKey>([
    ...a.factors.map((f) => f.key),
    ...b.factors.map((f) => f.key),
  ]);
  const mergedFactors: PropHolisticFactor[] = [...keys].map((key) => {
    const fa = a.factors.find((f) => f.key === key);
    const fb = b.factors.find((f) => f.key === key);
    if (!fa) return fb!;
    if (!fb) return fa;
    if (fb.present && (!fa.present || (fb.score ?? 0) > (fa.score ?? 0))) {
      return { ...fb, applicable: fa.applicable || fb.applicable };
    }
    return fa;
  });
  const composite = combinePropHolisticFactors(mergedFactors);
  const grade = gradeFromComposite(composite);
  const confidencePct = confidenceFromHolisticFactors(mergedFactors);
  const applicable = mergedFactors.filter((f) => f.applicable);
  const presentCount = applicable.filter((f) => f.present).length;
  const applicableCount = applicable.length;
  return {
    composite,
    grade,
    confidencePct,
    coveragePct: applicableCount > 0 ? Math.round((presentCount / applicableCount) * 100) : 0,
    missingCount: applicableCount - presentCount,
    applicableCount,
    factors: mergedFactors,
    recommends: a.recommends || b.recommends,
  };
}

/** Build holistic breakdown for prop cards when only rubric/sim data is attached. */
export function resolvePropHolisticForDisplay(pick: ParsedPick): PropHolisticScore | null {
  if (!pick.isProp && !pick.player) return null;
  const existing = pick.finalAiScore?.propHolistic;
  const rubric =
    pick.finalAiScore?.rubric?.scores ??
    pick.scores?.scores ??
    undefined;
  const edgeFromText = (() => {
    const raw = pick.edge ?? "";
    const m = String(raw).match(/([+-]?\d+(?:\.\d+)?)\s*%/);
    return m ? Number(m[1]) : null;
  })();
  const edgePct =
    pick.finalAiScore?.edgePct ??
    pick.scores?.edgePct ??
    (edgeFromText != null && Number.isFinite(edgeFromText) ? edgeFromText : null);
  const simHit = pick.finalAiScore?.simHit ?? null;
  if (!rubric && simHit == null && edgePct == null) return existing ?? null;
  const synthesized = buildPropHolisticScore({
    sport: pick.sport,
    marketKey: pick.propMarketKey ?? pick.market,
    propSide: pick.propSide,
    rubricScores: rubric ?? {
      matchup: null,
      trend: null,
      lineValue: null,
      injury: null,
      lineShopping: null,
      simulation: null,
    },
    edgePct,
    simHit,
  });
  if (!existing) return synthesized;
  return mergePropHolisticScores(existing, synthesized);
}

/** Guaranteed holistic strip for prop cards — never fall back to the legacy 6-factor row. */
export function minimalPropHolisticForPick(pick: ParsedPick): PropHolisticScore | null {
  const resolved = resolvePropHolisticForDisplay(pick);
  if (resolved) return resolved;
  const rubric = pick.finalAiScore?.rubric?.scores ?? pick.scores?.scores;
  const edgePct = pick.finalAiScore?.edgePct ?? pick.scores?.edgePct ?? null;
  const simHit = pick.finalAiScore?.simHit ?? null;
  if (!rubric && simHit == null && edgePct == null) return null;
  return buildPropHolisticScore({
    sport: pick.sport,
    marketKey: pick.propMarketKey ?? pick.market,
    propSide: pick.propSide,
    rubricScores: rubric ?? {
      matchup: null,
      trend: null,
      lineValue: null,
      injury: null,
      lineShopping: null,
      simulation: null,
    },
    edgePct,
    simHit,
  });
}

/** Coach card factor strip — EV / sim / matchup / form / injury / market eff (never legacy Line). */
export function buildCoachCardHolistic(pick: ParsedPick): PropHolisticScore | null {
  const base = minimalPropHolisticForPick(pick);
  if (!base) return null;

  const factor = (key: PropHolisticFactorKey) => base.factors.find((f) => f.key === key);
  const matchup = factor("matchup");
  const opponent = factor("opponentTendency");
  const matchParts = [matchup?.score, opponent?.score].filter((s): s is number => s != null);
  const matchScore = matchParts.length
    ? round1(matchParts.reduce((a, b) => a + b, 0) / matchParts.length)
    : null;
  const matchDisplay = [matchup?.display, opponent?.display].filter(Boolean).join(" · ") || undefined;

  const form = factor("recentForm");
  const minutes = factor("playingTime");
  const formScore = form?.score ?? minutes?.score ?? null;
  const formPresent = form?.present || minutes?.present;
  const formDisplay = form?.display ?? minutes?.display;

  const coachFactors: PropHolisticFactor[] = [
    factor("sportsbookValue") ?? {
      key: "sportsbookValue",
      label: "Expected Value",
      score: null,
      applicable: true,
      present: false,
    },
    factor("simulation") ?? {
      key: "simulation",
      label: "10k Simulation",
      score: null,
      applicable: true,
      present: false,
    },
    {
      key: "matchup",
      label: "Matchup",
      score: matchScore,
      display: matchDisplay,
      applicable: true,
      present: matchScore != null,
    },
    {
      key: "recentForm",
      label: "Recent Form",
      score: formScore,
      display: formDisplay,
      applicable: true,
      present: formPresent && formScore != null,
    },
    factor("injury") ?? {
      key: "injury",
      label: "Injuries",
      score: null,
      applicable: true,
      present: false,
    },
    factor("lineMovement") ?? {
      key: "lineMovement",
      label: "Market Efficiency",
      score: null,
      applicable: true,
      present: false,
    },
  ];

  return { ...base, factors: coachFactors };
}

export function propHolisticTopDrivers(holistic: PropHolisticScore, max = 3): string {
  const ranked = holistic.factors
    .filter((f) => f.applicable && f.present && f.score != null)
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .slice(0, max);
  if (!ranked.length) return "Waiting on matchup, form, injury, and simulation context…";
  return ranked
    .map((f) => {
      const val = f.score != null ? f.score.toFixed(1) : "—";
      const detail = f.display ? ` (${f.display})` : "";
      return `${f.label} ${val}${detail}`;
    })
    .join(" · ");
}

/** @deprecated Use coachCompositeRankScore from coachCompositeRank.ts for board ranking. */
export function propHolisticRankScore(holistic: PropHolisticScore, edgePct?: number | null): number {
  const composite = holistic.composite ?? 0;
  const conf = holistic.confidencePct ?? 0;
  const edge = edgePct ?? 0;
  const coverage = holistic.coveragePct;
  const grade = gradeRank(holistic.grade) * 3;
  return composite * 2.2 + conf * 0.5 + edge * 2.5 + coverage * 0.08 + grade;
}

export function resolveMlbPitcherTendency(
  gameEnv: MlbGameEnvSlice | null | undefined,
  platoon: MlbPlatoonSlice | null | undefined,
  playerTeamIsHome: boolean | null,
): PitcherTendencySlice | null {
  if (platoon?.opposingPitcherTendency) return platoon.opposingPitcherTendency;
  if (!gameEnv || playerTeamIsHome == null) return null;
  const opp = playerTeamIsHome ? gameEnv.awayPitcher : gameEnv.homePitcher;
  return opp?.tendency ?? null;
}

// Player Score + Matchup Score — both must clear the bar before a prop is
// recommended. Never endorse on a hot player in a bad spot, or a great matchup
// with a cold player.

import type { InjuryTeam, MatchupHistoryEntry, PropSimulationResult } from "./api.ts";
import type { CombinedPickScore } from "./pickScore.ts";
import { americanToImplied, gradeFromComposite, matchupAlignment } from "./pickScore.ts";
import type { RealPropSignals } from "./propFactors.ts";
import { computeAmbiguous, gameValueForMarket } from "./propStats.ts";
import type { GameInjuryReport } from "./injuries.ts";
import { summarizeTeamInjuries, teamNameMatches } from "./injuries.ts";
import {
  buildSportMatchupFactors,
  weightedMatchupScore,
  type MatchupScoreFactor,
} from "./sportMatchupScore.ts";

export type { MatchupScoreFactor } from "./sportMatchupScore.ts";

export const MIN_PLAYER_SCORE = 55;
export const MIN_MATCHUP_SCORE = 55;
export const MIN_FINAL_AI_SCORE = 58;
export const MIN_CONFIDENCE_PCT = 55;
export const MIN_SIM_HIT = 0.52;
export const MIN_GRADE = "B+";
export const HOT_PLAYER_THRESHOLD = 62;
export const HOT_MATCHUP_THRESHOLD = 62;
export const COLD_PLAYER_THRESHOLD = 48;
export const COLD_MATCHUP_THRESHOLD = 48;
/** Both sides must reach this before they "agree" — not just one hot, one barely passing. */
export const AGREEMENT_MIN_SCORE = 58;
/** Player and matchup scores can't diverge more than this and still recommend. */
export const MAX_AGREEMENT_GAP = 14;

const GRADE_RANK: Record<string, number> = {
  F: 0,
  D: 1,
  "C-": 2,
  C: 3,
  "C+": 4,
  "B-": 5,
  B: 6,
  "B+": 7,
  "A-": 8,
  A: 9,
  "A+": 10,
};

function gradeRank(grade: string | null | undefined): number {
  if (!grade) return -1;
  return GRADE_RANK[grade] ?? -1;
}

export type PlayerScoreFactor = {
  key: string;
  label: string;
  weight: number;
  sub: number | null;
  display: string | null;
};

export type FinalAiScoreFactor = {
  key: string;
  label: string;
  weight: number;
  sub: number | null;
  display: string | null;
};

export type PropDualScore = {
  playerScore: number | null;
  matchupScore: number | null;
  finalAiScore: number | null;
  playerFactors: PlayerScoreFactor[];
  matchupFactors: MatchupScoreFactor[];
  finalAiFactors: FinalAiScoreFactor[];
  passesPlayer: boolean;
  passesMatchup: boolean;
  passesFinalAi: boolean;
  /** Player and matchup both solid and aligned — required before any recommend. */
  playerMatchupAgree: boolean;
  recommends: boolean;
  headline: string;
  explanation: string;
};

// Back-compat alias
export type PickTripleScore = PropDualScore;

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
const lin = (x: number, lo: number, hi: number) => clamp01((x - lo) / (hi - lo));

function isValidPropSim(simRow: PropSimulationResult | null | undefined): boolean {
  if (!simRow?.hitProbability || !Number.isFinite(simRow.hitProbability)) return false;
  const completed = simRow.completedSims ?? simRow.simulations ?? 0;
  if (completed <= 0 || (simRow.failedSims ?? 0) > 0) return false;
  const proj = simRow.meanProjection ?? simRow.medianProjection ?? simRow.mostLikelyLine;
  return proj != null && Number.isFinite(proj);
}

function isDeepMonteCarlo(simRow: PropSimulationResult): boolean {
  const n = simRow.completedSims ?? simRow.simulations ?? 0;
  return n >= 10_000;
}

function resolveDisplayEdge(
  combined: CombinedPickScore | null | undefined,
  simRow: PropSimulationResult | null | undefined,
  odds?: number | null,
): number | null {
  if (combined?.edgePct != null && Number.isFinite(combined.edgePct)) return combined.edgePct;
  const hit = simRow?.hitProbability;
  if (hit == null || !Number.isFinite(hit)) return null;
  const implied = americanToImplied(odds ?? undefined);
  if (implied != null) return Math.round((hit - implied) * 1000) / 10;
  return Math.round((hit - 0.5) * 1000) / 10;
}

function weightedScore(
  factors: Array<{ weight: number; sub: number | null }>,
): number | null {
  let wSum = 0;
  let acc = 0;
  for (const f of factors) {
    if (f.sub == null) continue;
    wSum += f.weight;
    acc += f.weight * f.sub;
  }
  if (wSum <= 0) return null;
  return Math.round((acc / wSum) * 100);
}

function subFromPickScore(score: number | null | undefined): number | null {
  if (score == null || !Number.isFinite(score)) return null;
  return lin(score, 1, 10);
}

export type PlayerScoreInput = {
  combined: CombinedPickScore | null;
  simRow: PropSimulationResult | null;
  odds?: number | null;
  projection: number | null;
  line: number | null;
  side: string;
  hitPct: number | null;
  /** Player's own injury hurts availability (out/doubtful). */
  playerInjured?: boolean;
};

export function computePlayerScore(input: PlayerScoreInput): {
  score: number | null;
  factors: PlayerScoreFactor[];
} {
  const { combined, simRow, projection, line, side, hitPct, playerInjured } = input;
  const isUnder = String(side).toLowerCase() === "under";

  let formSub: number | null = null;
  let formDisplay: string | null = null;
  if (hitPct != null) {
    formSub = lin(hitPct, 35, 70);
    if (isUnder) formSub = lin(100 - hitPct, 35, 70);
    formDisplay = `${hitPct}% recent hit`;
  } else if (combined?.scores.trend != null) {
    formSub = subFromPickScore(combined.scores.trend);
    formDisplay = `trend ${combined.scores.trend.toFixed(1)}`;
  }

  let simSub: number | null = null;
  let simDisplay: string | null = null;
  if (simRow?.hitProbability != null && isValidPropSim(simRow)) {
    const hit = simRow.hitProbability;
    simSub = lin(hit, 0.45, 0.65);
    if (isUnder) simSub = lin(1 - hit, 0.45, 0.65);
    const deep = isDeepMonteCarlo(simRow) ? "10k" : "partial";
    simDisplay = `${Math.round(hit * 100)}% sim (${deep})`;
  } else if (combined?.scores.simulation != null) {
    simSub = subFromPickScore(combined.scores.simulation);
    simDisplay = `sim signal ${combined.scores.simulation.toFixed(1)}`;
  }

  let confSub: number | null = null;
  let confDisplay: string | null = null;
  if (combined?.confidencePct != null) {
    confSub = lin(combined.confidencePct, 45, 75);
    confDisplay = `${combined.confidencePct}% confidence`;
  }

  let projSub: number | null = null;
  let projDisplay: string | null = null;
  if (projection != null && line != null && Number.isFinite(projection) && Number.isFinite(line)) {
    const margin = isUnder ? line - projection : projection - line;
    projSub = lin(margin, -2, 3);
    projDisplay = `proj ${projection} vs ${line}`;
  }

  let injurySub: number | null = null;
  let injuryDisplay: string | null = null;
  if (combined?.scores.injury != null) {
    injurySub = subFromPickScore(combined.scores.injury);
    injuryDisplay = `injury edge ${combined.scores.injury.toFixed(1)}`;
  }

  if (playerInjured) {
    injurySub = 0.15;
    injuryDisplay = "player injury concern";
  }

  const factors: PlayerScoreFactor[] = [
    { key: "form", label: "Recent form", weight: 26, sub: formSub, display: formDisplay },
    { key: "sim", label: "Simulation", weight: 24, sub: simSub, display: simDisplay },
    { key: "confidence", label: "Confidence", weight: 16, sub: confSub, display: confDisplay },
    { key: "projection", label: "Projection", weight: 20, sub: projSub, display: projDisplay },
  ];
  if (injurySub != null) {
    factors.push({
      key: "injury",
      label: "Injury context",
      weight: 8,
      sub: injurySub,
      display: injuryDisplay,
    });
  }

  return { score: weightedScore(factors), factors };
}

export type MatchupScoreInput = {
  sport: string;
  marketKey: string;
  mlb?: RealPropSignals["mlb"] | null;
  oppDefense?: RealPropSignals["oppDefense"] | null;
  matchup?: MatchupHistoryEntry | null;
  homeAway?: RealPropSignals["homeAway"] | null;
  playerSide?: "home" | "away" | null;
  usageMinutes?: number | null;
  mlLeanAligned?: 1 | 0 | -1 | null;
  mlLeanEdge?: number | null;
  opponentKeyInjuries?: number | null;
  side?: string;
};

export function computeMatchupScore(input: MatchupScoreInput): {
  score: number | null;
  factors: MatchupScoreFactor[];
} {
  const factors = buildSportMatchupFactors({
    sport: input.sport,
    marketKey: input.marketKey,
    side: input.side,
    mlb: input.mlb,
    oppDefense: input.oppDefense,
    matchup: input.matchup,
    homeAway: input.homeAway,
    playerSide: input.playerSide,
    usageMinutes: input.usageMinutes,
    mlLeanAligned: input.mlLeanAligned,
    mlLeanEdge: input.mlLeanEdge,
    opponentKeyInjuries: input.opponentKeyInjuries,
  });
  return { score: weightedMatchupScore(factors), factors };
}

export type FinalAiScoreInput = {
  playerScore: number | null;
  matchupScore: number | null;
  combined: CombinedPickScore | null;
  simRow: PropSimulationResult | null;
  odds?: number | null;
};

export function computeFinalAiScore(input: FinalAiScoreInput): {
  score: number | null;
  factors: FinalAiScoreFactor[];
} {
  const { playerScore, matchupScore, combined, simRow, odds } = input;
  const factors: FinalAiScoreFactor[] = [];

  if (playerScore != null) {
    factors.push({
      key: "player",
      label: "Player Score",
      weight: 28,
      sub: playerScore / 100,
      display: String(playerScore),
    });
  }
  if (matchupScore != null) {
    factors.push({
      key: "matchup",
      label: "Matchup Score",
      weight: 28,
      sub: matchupScore / 100,
      display: String(matchupScore),
    });
  }

  const grade = combined?.grade ?? (combined?.composite != null ? gradeFromComposite(combined.composite) : null);
  if (combined?.composite != null) {
    factors.push({
      key: "grade",
      label: "AI Grade",
      weight: 18,
      sub: lin(combined.composite, 5.5, 8.5),
      display: grade,
    });
  }

  const edge = resolveDisplayEdge(combined, simRow, odds);
  if (edge != null) {
    factors.push({
      key: "edge",
      label: "Edge",
      weight: 14,
      sub: lin(edge, 0, 5),
      display: `${edge > 0 ? "+" : ""}${edge}%`,
    });
  } else if (combined?.scores.lineValue != null) {
    factors.push({
      key: "ev",
      label: "Expected value",
      weight: 14,
      sub: subFromPickScore(combined.scores.lineValue),
      display: `line value ${combined.scores.lineValue.toFixed(1)}`,
    });
  }

  if (simRow?.hitProbability != null && isValidPropSim(simRow)) {
    const hit = simRow.hitProbability;
    factors.push({
      key: "sim_hit",
      label: "Monte Carlo",
      weight: 12,
      sub: lin(hit, 0.45, 0.65),
      display: `${Math.round(hit * 100)}% hit`,
    });
  }

  return { score: weightedScore(factors), factors };
}

/** Both player and matchup must agree — never recommend on one side alone. */
export function playerMatchupAgree(
  playerScore: number | null,
  matchupScore: number | null,
): { agrees: boolean; reason: string } {
  if (playerScore == null || matchupScore == null) {
    return {
      agrees: false,
      reason: "Need real player and matchup scores — we won't recommend without both.",
    };
  }

  const playerCold = playerScore < COLD_PLAYER_THRESHOLD;
  const matchupCold = matchupScore < COLD_MATCHUP_THRESHOLD;
  const matchupHot = matchupScore >= HOT_MATCHUP_THRESHOLD;
  const playerHot = playerScore >= HOT_PLAYER_THRESHOLD;

  if (matchupHot && playerCold) {
    return {
      agrees: false,
      reason: "Great matchup, but player is cold — both sides must agree, not the spot alone.",
    };
  }
  if (playerHot && matchupCold) {
    return {
      agrees: false,
      reason: "Hot player, but tough matchup — both sides must agree before we recommend.",
    };
  }

  if (playerScore < MIN_PLAYER_SCORE || matchupScore < MIN_MATCHUP_SCORE) {
    return {
      agrees: false,
      reason: "Player and matchup must both clear the quality bar.",
    };
  }

  const weaker = Math.min(playerScore, matchupScore);
  if (weaker < AGREEMENT_MIN_SCORE) {
    return {
      agrees: false,
      reason: `Player (${playerScore}) and matchup (${matchupScore}) don't agree — the weaker side is too soft.`,
    };
  }

  const gap = Math.abs(playerScore - matchupScore);
  if (gap > MAX_AGREEMENT_GAP) {
    return {
      agrees: false,
      reason: `Player (${playerScore}) and matchup (${matchupScore}) pull apart — we need both sides aligned.`,
    };
  }

  return { agrees: true, reason: "Player and matchup agree." };
}

/** Rank score for comparing props on today's board (higher = better). */
export function boardRankScore(triple: Pick<PropDualScore, "playerScore" | "matchupScore" | "finalAiScore">): number | null {
  const { playerScore, matchupScore, finalAiScore } = triple;
  if (playerScore == null || matchupScore == null || finalAiScore == null) return null;
  if (!playerMatchupAgree(playerScore, matchupScore).agrees) return null;
  const floor = Math.min(playerScore, matchupScore);
  return Math.round(floor * 0.38 + finalAiScore * 0.42 + ((playerScore + matchupScore) / 2) * 0.2);
}

export function buildPropDualVerdict(
  playerScore: number | null,
  matchupScore: number | null,
  finalAiScore: number | null,
): {
  headline: string;
  explanation: string;
  recommends: boolean;
  passesPlayer: boolean;
  passesMatchup: boolean;
  passesFinalAi: boolean;
  playerMatchupAgree: boolean;
} {
  const passesPlayer = playerScore != null && playerScore >= MIN_PLAYER_SCORE;
  const passesMatchup = matchupScore != null && matchupScore >= MIN_MATCHUP_SCORE;
  const passesFinalAi = finalAiScore != null && finalAiScore >= MIN_FINAL_AI_SCORE;
  const agreement = playerMatchupAgree(playerScore, matchupScore);

  let headline = "Pass";
  let explanation = agreement.reason;

  if (!agreement.agrees) {
    headline = "Pass";
  } else if (passesPlayer && passesMatchup && passesFinalAi) {
    headline = "Recommend";
    explanation =
      "Player and matchup agree — this clears the bar as a quality play (Coach/Simulator still require a top-board rank).";
  } else if (!passesPlayer && !passesMatchup) {
    explanation = "Weak on both player form and matchup.";
  } else if (!passesPlayer) {
    explanation = `Matchup is fine (${matchupScore}), but player score (${playerScore}) is below the bar.`;
  } else if (!passesMatchup) {
    explanation = `Player looks okay (${playerScore}), but matchup score (${matchupScore}) is below the bar.`;
  } else if (!passesFinalAi) {
    explanation = `Player and matchup agree, but Final AI score (${finalAiScore}) is too weak — edge, grade, or EV don't support a recommend.`;
  }

  const recommends =
    agreement.agrees && passesPlayer && passesMatchup && passesFinalAi;

  return {
    headline,
    explanation,
    recommends,
    passesPlayer,
    passesMatchup,
    passesFinalAi,
    playerMatchupAgree: agreement.agrees,
  };
}

export function computePropDualScore(
  playerInput: PlayerScoreInput,
  matchupInput: MatchupScoreInput,
): PropDualScore {
  const player = computePlayerScore(playerInput);
  const matchup = computeMatchupScore(matchupInput);
  const finalAi = computeFinalAiScore({
    playerScore: player.score,
    matchupScore: matchup.score,
    combined: playerInput.combined,
    simRow: playerInput.simRow,
    odds: playerInput.odds,
  });
  const verdict = buildPropDualVerdict(player.score, matchup.score, finalAi.score);

  return {
    playerScore: player.score,
    matchupScore: matchup.score,
    finalAiScore: finalAi.score,
    playerFactors: player.factors,
    matchupFactors: matchup.factors,
    finalAiFactors: finalAi.factors,
    passesPlayer: verdict.passesPlayer,
    passesMatchup: verdict.passesMatchup,
    passesFinalAi: verdict.passesFinalAi,
    playerMatchupAgree: verdict.playerMatchupAgree,
    recommends: verdict.recommends,
    headline: verdict.headline,
    explanation: verdict.explanation,
  };
}

export type BoardQualityCtx = {
  rankScore: number;
  globalPercentile: number;
  bestInFamily: boolean;
  familyRank: number;
  familySize: number;
};

const BOARD_TOP_PERCENTILE = 0.88;

function passesBoardGate(ctx: BoardQualityCtx | null | undefined): boolean {
  if (!ctx) return false;
  return ctx.bestInFamily || ctx.globalPercentile >= BOARD_TOP_PERCENTILE;
}

export type PropRecommendOpts = {
  simRow?: PropSimulationResult | null;
  combined?: CombinedPickScore | null;
  /** When set, prop must be a top-board play in its market or slate. */
  board?: BoardQualityCtx | null;
};

/** Full recommendability gate for Coach / Simulator — includes board rank when provided. */
export function propDualScoreRecommends(
  triple: PropDualScore | null | undefined,
  simRowOrOpts?: PropSimulationResult | null | PropRecommendOpts,
  combinedLegacy?: CombinedPickScore | null,
): boolean {
  const opts: PropRecommendOpts =
    simRowOrOpts != null && typeof simRowOrOpts === "object" && "simRow" in simRowOrOpts
      ? simRowOrOpts
      : { simRow: simRowOrOpts as PropSimulationResult | null, combined: combinedLegacy };

  if (!triple?.recommends || !triple.playerMatchupAgree) return false;

  if (opts.board !== undefined && !passesBoardGate(opts.board)) return false;

  const simRow = opts.simRow;
  const combined = opts.combined;

  const grade =
    triple.finalAiFactors.find((f) => f.key === "grade")?.display ??
    combined?.grade ??
    null;
  if (grade && gradeRank(grade) < gradeRank(MIN_GRADE)) return false;

  const conf = combined?.confidencePct;
  if (conf == null || conf < MIN_CONFIDENCE_PCT) return false;

  const edgeFactor = triple.finalAiFactors.find((f) => f.key === "edge");
  const edge =
    edgeFactor?.display != null
      ? Number.parseFloat(String(edgeFactor.display).replace(/[^0-9.-]/g, ""))
      : combined?.edgePct ?? null;
  if (edge == null || edge <= 0) return false;

  if (simRow != null) {
    if (!isValidPropSim(simRow)) return false;
    const hit = simRow.hitProbability;
    if (hit == null || hit < MIN_SIM_HIT) return false;
  }

  return true;
}

export const pickTripleScoreRecommends = propDualScoreRecommends;

/** Map 0..100 dual score to the 1..10 pick-rubric sub-score scale. */
export function dualScoreToPickSub(score: number | null | undefined): number | null {
  if (score == null || !Number.isFinite(score)) return null;
  return Math.round((1 + (score / 100) * 9) * 10) / 10;
}

function splitGameLabel(label: string): { away: string; home: string } {
  const parts = String(label || "").split(" @ ");
  return { away: (parts[0] || "").trim(), home: (parts[1] || "").trim() };
}

function resolvePlayerTeam(
  game: string,
  teamAbbr: string | null | undefined,
  recentGames?: Array<{ opp?: string | null }>,
): string | null {
  const { away, home } = splitGameLabel(game);
  const ab = teamAbbr?.toUpperCase();
  if (ab) {
    if (away.toUpperCase().includes(ab)) return away;
    if (home.toUpperCase().includes(ab)) return home;
  }
  const opps = (recentGames ?? [])
    .map((r) => String(r.opp ?? "").toLowerCase())
    .filter(Boolean);
  if (!opps.length || !away || !home) return null;
  const nick = (n: string) => n.toLowerCase().split(/\s+/).pop() ?? "";
  const seen = (n: string) => {
    const k = nick(n);
    return !!k && opps.some((o) => o.includes(k));
  };
  const awayIsOpp = seen(away);
  const homeIsOpp = seen(home);
  if (awayIsOpp && !homeIsOpp) return home;
  if (homeIsOpp && !awayIsOpp) return away;
  return null;
}

function hitPctFromRecent(
  recent: Array<{ stats?: Record<string, string> }> | undefined,
  labels: string[] | undefined,
  marketKey: string,
  line: number | null,
  side: string,
): number | null {
  if (!recent?.length || line == null) return null;
  const ambiguous = computeAmbiguous(labels);
  const isUnder = String(side).toLowerCase() === "under";
  const vals = recent
    .map((g) => gameValueForMarket(marketKey, g.stats ?? {}, ambiguous))
    .filter((v): v is number => v != null);
  if (vals.length === 0) return null;
  const hits = vals.filter((v) => (isUnder ? v < line : v >= line)).length;
  return Math.round((hits / vals.length) * 100);
}

function opponentKeyInjuries(
  game: string,
  playerTeam: string | null,
  sport: string,
  matchupInjuries?: Record<string, GameInjuryReport>,
  injuryTeams?: InjuryTeam[],
): number | null {
  const { away, home } = splitGameLabel(game);
  const opp =
    playerTeam && teamNameMatches(playerTeam, away)
      ? home
      : playerTeam && teamNameMatches(playerTeam, home)
        ? away
        : null;
  if (!opp) return null;
  const report = matchupInjuries?.[game];
  if (report) {
    const oppSide = report.sides.find((s) => teamNameMatches(s.team, opp));
    return oppSide?.keyPlayers.filter((k) => k.impact === "high").length ?? 0;
  }
  if (injuryTeams?.length) {
    const oppTeam = injuryTeams.find((t) => teamNameMatches(t.team, opp));
    if (oppTeam) return summarizeTeamInjuries(sport, oppTeam).highCount;
  }
  return null;
}

function resolvePlayerSide(
  game: string,
  playerTeam: string | null,
): "home" | "away" | null {
  if (!playerTeam) return null;
  const { away, home } = splitGameLabel(game);
  if (teamNameMatches(playerTeam, home)) return "home";
  if (teamNameMatches(playerTeam, away)) return "away";
  return null;
}

export type PropDualBuildOpts = {
  sport: string;
  marketKey: string;
  game: string;
  player?: string;
  line: number | null;
  side: string;
  odds?: number;
  teamAbbr?: string | null;
  recentGames?: Array<{ stats?: Record<string, string>; opp?: string | null }>;
  labels?: string[];
  matchupHistory?: Record<string, MatchupHistoryEntry>;
  matchupInjuries?: Record<string, GameInjuryReport>;
  injuryTeams?: InjuryTeam[];
  mlb?: RealPropSignals["mlb"] | null;
  oppDefense?: RealPropSignals["oppDefense"] | null;
  homeAway?: RealPropSignals["homeAway"] | null;
  usageMinutes?: number | null;
  playerInjured?: boolean;
  projection?: number | null;
};

function avgMinutesFromGames(
  recent?: Array<{ stats?: Record<string, string> }>,
  labels?: string[],
): number | null {
  if (!recent?.length) return null;
  const minLabel = labels?.find((l) => /^min(ute)?s?$/i.test(l.trim()));
  if (!minLabel) return null;
  const vals: number[] = [];
  for (const g of recent) {
    const raw = g.stats?.[minLabel];
    if (raw == null) continue;
    const m = String(raw).match(/^(\d+)(?::(\d+))?/);
    if (!m) continue;
    const v = Number(m[1]) + (m[2] ? Number(m[2]) / 60 : 0);
    if (Number.isFinite(v) && v > 0) vals.push(v);
  }
  if (vals.length === 0) return null;
  return Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10;
}

/** Build dual score for Coach / Simulator legs from shared context. */
export function buildPropDualScoreForLeg(
  combined: CombinedPickScore | null | undefined,
  simRow: PropSimulationResult | null | undefined,
  opts: PropDualBuildOpts,
): PropDualScore {
  const playerTeam = resolvePlayerTeam(opts.game, opts.teamAbbr, opts.recentGames);
  const playerSide = resolvePlayerSide(opts.game, playerTeam);
  const entry = opts.matchupHistory?.[opts.game];
  const { aligned, leanEdge } = matchupAlignment(entry?.mlLean, playerTeam);
  const mlLeanAligned =
    aligned === 1 ? (1 as const) : aligned === -1 ? (-1 as const) : aligned === 0 ? (0 as const) : null;
  const hitPct =
    hitPctFromRecent(opts.recentGames, opts.labels, opts.marketKey, opts.line, opts.side) ??
    null;
  const usageMinutes = opts.usageMinutes ?? avgMinutesFromGames(opts.recentGames, opts.labels);

  return computePropDualScore(
    {
      combined: combined ?? null,
      simRow: simRow ?? null,
      odds: opts.odds,
      projection: opts.projection ?? null,
      line: opts.line,
      side: opts.side,
      hitPct,
      playerInjured: opts.playerInjured,
    },
    {
      sport: opts.sport,
      marketKey: opts.marketKey,
      mlb: opts.mlb,
      oppDefense: opts.oppDefense,
      matchup: entry ?? null,
      homeAway: opts.homeAway,
      playerSide,
      usageMinutes,
      mlLeanAligned,
      mlLeanEdge: leanEdge > 0 ? leanEdge : null,
      opponentKeyInjuries: opponentKeyInjuries(
        opts.game,
        playerTeam,
        opts.sport,
        opts.matchupInjuries,
        opts.injuryTeams,
      ),
      side: opts.side,
    },
  );
}

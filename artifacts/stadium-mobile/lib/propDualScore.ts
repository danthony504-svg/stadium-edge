// Player Score + Matchup Score — both must clear the bar before a prop is
// recommended. Never endorse on a hot player in a bad spot, or a great matchup
// with a cold player.

import type { InjuryTeam, MatchupHistoryEntry, PropSimulationResult } from "./api.ts";
import type { CombinedPickScore } from "./pickScore.ts";
import { americanToImplied, gradeFromComposite, matchupAlignment } from "./pickScore.ts";
import { computeHrScore, type HrScoreInput } from "./hrScore.ts";
import type { RealPropSignals } from "./propFactors.ts";
import { computeAmbiguous, gameValueForMarket } from "./propStats.ts";
import type { GameInjuryReport } from "./injuries.ts";
import { summarizeTeamInjuries, teamNameMatches } from "./injuries.ts";

export const MIN_PLAYER_SCORE = 55;
export const MIN_MATCHUP_SCORE = 55;
export const HOT_PLAYER_THRESHOLD = 62;
export const HOT_MATCHUP_THRESHOLD = 62;
export const COLD_PLAYER_THRESHOLD = 48;
export const COLD_MATCHUP_THRESHOLD = 48;

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

export type MatchupScoreFactor = {
  key: string;
  label: string;
  weight: number;
  sub: number | null;
  display: string | null;
};

export type PropDualScore = {
  playerScore: number | null;
  matchupScore: number | null;
  playerFactors: PlayerScoreFactor[];
  matchupFactors: MatchupScoreFactor[];
  passesPlayer: boolean;
  passesMatchup: boolean;
  recommends: boolean;
  headline: string;
  explanation: string;
};

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

  let gradeSub: number | null = null;
  let gradeDisplay: string | null = null;
  if (combined?.composite != null) {
    gradeSub = lin(combined.composite, 5.5, 8.5);
    gradeDisplay = combined.grade ?? gradeFromComposite(combined.composite) ?? null;
  }

  let confSub: number | null = null;
  let confDisplay: string | null = null;
  if (combined?.confidencePct != null) {
    confSub = lin(combined.confidencePct, 45, 75);
    confDisplay = `${combined.confidencePct}% confidence`;
  }

  const edge = resolveDisplayEdge(combined, simRow, input.odds);
  let edgeSub: number | null = null;
  let edgeDisplay: string | null = null;
  if (edge != null) {
    edgeSub = lin(edge, 0, 5);
    edgeDisplay = `${edge > 0 ? "+" : ""}${edge}%`;
  } else if (combined?.scores.lineValue != null) {
    edgeSub = subFromPickScore(combined.scores.lineValue);
    edgeDisplay = `line value ${combined.scores.lineValue.toFixed(1)}`;
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
    { key: "form", label: "Recent form", weight: 22, sub: formSub, display: formDisplay },
    { key: "sim", label: "Simulation", weight: 20, sub: simSub, display: simDisplay },
    { key: "grade", label: "AI Grade", weight: 18, sub: gradeSub, display: gradeDisplay },
    { key: "confidence", label: "Confidence", weight: 12, sub: confSub, display: confDisplay },
    { key: "edge", label: "Edge", weight: 13, sub: edgeSub, display: edgeDisplay },
    { key: "projection", label: "Projection", weight: 15, sub: projSub, display: projDisplay },
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
  /** mlLean alignment for the player's team: +1 on lean side, -1 against. */
  mlLeanAligned?: 1 | 0 | -1 | null;
  mlLeanEdge?: number | null;
  /** High-impact opponent injuries modestly help overs. */
  opponentKeyInjuries?: number | null;
  side?: string;
};

function isHrMarket(sport: string, marketKey: string): boolean {
  return sport === "mlb" && (/home_?run/i.test(marketKey) || /batter_home_runs/.test(marketKey));
}

export function computeMatchupScore(input: MatchupScoreInput): {
  score: number | null;
  factors: MatchupScoreFactor[];
} {
  const { sport, marketKey, mlb, oppDefense, mlLeanAligned, mlLeanEdge, opponentKeyInjuries, side } =
    input;
  const factors: MatchupScoreFactor[] = [];

  if (sport === "mlb" && mlb) {
    if (isHrMarket(sport, marketKey)) {
      const hrInput: HrScoreInput = {
        hrPer9: mlb.pitcher?.hrPer9 ?? null,
        barrelPctAllowed: mlb.pitcher?.barrelPctAllowed ?? null,
        hardHitPctAllowed: mlb.pitcher?.hardHitPctAllowed ?? null,
        battedBallEvents: mlb.pitcher?.battedBallEvents ?? null,
        flyBallPct: mlb.pitcher?.flyBallPct ?? null,
        hrIndex: mlb.ballpark?.hrIndex ?? null,
        tempF: mlb.ballpark?.tempF ?? null,
        dome: mlb.ballpark?.dome ?? null,
        platoonOps: mlb.platoon?.ops ?? null,
      };
      const hr = computeHrScore(hrInput);
      for (const f of hr.factors) {
        if (f.sub == null) continue;
        factors.push({
          key: f.key,
          label: f.label,
          weight: f.weight,
          sub: f.sub,
          display: f.display,
        });
      }
      if (mlb.pitcher?.name) {
        factors.push({
          key: "pitcher",
          label: "Opposing starter",
          weight: 5,
          sub: mlb.pitcher.kPer9 != null ? lin(9 - mlb.pitcher.kPer9, 0, 5) : 0.5,
          display: mlb.pitcher.name,
        });
      }
    } else {
      const p = mlb.pitcher;
      if (p?.hrPer9 != null) {
        factors.push({
          key: "hr9",
          label: "Pitcher HR/9",
          weight: 15,
          sub: lin(p.hrPer9, 0.6, 1.8),
          display: `${p.hrPer9.toFixed(2)} HR/9`,
        });
      }
      if (p?.oppOPS != null) {
        factors.push({
          key: "oppops",
          label: "Pitcher opp OPS",
          weight: 20,
          sub: lin(p.oppOPS, 0.65, 0.85),
          display: `${p.oppOPS.toFixed(3)} OPS`,
        });
      }
      if (p?.kPer9 != null && /strikeout|pitcher_strikeout/i.test(marketKey)) {
        factors.push({
          key: "k9",
          label: "Pitcher K/9",
          weight: 25,
          sub: lin(11 - p.kPer9, 0, 4),
          display: `${p.kPer9.toFixed(1)} K/9`,
        });
      }
      if (mlb.platoon?.ops != null) {
        factors.push({
          key: "platoon",
          label: "Platoon OPS",
          weight: 15,
          sub: lin(mlb.platoon.ops, 0.65, 0.95),
          display: `${mlb.platoon.ops.toFixed(3)} vs ${mlb.platoon.hand}`,
        });
      }
      if (mlb.ballpark?.hrIndex != null && /total.?base|hit|rbi/i.test(marketKey)) {
        factors.push({
          key: "park",
          label: "Park factor",
          weight: 10,
          sub: lin(mlb.ballpark.hrIndex, 90, 115),
          display: `${Math.round(mlb.ballpark.hrIndex)} index`,
        });
      }
      if (mlb.ballpark?.tempF != null || mlb.ballpark?.dome) {
        const sub = mlb.ballpark.dome ? 0.5 : lin(mlb.ballpark.tempF ?? 50, 50, 90);
        factors.push({
          key: "weather",
          label: "Weather",
          weight: 8,
          sub,
          display: mlb.ballpark.dome ? "Dome" : `${mlb.ballpark.tempF}°F`,
        });
      }
      if (p?.name) {
        factors.push({
          key: "starter",
          label: "Probable starter",
          weight: 5,
          sub: 0.55,
          display: p.name,
        });
      }
    }
  }

  if (oppDefense?.pointsAgainst != null) {
    factors.push({
      key: "defense",
      label: "Opp scoring allowed",
      weight: 18,
      sub: lin(oppDefense.pointsAgainst, 100, 118),
      display: `${oppDefense.pointsAgainst.toFixed(1)}/game`,
    });
  }
  if (oppDefense?.blocks != null) {
    factors.push({
      key: "blocks",
      label: "Opp blocks",
      weight: 8,
      sub: lin(6 - oppDefense.blocks, 0, 3),
      display: `${oppDefense.blocks.toFixed(1)} blk/g`,
    });
  }

  if (mlLeanAligned != null && mlLeanEdge != null && mlLeanEdge > 0) {
    const sub = mlLeanAligned === 1 ? lin(mlLeanEdge, 0, 4) : mlLeanAligned === -1 ? lin(4 - mlLeanEdge, 0, 4) : 0.5;
    factors.push({
      key: "lean",
      label: "Game lean",
      weight: 14,
      sub,
      display: mlLeanAligned === 1 ? "on your side" : mlLeanAligned === -1 ? "against" : "neutral",
    });
  }

  if (opponentKeyInjuries != null && opponentKeyInjuries > 0) {
    const helpsOver = String(side ?? "over").toLowerCase() !== "under";
    factors.push({
      key: "opp_inj",
      label: "Opp injuries",
      weight: 10,
      sub: helpsOver ? lin(opponentKeyInjuries, 0, 4) : lin(4 - opponentKeyInjuries, 0, 4),
      display: `${opponentKeyInjuries} key out`,
    });
  }

  return { score: weightedScore(factors), factors };
}

function bandLabel(score: number | null, kind: "player" | "matchup"): string {
  if (score == null) return "Not enough data";
  if (score >= HOT_PLAYER_THRESHOLD) return kind === "player" ? "Hot player" : "Great matchup";
  if (score >= MIN_PLAYER_SCORE) return kind === "player" ? "Solid player" : "Favorable matchup";
  if (score >= COLD_PLAYER_THRESHOLD) return kind === "player" ? "Mixed form" : "Mixed matchup";
  return kind === "player" ? "Cold player" : "Tough matchup";
}

export function buildPropDualVerdict(
  playerScore: number | null,
  matchupScore: number | null,
): { headline: string; explanation: string; recommends: boolean; passesPlayer: boolean; passesMatchup: boolean } {
  const passesPlayer = playerScore != null && playerScore >= MIN_PLAYER_SCORE;
  const passesMatchup = matchupScore != null && matchupScore >= MIN_MATCHUP_SCORE;
  const playerHot = playerScore != null && playerScore >= HOT_PLAYER_THRESHOLD;
  const playerCold = playerScore != null && playerScore < COLD_PLAYER_THRESHOLD;
  const matchupHot = matchupScore != null && matchupScore >= HOT_MATCHUP_THRESHOLD;
  const matchupCold = matchupScore != null && matchupScore < COLD_MATCHUP_THRESHOLD;

  let headline = "Pass";
  let explanation = "";

  if (passesPlayer && passesMatchup) {
    headline = "Recommend";
    explanation = "Player form and matchup both clear the quality bar.";
  } else if (matchupHot && playerCold) {
    headline = "Pass";
    explanation = "Great matchup, but player is cold — won't recommend on spot alone.";
  } else if (playerHot && matchupCold) {
    headline = "Pass";
    explanation = "Hot player, but tough matchup — need both sides before recommending.";
  } else if (!passesPlayer && !passesMatchup) {
    headline = "Pass";
    explanation = "Weak on both player form and matchup.";
  } else if (!passesPlayer) {
    headline = "Pass";
    explanation = `Matchup is fine (${matchupScore}), but player score (${playerScore}) is below the bar.`;
  } else {
    headline = "Pass";
    explanation = `Player looks okay (${playerScore}), but matchup score (${matchupScore}) is below the bar.`;
  }

  const recommends = passesPlayer && passesMatchup;

  return { headline, explanation, recommends, passesPlayer, passesMatchup };
}

export function computePropDualScore(
  playerInput: PlayerScoreInput,
  matchupInput: MatchupScoreInput,
): PropDualScore {
  const player = computePlayerScore(playerInput);
  const matchup = computeMatchupScore(matchupInput);
  const verdict = buildPropDualVerdict(player.score, matchup.score);

  return {
    playerScore: player.score,
    matchupScore: matchup.score,
    playerFactors: player.factors,
    matchupFactors: matchup.factors,
    passesPlayer: verdict.passesPlayer,
    passesMatchup: verdict.passesMatchup,
    recommends: verdict.recommends,
    headline: verdict.headline,
    explanation: verdict.explanation,
  };
}

/** Stricter recommendability for Coach / Simulator tickets. */
export function propDualScoreRecommends(dual: PropDualScore | null | undefined): boolean {
  if (!dual?.recommends) return false;
  const grade = dual.playerFactors.find((f) => f.key === "grade")?.display;
  if (grade && gradeRank(grade) < gradeRank("B+")) return false;
  return true;
}

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
  playerInjured?: boolean;
  projection?: number | null;
};

/** Build dual score for Coach / Simulator legs from shared context. */
export function buildPropDualScoreForLeg(
  combined: CombinedPickScore | null | undefined,
  simRow: PropSimulationResult | null | undefined,
  opts: PropDualBuildOpts,
): PropDualScore {
  const playerTeam = resolvePlayerTeam(opts.game, opts.teamAbbr, opts.recentGames);
  const entry = opts.matchupHistory?.[opts.game];
  const { aligned, leanEdge } = matchupAlignment(entry?.mlLean, playerTeam);
  const mlLeanAligned =
    aligned === 1 ? (1 as const) : aligned === -1 ? (-1 as const) : aligned === 0 ? (0 as const) : null;
  const hitPct =
    hitPctFromRecent(opts.recentGames, opts.labels, opts.marketKey, opts.line, opts.side) ??
    null;

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

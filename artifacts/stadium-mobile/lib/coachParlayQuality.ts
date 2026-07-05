// Coach parlay quality — every leg must clear the same bar before it ships.
// Quality over count: never pad to reach N; swap weak legs for stronger ones.

import type { ParsedPick } from "@/components/PickCard";
import type { PropPoolEntry, PropSimulationResult, RealOddsEntry } from "./api";
import {
  coachPropHasMonteCarlo,
  coachPropSimRow,
  coachPickSimKey,
  type CoachPropSimEntry,
} from "./coachPropMonteCarlo";
import { attachPickScores, type PlayerHistorySlice } from "./pickScoreContext";
import type { CombinedPickScore } from "./pickScore";
import { rankPropPoolEntries, propSimKey } from "./propSelection";
import { gradeRank } from "./simulatorRecommendations";
import {
  resolveDisplayEdge,
  capGradeForSimHit,
} from "./simPropValidity";
import type { MarketPerf } from "./marketWeighting";
import {
  evaluateCoachLegQuality,
  COACH_MIN_GRADE,
  COACH_MIN_GRADE_RANK,
} from "./coachLegQuality";
import { buildPropDualScoreForLeg } from "./propDualScore";

export {
  evaluateCoachLegQuality,
  COACH_MIN_GRADE,
  COACH_MIN_GRADE_RANK,
  COACH_MIN_CONFIDENCE_PCT,
  COACH_MIN_SIM_HIT,
} from "./coachLegQuality";

export type CoachScoreOpts = {
  realOdds?: RealOddsEntry[];
  propPool?: PropPoolEntry[];
  matchupHistory?: Record<string, import("./api").MatchupHistoryEntry>;
  matchupInjuries?: Record<string, import("@/lib/injuries").GameInjuryReport>;
  perfByFamily?: Map<string, MarketPerf>;
  playerHistory?: Record<string, PlayerHistorySlice>;
  propSimulations?: Map<string, CoachPropSimEntry>;
};

function propPoolEntryForPick(pick: ParsedPick, pool: PropPoolEntry[]): PropPoolEntry | undefined {
  const mk = pick.propMarketKey ?? pick.market;
  return (
    pool.find(
      (e) =>
        e.game === pick.game &&
        e.player === pick.player &&
        (e.marketKey ?? e.marketLabel) === mk &&
        e.side === pick.propSide &&
        e.line === pick.propLine,
    ) ??
    pool.find(
      (e) =>
        e.game === pick.game &&
        e.player === pick.player &&
        e.side === pick.propSide &&
        e.line === pick.propLine,
    )
  );
}

function playerHistoryForCoach(
  player: string | undefined,
  athleteId: string | null | undefined,
  map?: Record<string, PlayerHistorySlice>,
): PlayerHistorySlice | undefined {
  if (!map) return undefined;
  if (athleteId) {
    const hit =
      map[`${player}#${athleteId}`] ??
      Object.entries(map).find(([k]) => k.endsWith(`#${athleteId}`))?.[1];
    if (hit) return hit;
  }
  if (player) {
    return Object.entries(map).find(([k]) => k.startsWith(`${player}#`))?.[1];
  }
  return undefined;
}

function dualForCoachPick(
  pick: ParsedPick,
  combined: CombinedPickScore | null | undefined,
  simRow: PropSimulationResult | null,
  scoreOpts: CoachScoreOpts,
  propPool: PropPoolEntry[],
) {
  if (!pick.isProp || !pick.sport) return null;
  const entry = propPoolEntryForPick(pick, propPool);
  const ph = playerHistoryForCoach(pick.player, pick.athleteId ?? entry?.athleteId, scoreOpts.playerHistory);
  return buildPropDualScoreForLeg(combined, simRow, {
    sport: pick.sport,
    marketKey: pick.propMarketKey ?? entry?.marketKey ?? pick.market,
    game: pick.game,
    player: pick.player,
    line: pick.propLine ?? entry?.line ?? null,
    side: pick.propSide ?? entry?.side ?? "Over",
    odds: pick.odds,
    teamAbbr: entry?.teamAbbr ?? pick.teamAbbr,
    recentGames: ph?.recent?.map((g) => ({ stats: g.stats, opp: g.opp })),
    labels: ph?.labels,
    matchupHistory: scoreOpts.matchupHistory,
    matchupInjuries: scoreOpts.matchupInjuries,
    injuryTeams: undefined,
  });
}

function propSimRowForPick(
  pick: ParsedPick,
  sims?: Map<string, CoachPropSimEntry>,
): PropSimulationResult | null {
  if (!pick.isProp || !sims) return null;
  const key = coachPickSimKey(pick);
  if (!key) return null;
  const entry = sims.get(key);
  if (!entry) return null;
  return coachPropSimRow(entry, pick);
}

function effectiveEdge(
  combined: CombinedPickScore | null | undefined,
  simRow: PropSimulationResult | null,
  odds?: number,
): number | null {
  return resolveDisplayEdge(combined, simRow, odds);
}

function rungBalanceScore(
  combined: CombinedPickScore,
  simHit: number | null,
  edge: number | null,
): number {
  const gr = gradeRank(combined.grade);
  const conf = combined.confidencePct ?? 0;
  const e = edge ?? 0;
  const hit = simHit ?? 0;
  return hit * 48 + e * 2.2 + gr * 9 + conf * 0.12;
}

function poolEntryToPick(e: PropPoolEntry): ParsedPick {
  const pick =
    e.line != null
      ? `${e.player} ${e.side} ${e.line} ${e.marketLabel}`
      : `${e.player} ${e.marketLabel}`;
  return {
    game: e.game,
    market: e.marketLabel,
    pick,
    odds: e.odds,
    sport: e.sport,
    isProp: true,
    startsAt: e.startsAt,
    headshot: e.headshot,
    teamAbbr: e.teamAbbr,
    player: e.player,
    athleteId: e.athleteId,
    propMarketKey: e.marketKey,
    propLine: e.line,
    propSide: e.side,
  };
}

function samePropLadder(a: PropPoolEntry, pick: ParsedPick): boolean {
  if (!pick.player || !pick.propSide) return false;
  const mkt = pick.propMarketKey ?? pick.market;
  return (
    a.player === pick.player &&
    a.side === pick.propSide &&
    (a.marketKey === mkt || a.marketLabel === pick.market)
  );
}

/**
 * Compare every posted rung on the same player+market+side; pick the best
 * balance of grade, confidence, edge, EV, and Monte Carlo hit %.
 */
export function optimizePropPickRung(
  pick: ParsedPick,
  propPool: PropPoolEntry[],
  scoreOpts: CoachScoreOpts,
): ParsedPick {
  if (!pick.isProp || !pick.player || pick.propLine == null) return pick;

  const rungs = propPool.filter((e) => samePropLadder(e, pick) && e.line != null);
  if (rungs.length <= 1) return pick;

  const sims = scoreOpts.propSimulations;
  let bestPick = pick;
  let bestUtility = -Infinity;

  for (const e of rungs) {
    const candidate = poolEntryToPick(e);
    const [scored] = attachPickScores([candidate], {
      ...scoreOpts,
      propPool,
    });
    if (!scored?.scores) continue;

    const key =
      e.line != null
        ? propSimKey(e.player, e.marketKey ?? e.marketLabel, e.line, e.side)
        : null;
    const simEntry = key && sims ? sims.get(key) : undefined;
    if (!simEntry || !coachPropHasMonteCarlo(simEntry)) continue;

    const simRow = coachPropSimRow(simEntry, scored);
    let combined = capGradeForSimHit(scored.scores, simRow);
    const edge = effectiveEdge(combined, simRow, scored.odds);
    const hit = simRow?.hitProbability ?? null;
    const quality = evaluateCoachLegQuality(
      { ...scored, scores: combined },
      simRow,
      dualForCoachPick({ ...scored, scores: combined }, combined, simRow, scoreOpts, propPool),
    );
    if (!quality.passes) continue;

    const utility = rungBalanceScore(combined, hit, edge);
    if (utility > bestUtility) {
      bestUtility = utility;
      bestPick = { ...scored, scores: combined };
    }
  }

  return bestPick;
}

export function optimizeCoachPickRungs(
  picks: ParsedPick[],
  propPool: PropPoolEntry[],
  scoreOpts: CoachScoreOpts,
): ParsedPick[] {
  return picks.map((p) =>
    p.isProp ? optimizePropPickRung(p, propPool, scoreOpts) : p,
  );
}

function pickLegKey(p: ParsedPick): string {
  return `${p.game}|${p.player}|${p.market}|${p.propLine}|${p.propSide}`.toLowerCase();
}

export type FilterCoachParlayResult = {
  picks: ParsedPick[];
  note: string;
  droppedCount: number;
  replacedCount: number;
};

/**
 * Drop legs that fail quality; replace props with stronger pool candidates.
 * Game legs pass through only when they meet the bar. Never pads leg count.
 */
export function filterAndReplaceCoachParlay(
  picks: ParsedPick[],
  opts: {
    propPool: PropPoolEntry[];
    scoreOpts: CoachScoreOpts;
    /** Max replacement attempts per dropped prop (default: dropped count). */
    replaceBudget?: number;
  },
): FilterCoachParlayResult {
  const { propPool, scoreOpts } = opts;
  const sims = scoreOpts.propSimulations;

  const scorePick = (p: ParsedPick): ParsedPick => {
    const [scored] = attachPickScores([p], { ...scoreOpts, propPool });
    if (!scored?.scores || !scored.isProp) return scored ?? p;
    const simRow = propSimRowForPick(scored, sims);
    const capped = simRow ? capGradeForSimHit(scored.scores, simRow) : scored.scores;
    return { ...scored, scores: capped };
  };

  const kept: ParsedPick[] = [];
  const droppedProps: ParsedPick[] = [];

  for (const p of picks) {
    const scored = scorePick(p);
    const simRow = propSimRowForPick(scored, sims);
    const dual = dualForCoachPick(scored, scored.scores, simRow, scoreOpts, propPool);
    const q = evaluateCoachLegQuality(scored, simRow, dual);
    if (q.passes) kept.push(scored);
    else if (scored.isProp) droppedProps.push(scored);
  }

  const usedPlayers = new Set(
    kept.filter((p) => p.isProp).map((p) => (p.player ?? "").toLowerCase()).filter(Boolean),
  );
  const usedLegs = new Set(kept.map(pickLegKey));
  let replacedCount = 0;

  if (droppedProps.length > 0 && sims) {
    const ranked = rankPropPoolEntries(propPool, {
      ...scoreOpts,
      propPool,
      propSimulations: sims,
    });
    const budget = opts.replaceBudget ?? droppedProps.length;

    for (let i = 0; i < budget; i++) {
      let swapped = false;
      for (const entry of ranked) {
        const playerKey = entry.player.toLowerCase();
        if (usedPlayers.has(playerKey)) continue;
        const candidate = poolEntryToPick(entry);
        const legKey = pickLegKey(candidate);
        if (usedLegs.has(legKey)) continue;

        const optimized = optimizePropPickRung(candidate, propPool, scoreOpts);
        const scored = scorePick(optimized);
        const simRow = propSimRowForPick(scored, sims);
        const dual = dualForCoachPick(scored, scored.scores, simRow, scoreOpts, propPool);
        const q = evaluateCoachLegQuality(scored, simRow, dual);
        if (!q.passes) continue;

        kept.push(scored);
        usedPlayers.add(playerKey);
        usedLegs.add(pickLegKey(scored));
        replacedCount += 1;
        swapped = true;
        break;
      }
      if (!swapped) break;
    }
  }

  const droppedCount = droppedProps.length - replacedCount;
  let note = "";
  if (droppedCount > 0 || replacedCount > 0) {
    const parts: string[] = [];
    if (droppedCount > 0) {
      parts.push(
        `removed ${droppedCount} leg${droppedCount === 1 ? "" : "s"} that didn't meet the B+ / edge / sim / matchup bar`,
      );
    }
    if (replacedCount > 0) {
      parts.push(
        `swapped in ${replacedCount} stronger leg${replacedCount === 1 ? "" : "s"}`,
      );
    }
    note = `_Quality bar: ${parts.join("; ")}. I only build from legs that clear every check — won't pad the ticket with filler._`;
  }

  return { picks: kept, note, droppedCount, replacedCount };
}

/** Whether a pool row is eligible for quality-gated backfill. */
export function propEntryPassesCoachQuality(
  entry: PropPoolEntry,
  propPool: PropPoolEntry[],
  scoreOpts: CoachScoreOpts,
): boolean {
  const pick = poolEntryToPick(entry);
  const optimized = optimizePropPickRung(pick, propPool, scoreOpts);
  const [scored] = attachPickScores([optimized], { ...scoreOpts, propPool });
  if (!scored?.scores) return false;
  const simRow = propSimRowForPick(scored, scoreOpts.propSimulations);
  const capped = simRow ? capGradeForSimHit(scored.scores, simRow) : scored.scores;
  const dual = dualForCoachPick({ ...scored, scores: capped }, capped, simRow, scoreOpts, propPool);
  return evaluateCoachLegQuality({ ...scored, scores: capped }, simRow, dual).passes;
}

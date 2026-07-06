// Scan the entire live board and return the strongest qualified picks.

import type { ParsedPick } from "../components/PickCard.tsx";
import type { PropPoolEntry, RealOddsEntry, MatchupHistoryEntry } from "./api.ts";
import { fetchPropSimulations } from "./api.ts";
import type { GameInjuryReport } from "./injuries.ts";
import type { CoachGameSimEntry } from "./gameSimScoring.ts";
import {
  evaluateGameLines,
  mergeOddsEntries,
  type EvaluatedGameLine,
} from "./gameLineOptimizer.ts";
import { computeGameLineFinalScoreBreakdown } from "./gameLineFinalScore.ts";
import { defaultDiversityCaps, pickMarketFamily } from "./pickDiversity.ts";
import { reachSelectQualifiedToTarget } from "./parlaySelectReach.ts";
import { deprioritizePropPoolEntries } from "./parlayVarietyMemory.ts";
import { snapshotFrozenGameLineDisplay } from "./frozenGameLinePick.ts";
import { attachPickScores, type PlayerHistorySlice } from "./pickScoreContext.ts";
import { parsedPickFromPoolEntry, type PropSelectionOpts } from "./propSelection.ts";
import { pickLegFingerprint, reachParlayMix, type ParlayLegReject } from "./parlayReachCore.ts";
import type { MarketPerf } from "./marketWeighting.ts";
import { gameLineRowQualifies, isBestEvAmongRows } from "./altLineEvSelect.ts";
import {
  comparePickStrength,
  isFullyQualifiedPick,
  isLongshotSectionPick,
  nearScoreFromPick,
  reasonPickNotQualified,
  resolvePickEdgePct,
} from "./parlayQualifiedGate.ts";

export type BoardScoreAttachOpts = {
  realOdds?: RealOddsEntry[];
  propPool?: PropPoolEntry[];
  matchupHistory?: Record<string, MatchupHistoryEntry>;
  matchupInjuries?: Record<string, GameInjuryReport>;
  perfByFamily?: Map<string, MarketPerf>;
  playerHistory?: Record<string, PlayerHistorySlice>;
  gameSimulations?: Map<string, CoachGameSimEntry>;
};

const PROP_SIM_BATCH_SIZE = 80;
const PROP_SIM_INITIAL_CAP = 160;
const PROP_SIM_MAX_CAP = 480;

function simMapFromPropResults(
  rows: Iterable<{ key: string; hitProbability: number | null }>,
): Map<string, { hitProbability: number | null }> {
  const out = new Map<string, { hitProbability: number | null }>();
  for (const r of rows) out.set(r.key, { hitProbability: r.hitProbability });
  return out;
}

function evalRowToPick(row: EvaluatedGameLine): ParsedPick {
  return {
    ...row.pick,
    finalAiScore: row.finalAiScore,
    scores: row.finalAiScore.rubric,
    highRiskValuePlay: row.finalAiScore.highRiskValuePlay,
  };
}

function finalizedPickFromEvalRow(
  row: EvaluatedGameLine,
  allRows: EvaluatedGameLine[],
  template: ParsedPick,
  realOdds: RealOddsEntry[],
): ParsedPick {
  const breakdown = computeGameLineFinalScoreBreakdown(row);
  const base: ParsedPick = {
    ...template,
    game: row.entry.game,
    market: row.entry.market,
    pick: row.entry.pick,
    odds: row.entry.odds ?? -110,
    sport: row.entry.sport ?? template.sport,
    isProp: false,
    altOptions: undefined,
    finalAiScore: row.finalAiScore,
    scores: row.finalAiScore.rubric,
    highRiskValuePlay: row.finalAiScore.highRiskValuePlay,
  };
  const display = snapshotFrozenGameLineDisplay(base, realOdds);
  return {
    ...base,
    gameLineFrozen: true,
    gameLineFinal: {
      reason: "board ladder",
      finalScore: breakdown.finalScore,
      isBestEv: isBestEvAmongRows(row, allRows),
      frozenAt: Date.now(),
      display,
    },
  };
}

/** Qualified game-line rungs — best per market family per game (spread, total, alt, etc.). */
export function collectQualifiedGameLineCandidates(
  evalLinesByGame: Map<string, RealOddsEntry[]>,
  simByGame: Map<string, CoachGameSimEntry>,
  opts: {
    realOdds: RealOddsEntry[];
    matchupHistory?: Record<string, MatchupHistoryEntry>;
    matchupInjuries?: Record<string, GameInjuryReport>;
    rejectsOut?: ParlayLegReject[];
    longshotAsk?: boolean;
  },
): ParsedPick[] {
  const lineMap = new Map<string, RealOddsEntry>();
  for (const lines of evalLinesByGame.values()) {
    for (const e of lines) lineMap.set(`${e.game}|${e.market}|${e.pick}`, e);
  }
  const byGame = new Map<string, RealOddsEntry[]>();
  for (const e of lineMap.values()) {
    const arr = byGame.get(e.game) ?? [];
    arr.push(e);
    byGame.set(e.game, arr);
  }

  const qualified: ParsedPick[] = [];
  const edgeOpts = { realOdds: opts.realOdds, longshotAsk: opts.longshotAsk };
  for (const [game, lines] of byGame) {
    const sim =
      simByGame.get(game) ??
      [...simByGame.entries()].find(([k]) => k.toLowerCase() === game.toLowerCase())?.[1];
    const merged = mergeOddsEntries(opts.realOdds, lines);
    const ranked = evaluateGameLines({
      lines,
      gameSim: sim,
      realOdds: merged,
      matchupHistory: opts.matchupHistory,
      matchupInjuries: opts.matchupInjuries,
    });
    const template = ranked[0]?.pick ?? {
      game,
      market: lines[0]?.market ?? "Spread",
      pick: lines[0]?.pick ?? "",
      odds: lines[0]?.odds ?? -110,
      isProp: false,
      sport: lines[0]?.sport ?? "mlb",
    };
    const bestPerFamily = new Map<string, EvaluatedGameLine>();
    for (const row of ranked) {
      if (!gameLineRowQualifies(row, ranked)) continue;
      const fam = pickMarketFamily(evalRowToPick(row));
      const cur = bestPerFamily.get(fam);
      if (!cur || row.finalAiScore.composite > cur.finalAiScore.composite) {
        bestPerFamily.set(fam, row);
      }
    }
    if (!bestPerFamily.size) {
      for (const row of ranked) {
        opts.rejectsOut?.push({
          pick: row.pick,
          reason: reasonPickNotQualified(evalRowToPick(row), edgeOpts),
          nearScore: nearScoreFromPick(evalRowToPick(row)),
        });
      }
      continue;
    }
    for (const row of bestPerFamily.values()) {
      const pick = finalizedPickFromEvalRow(row, ranked, template, opts.realOdds);
      if (isFullyQualifiedPick(pick, edgeOpts)) {
        qualified.push(pick);
      } else {
        opts.rejectsOut?.push({
          pick,
          reason: reasonPickNotQualified(pick, edgeOpts),
          nearScore: nearScoreFromPick(pick),
        });
      }
    }
  }
  return qualified.sort((a, b) => comparePickStrength(b, a));
}

/** Qualified prop candidates from the full pool (deep-simmed in batches). */
export async function collectQualifiedPropCandidates(
  propPool: PropPoolEntry[],
  scoreOpts: BoardScoreAttachOpts,
  signal?: AbortSignal,
  rejectsOut?: ParlayLegReject[],
  reachOpts?: { minQualified?: number; maxDeepSim?: number },
): Promise<ParsedPick[]> {
  if (!propPool.length) return [];
  const edgeOpts = {
    realOdds: scoreOpts.realOdds,
    propPool: scoreOpts.propPool ?? propPool,
  };
  const preScored = attachPickScores(
    propPool.map(parsedPickFromPoolEntry),
    scoreOpts,
  );
  const ranked = preScored
    .filter((p) => {
      const edge = resolvePickEdgePct(p, edgeOpts);
      return edge != null && edge > 0;
    })
    .sort((a, b) => comparePickStrength(b, a));

  const minQualified = reachOpts?.minQualified ?? 0;
  const maxDeepSim = Math.min(
    ranked.length,
    reachOpts?.maxDeepSim ?? PROP_SIM_INITIAL_CAP,
  );
  const qualified: ParsedPick[] = [];
  const seenFp = new Set<string>();

  for (let offset = 0; offset < maxDeepSim; offset += PROP_SIM_BATCH_SIZE) {
    if (signal?.aborted) break;
    const batch = ranked.slice(offset, offset + PROP_SIM_BATCH_SIZE);
    if (!batch.length) break;

    let propSimulations: Map<string, { hitProbability: number | null }> | undefined;
    try {
      const rows = await fetchPropSimulations(
        batch,
        scoreOpts.propPool ?? propPool,
        { tier: "deep" },
        signal,
      );
      if (!signal?.aborted) propSimulations = simMapFromPropResults(rows);
    } catch {
      /* batch without sim fails qualification */
    }

    const scored = attachPickScores(batch, { ...scoreOpts, propSimulations }).map((p) => ({
      ...p,
      simulationPending: false,
    }));

    for (const p of scored) {
      if (isFullyQualifiedPick(p, edgeOpts)) {
        const fp = pickLegFingerprint(p);
        if (!seenFp.has(fp)) {
          seenFp.add(fp);
          qualified.push(p);
        }
      } else {
        rejectsOut?.push({
          pick: p,
          reason: reasonPickNotQualified(p, edgeOpts),
          nearScore: nearScoreFromPick(p),
        });
      }
    }

    if (
      minQualified < 12 &&
      qualified.length >= minQualified &&
      qualified.length >= minQualified * 2
    ) {
      break;
    }
  }

  return qualified.sort((a, b) => comparePickStrength(b, a));
}

export type SelectStrongestParlayOpts = {
  evalLinesByGame: Map<string, RealOddsEntry[]>;
  gameSimulations: Map<string, CoachGameSimEntry>;
  propPool: PropPoolEntry[];
  realOdds: RealOddsEntry[];
  scoreOpts: BoardScoreAttachOpts;
  matchupHistory?: Record<string, MatchupHistoryEntry>;
  matchupInjuries?: Record<string, GameInjuryReport>;
  longshotAsk?: boolean;
  maxPerGame?: number;
  varietySeed?: string;
  avoidLegKeys?: Set<string>;
  recentPlayerKeys?: Set<string>;
  playerAppearanceCounts?: Map<string, number>;
  signal?: AbortSignal;
  rejectsOut?: ParlayLegReject[];
};

export type StrongestParlayResult = {
  picks: ParsedPick[];
  longshotPicks: ParsedPick[];
};

/** Longshot / high-risk legs — never on the main ticket. */
export function selectLongshotSectionPicks(
  candidates: ParsedPick[],
  limit: number,
): ParsedPick[] {
  const onMain = new Set<string>();
  return candidates
    .filter((p) => isLongshotSectionPick(p) && !isFullyQualifiedPick(p))
    .sort((a, b) => (b.odds ?? 0) - (a.odds ?? 0))
    .filter((p) => {
      const fp = pickLegFingerprint(p);
      if (onMain.has(fp)) return false;
      onMain.add(fp);
      return true;
    })
    .slice(0, limit);
}

/**
 * Search the entire betting board and return the `target` strongest qualified
 * picks — ranked by edge, sim, confidence, grade, and odds. Keeps scanning props
 * and relaxing diversity caps until the target is met or the board is exhausted.
 */
export async function selectStrongestQualifiedParlay(
  target: number,
  opts: SelectStrongestParlayOpts,
): Promise<StrongestParlayResult> {
  if (target <= 0) return { picks: [], longshotPicks: [] };
  const { maxGameLegs } = reachParlayMix(target);
  const diversityCaps = defaultDiversityCaps(target);
  const reachOpts = {
    maxGameLegs,
    maxPerGame: opts.maxPerGame ?? diversityCaps.maxPerGame,
    varietySeed: opts.varietySeed,
    avoidLegKeys: opts.avoidLegKeys,
    recentPlayerKeys: opts.recentPlayerKeys,
    playerAppearanceCounts: opts.playerAppearanceCounts,
    longshotAsk: opts.longshotAsk,
  };
  const rejects = opts.rejectsOut ?? [];
  const edgeOpts = {
    realOdds: opts.realOdds,
    propPool: opts.propPool,
    longshotAsk: opts.longshotAsk,
  };

  const gameCandidates = collectQualifiedGameLineCandidates(
    opts.evalLinesByGame,
    opts.gameSimulations,
    {
      realOdds: opts.realOdds,
      matchupHistory: opts.matchupHistory,
      matchupInjuries: opts.matchupInjuries,
      rejectsOut: rejects,
      longshotAsk: opts.longshotAsk,
    },
  );

  const propPool =
    opts.avoidLegKeys?.size && opts.propPool.length
      ? deprioritizePropPoolEntries(opts.propPool, opts.avoidLegKeys)
      : opts.propPool;

  let propCandidates = await collectQualifiedPropCandidates(
    propPool,
    { ...opts.scoreOpts, realOdds: opts.realOdds, propPool },
    opts.signal,
    rejects,
    { minQualified: target, maxDeepSim: PROP_SIM_INITIAL_CAP },
  );

  let merged = [...gameCandidates, ...propCandidates]
    .filter((p) => isFullyQualifiedPick(p, edgeOpts))
    .sort((a, b) => comparePickStrength(b, a));

  let picks = reachSelectQualifiedToTarget(merged, target, reachOpts);

  // Deep-sim more prop batches when diversity + game lines are not enough.
  let propCap = PROP_SIM_INITIAL_CAP;
  const deepReach = target >= 12;
  while (
    picks.length < target &&
    (deepReach ? propCap < propPool.length : propCap < PROP_SIM_MAX_CAP) &&
    propCap < (deepReach ? propPool.length : PROP_SIM_MAX_CAP) &&
    !opts.signal?.aborted
  ) {
    propCap = Math.min(
      propCap + PROP_SIM_BATCH_SIZE * 2,
      deepReach ? propPool.length : PROP_SIM_MAX_CAP,
      propPool.length,
    );
    propCandidates = await collectQualifiedPropCandidates(
      propPool,
      { ...opts.scoreOpts, realOdds: opts.realOdds, propPool },
      opts.signal,
      rejects,
      { minQualified: target, maxDeepSim: propCap },
    );
    merged = [...gameCandidates, ...propCandidates]
      .filter((p) => isFullyQualifiedPick(p, edgeOpts))
      .sort((a, b) => comparePickStrength(b, a));
    const next = reachSelectQualifiedToTarget(merged, target, reachOpts);
    if (next.length > picks.length) picks = next;
    if (picks.length >= target) break;
  }

  const longshotPicks =
    opts.longshotAsk && rejects.length
      ? selectLongshotSectionPicks(
          rejects.map((r) => r.pick),
          Math.min(6, target),
        )
      : [];

  return { picks: picks.slice(0, target), longshotPicks };
}

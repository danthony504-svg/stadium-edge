// Scan the entire live board and return the strongest qualified picks.

import type { ParsedPick } from "../components/PickCard.tsx";
import type { PropPoolEntry, RealOddsEntry, MatchupHistoryEntry } from "./api.ts";
import { fetchPropSimulations } from "./api.ts";
import type { GameInjuryReport } from "./injuries.ts";
import { gameLineLegBucket, isGameLinePick, type CoachGameSimEntry } from "./gameSimScoring.ts";
import {
  evaluateGameLines,
  mergeOddsEntries,
  type EvaluatedGameLine,
} from "./gameLineOptimizer.ts";
import { attachPickScores, type PlayerHistorySlice } from "./pickScoreContext.ts";
import { parsedPickFromPoolEntry, type PropSelectionOpts } from "./propSelection.ts";
import { pickLegFingerprint, reachParlayMix, type ParlayLegReject } from "./parlayReachCore.ts";
import type { MarketPerf } from "./marketWeighting.ts";
import {
  isFullyQualifiedGameLineFinalAi,
  isFullyQualifiedPick,
  nearScoreFromPick,
  reasonPickNotQualified,
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

const PROP_SIM_CANDIDATE_CAP = 160;

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

/** Every qualified game-line rung on the eval ladder, best-first. */
export function collectQualifiedGameLineCandidates(
  evalLinesByGame: Map<string, RealOddsEntry[]>,
  simByGame: Map<string, CoachGameSimEntry>,
  opts: {
    realOdds: RealOddsEntry[];
    matchupHistory?: Record<string, MatchupHistoryEntry>;
    matchupInjuries?: Record<string, GameInjuryReport>;
    rejectsOut?: ParlayLegReject[];
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
    for (const row of ranked) {
      if (!isFullyQualifiedGameLineFinalAi(row.finalAiScore, row.pick.odds ?? null)) {
        opts.rejectsOut?.push({
          pick: row.pick,
          reason: reasonPickNotQualified(evalRowToPick(row)),
          nearScore: nearScoreFromPick(evalRowToPick(row)),
        });
        continue;
      }
      qualified.push(evalRowToPick(row));
    }
  }
  return qualified.sort((a, b) => nearScoreFromPick(b) - nearScoreFromPick(a));
}

/** Qualified prop candidates from the full pool (deep-simmed). */
export async function collectQualifiedPropCandidates(
  propPool: PropPoolEntry[],
  scoreOpts: BoardScoreAttachOpts,
  signal?: AbortSignal,
  rejectsOut?: ParlayLegReject[],
): Promise<ParsedPick[]> {
  if (!propPool.length) return [];
  const preScored = attachPickScores(
    propPool.map(parsedPickFromPoolEntry),
    scoreOpts,
  );
  const preRanked = preScored
    .filter((p) => (p.finalAiScore?.composite ?? 0) > 0 && (p.finalAiScore?.edgePct ?? 0) > 0)
    .sort((a, b) => nearScoreFromPick(b) - nearScoreFromPick(a))
    .slice(0, PROP_SIM_CANDIDATE_CAP);

  let propSimulations: Map<string, { hitProbability: number | null }> | undefined;
  try {
    const rows = await fetchPropSimulations(preRanked, scoreOpts.propPool ?? propPool, { tier: "deep" }, signal);
    if (!signal?.aborted) propSimulations = simMapFromPropResults(rows);
  } catch {
    /* props without sim fail qualification */
  }

  const scored = attachPickScores(preRanked, { ...scoreOpts, propSimulations }).map((p) => ({
    ...p,
    simulationPending: false,
  }));

  const qualified: ParsedPick[] = [];
  for (const p of scored) {
    if (isFullyQualifiedPick(p)) qualified.push(p);
    else
      rejectsOut?.push({
        pick: p,
        reason: reasonPickNotQualified(p),
        nearScore: nearScoreFromPick(p),
      });
  }
  return qualified.sort((a, b) => nearScoreFromPick(b) - nearScoreFromPick(a));
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
  signal?: AbortSignal;
  rejectsOut?: ParlayLegReject[];
};

function canAddCandidate(
  pick: ParsedPick,
  state: {
    legSeen: Set<string>;
    bucketSeen: Set<string>;
    perGame: Map<string, number>;
    gameLegs: number;
    maxGameLegs: number;
    maxPerGame: number;
  },
): boolean {
  const fp = pickLegFingerprint(pick);
  if (state.legSeen.has(fp)) return false;
  const gameKey = pick.game.toLowerCase();
  if ((state.perGame.get(gameKey) ?? 0) >= state.maxPerGame) return false;
  if (!pick.isProp && isGameLinePick(pick)) {
    if (state.gameLegs >= state.maxGameLegs) return false;
    const bucket = gameLineLegBucket(pick.game, pick.market, pick.pick);
    if (state.bucketSeen.has(bucket)) return false;
  }
  return true;
}

function addCandidate(
  pick: ParsedPick,
  state: {
    legSeen: Set<string>;
    bucketSeen: Set<string>;
    perGame: Map<string, number>;
    gameLegs: number;
  },
  out: ParsedPick[],
): void {
  const fp = pickLegFingerprint(pick);
  state.legSeen.add(fp);
  const gameKey = pick.game.toLowerCase();
  state.perGame.set(gameKey, (state.perGame.get(gameKey) ?? 0) + 1);
  if (!pick.isProp && isGameLinePick(pick)) {
    state.gameLegs += 1;
    state.bucketSeen.add(gameLineLegBucket(pick.game, pick.market, pick.pick));
  }
  out.push(pick);
}

/** Greedy diversity-aware selection from a strength-sorted candidate pool. */
export function selectDiverseStrongest(
  candidates: ParsedPick[],
  target: number,
  opts?: { maxGameLegs?: number; minProps?: number; maxPerGame?: number },
): ParsedPick[] {
  const { maxGameLegs = Math.ceil(target * 0.5), minProps = Math.floor(target * 0.35) } =
    opts ?? {};
  const maxPerGame = opts?.maxPerGame ?? (target >= 12 ? 4 : 2);
  const sorted = [...candidates].sort((a, b) => nearScoreFromPick(b) - nearScoreFromPick(a));
  const out: ParsedPick[] = [];
  const state = {
    legSeen: new Set<string>(),
    bucketSeen: new Set<string>(),
    perGame: new Map<string, number>(),
    gameLegs: 0,
    maxGameLegs,
    maxPerGame,
  };

  let propLegs = 0;
  for (const p of sorted) {
    if (propLegs >= minProps) break;
    if (!p.isProp) continue;
    if (!canAddCandidate(p, state)) continue;
    addCandidate(p, state, out);
    propLegs += 1;
  }

  for (const p of sorted) {
    if (out.length >= target) break;
    if (!canAddCandidate(p, state)) continue;
    addCandidate(p, state, out);
  }

  if (out.length < target) {
    for (const p of sorted) {
      if (out.length >= target) break;
      if (state.legSeen.has(pickLegFingerprint(p))) continue;
      out.push(p);
    }
  }

  return out.slice(0, target);
}

/**
 * Search the entire betting board and return the `target` strongest qualified
 * picks — not the first N that pass filters.
 */
export async function selectStrongestQualifiedParlay(
  target: number,
  opts: SelectStrongestParlayOpts,
): Promise<ParsedPick[]> {
  if (target <= 0) return [];
  const { minProps, maxGameLegs } = reachParlayMix(target);
  const rejects = opts.rejectsOut ?? [];

  const gameCandidates = collectQualifiedGameLineCandidates(
    opts.evalLinesByGame,
    opts.gameSimulations,
    {
      realOdds: opts.realOdds,
      matchupHistory: opts.matchupHistory,
      matchupInjuries: opts.matchupInjuries,
      rejectsOut: rejects,
    },
  );

  const propCandidates = await collectQualifiedPropCandidates(
    opts.propPool,
    { ...opts.scoreOpts, realOdds: opts.realOdds, propPool: opts.propPool },
    opts.signal,
    rejects,
  );

  const merged = [...gameCandidates, ...propCandidates].sort(
    (a, b) => nearScoreFromPick(b) - nearScoreFromPick(a),
  );

  return selectDiverseStrongest(merged, target, {
    maxGameLegs,
    minProps: opts.longshotAsk ? Math.max(minProps, Math.floor(target * 0.5)) : minProps,
    maxPerGame: opts.maxPerGame ?? (target >= 12 ? 4 : 2),
  });
}

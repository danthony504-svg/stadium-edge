// Scan the entire live board and return the strongest qualified picks.

import type { ParsedPick } from "../components/PickCard.tsx";
import type { PropPoolEntry, RealOddsEntry, MatchupHistoryEntry } from "./api.ts";
import { fetchPropSimulations } from "./api.ts";
import type { GameInjuryReport } from "./injuries.ts";
import type { CoachGameSimEntry } from "./gameSimScoring.ts";
import {
  evaluateGameLines,
  mergeOddsEntries,
  filterEvaluatedForCloseGameSpread,
  type EvaluatedGameLine,
} from "./gameLineOptimizer.ts";
import { reachSelectQualifiedToTarget } from "./parlaySelectReach.ts";
import { attachPickScores, type PlayerHistorySlice } from "./pickScoreContext.ts";
import { parsedPickFromPoolEntry, type PropSelectionOpts } from "./propSelection.ts";
import { pickLegFingerprint, reachParlayMix, type ParlayLegReject } from "./parlayReachCore.ts";
import type { MarketPerf } from "./marketWeighting.ts";
import {
  comparePickStrength,
  isFullyQualifiedPick,
  isLongshotMainTicketQualified,
  isLongshotSectionPick,
  isMainTicketQualified,
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

/** Every qualified game-line rung on the eval ladder, best-first. */
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
    const spreadFiltered = filterEvaluatedForCloseGameSpread(ranked, sim, lines, {
      longshotAsk: opts.longshotAsk,
    });
    for (const row of spreadFiltered) {
      const pick = evalRowToPick(row);
      const passes = opts.longshotAsk
        ? isLongshotMainTicketQualified(row.finalAiScore, row.pick.odds ?? null)
        : isMainTicketQualified(row.finalAiScore, row.pick.odds ?? null);
      if (!passes) {
        opts.rejectsOut?.push({
          pick: row.pick,
          reason: reasonPickNotQualified(pick, { longshotAsk: opts.longshotAsk }),
          nearScore: nearScoreFromPick(pick),
        });
        continue;
      }
      qualified.push(pick);
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

    if (qualified.length >= minQualified && qualified.length >= minQualified * 2) break;
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

  let propCandidates = await collectQualifiedPropCandidates(
    opts.propPool,
    { ...opts.scoreOpts, realOdds: opts.realOdds, propPool: opts.propPool },
    opts.signal,
    rejects,
    { minQualified: target, maxDeepSim: PROP_SIM_INITIAL_CAP },
  );

  let merged = [...gameCandidates, ...propCandidates]
    .filter((p) => isFullyQualifiedPick(p, edgeOpts))
    .sort((a, b) => comparePickStrength(b, a));

  let picks = reachSelectQualifiedToTarget(merged, target, {
    maxGameLegs,
    maxPerGame: opts.maxPerGame ?? (target >= 12 ? 4 : 2),
  });

  // Deep-sim more prop batches when diversity + game lines are not enough.
  let propCap = PROP_SIM_INITIAL_CAP;
  while (
    picks.length < target &&
    propCap < PROP_SIM_MAX_CAP &&
    propCap < opts.propPool.length &&
    !opts.signal?.aborted
  ) {
    propCap = Math.min(propCap + PROP_SIM_BATCH_SIZE * 2, PROP_SIM_MAX_CAP, opts.propPool.length);
    propCandidates = await collectQualifiedPropCandidates(
      opts.propPool,
      { ...opts.scoreOpts, realOdds: opts.realOdds, propPool: opts.propPool },
      opts.signal,
      rejects,
      { minQualified: target, maxDeepSim: propCap },
    );
    merged = [...gameCandidates, ...propCandidates]
      .filter((p) => isFullyQualifiedPick(p, edgeOpts))
      .sort((a, b) => comparePickStrength(b, a));
    const next = reachSelectQualifiedToTarget(merged, target, {
      maxGameLegs,
      maxPerGame: opts.maxPerGame ?? (target >= 12 ? 4 : 2),
    });
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

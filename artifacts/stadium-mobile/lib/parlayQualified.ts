// Strict qualification gate — AI Coach only recommends picks with complete scores.

import type { ParsedPick } from "../components/PickCard.tsx";
import { attachPickScores, type PlayerHistorySlice } from "./pickScoreContext.ts";
import type { PropPoolEntry, RealOddsEntry, MatchupHistoryEntry } from "./api.ts";
import { fetchPropSimulations } from "./api.ts";
import type { GameInjuryReport } from "./injuries.ts";
import type { CoachGameSimEntry } from "./gameSimScoring.ts";
import { replenishParlayToTarget, type ReplenishParlayOpts } from "./parlayReach.ts";
import { pickLegFingerprint, type ParlayLegReject } from "./parlayReachCore.ts";
import type { PropSelectionOpts } from "./propSelection.ts";
import type { MarketPerf } from "./marketWeighting.ts";
import {
  isFullyQualifiedPick,
  nearScoreFromPick,
  partitionQualifiedPicks,
  reasonPickNotQualified,
} from "./parlayQualifiedGate.ts";

export {
  isGameLineMainTicketQualified,
  isPropMainTicketQualified,
  isMainTicketQualified,
  isLongshotMainTicketQualified,
  GAME_LINE_SIM_MIN_HIT,
  GAME_LINE_EXCEPTIONAL_EV_PCT,
  LONGSHOT_SIM_MIN_HIT,
  MIN_MAIN_PICK_GRADE,
  MIN_MAIN_PICK_CONFIDENCE,
  isFullyQualifiedPropFinalAi,
  isFullyQualifiedGameLineFinalAi,
  isFullyQualifiedFinalAi,
  isFullyQualifiedPick,
  isLongshotSectionPick,
  comparePickStrength,
  reasonPickNotQualified,
  partitionQualifiedPicks,
  resolvePickEdgePct,
  resolvePickExpectedValue,
  filterMainTicketPicks,
} from "./parlayQualifiedGate.ts";

export { computePickFinalScore, GAME_LINE_FINAL_SCORE_WEIGHTS } from "./gameLineFinalScore.ts";

export type PickScoreAttachOpts = {
  realOdds?: RealOddsEntry[];
  propPool?: PropPoolEntry[];
  matchupHistory?: Record<string, MatchupHistoryEntry>;
  matchupInjuries?: Record<string, GameInjuryReport>;
  perfByFamily?: Map<string, MarketPerf>;
  playerHistory?: Record<string, PlayerHistorySlice>;
  gameSimulations?: Map<string, CoachGameSimEntry>;
};

function simMapFromPropResults(
  rows: Iterable<{ key: string; hitProbability: number | null }>,
): Map<string, { hitProbability: number | null }> {
  const out = new Map<string, { hitProbability: number | null }>();
  for (const r of rows) out.set(r.key, { hitProbability: r.hitProbability });
  return out;
}

/** Score every leg with game + deep prop sim before qualification checks. */
export async function scorePicksForQualification(
  picks: ParsedPick[],
  opts: PickScoreAttachOpts,
  signal?: AbortSignal,
): Promise<ParsedPick[]> {
  let propSimulations: Map<string, { hitProbability: number | null }> | undefined;
  if (picks.some((p) => p.isProp)) {
    try {
      const rows = await fetchPropSimulations(
        picks,
        opts.propPool ?? [],
        { tier: "deep" },
        signal,
      );
      if (signal?.aborted) return picks;
      propSimulations = simMapFromPropResults(rows);
    } catch {
      /* leave prop sim absent — pick will fail qualification */
    }
  }
  return attachPickScores(picks, { ...opts, propSimulations }).map((p) =>
    p.isProp ? { ...p, simulationPending: false } : p,
  );
}

const MAX_REPLENISH_ROUNDS = 14;

export type EnsureQualifiedParlayOpts = ReplenishParlayOpts & {
  scoreOpts: PickScoreAttachOpts;
  signal?: AbortSignal;
  rejectsOut?: ParlayLegReject[];
  selectionOpts?: PropSelectionOpts;
};

/**
 * Drop unqualified legs and keep searching the full board until `target`
 * qualified picks are found or every market family is exhausted.
 */
export async function ensureQualifiedParlayToTarget(
  picks: ParsedPick[],
  target: number,
  opts: EnsureQualifiedParlayOpts,
): Promise<ParsedPick[]> {
  if (target <= 0) {
    const edgeOpts = {
      realOdds: opts.scoreOpts.realOdds,
      propPool: opts.scoreOpts.propPool,
    };
    return picks.filter((p) => isFullyQualifiedPick(p, edgeOpts));
  }
  const rejects = opts.rejectsOut ?? [];
  const edgeOpts = {
    realOdds: opts.scoreOpts.realOdds,
    propPool: opts.scoreOpts.propPool,
  };
  const triedLegs = new Set<string>();
  let out = [...picks];

  for (let round = 0; round < MAX_REPLENISH_ROUNDS; round++) {
    if (opts.signal?.aborted) break;
    out = await scorePicksForQualification(out, opts.scoreOpts, opts.signal);

    const { qualified, unqualified } = partitionQualifiedPicks(out, edgeOpts);
    for (const p of unqualified) {
      const fp = pickLegFingerprint(p);
      if (triedLegs.has(fp)) continue;
      triedLegs.add(fp);
      rejects.push({
        pick: p,
        reason: reasonPickNotQualified(p, edgeOpts),
        nearScore: nearScoreFromPick(p),
      });
    }
    out = qualified;

    if (out.length >= target) return out.slice(0, target);

    const before = out.length;
    out = replenishParlayToTarget(out, target, opts);
    const added = out.filter((p) => !qualified.some((q) => pickLegFingerprint(q) === pickLegFingerprint(p)));
    if (!added.length && out.length === before) break;
  }

  out = await scorePicksForQualification(out, opts.scoreOpts, opts.signal);
  return out.filter((p) => isFullyQualifiedPick(p, edgeOpts)).slice(0, target);
}

/** Filter-only pass when replenishment is not requested. */
export async function filterToQualifiedPicks(
  picks: ParsedPick[],
  opts: PickScoreAttachOpts,
  rejectsOut?: ParlayLegReject[],
  signal?: AbortSignal,
): Promise<ParsedPick[]> {
  const edgeOpts = { realOdds: opts.realOdds, propPool: opts.propPool };
  const scored = await scorePicksForQualification(picks, opts, signal);
  const { qualified, unqualified } = partitionQualifiedPicks(scored, edgeOpts);
  if (rejectsOut) {
    for (const p of unqualified) {
      rejectsOut.push({
        pick: p,
        reason: reasonPickNotQualified(p, edgeOpts),
        nearScore: nearScoreFromPick(p),
      });
    }
  }
  return qualified;
}

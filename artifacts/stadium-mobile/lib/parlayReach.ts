// Reach explicit N-leg parlay targets across the full live board before trimming.

import type { ParsedPick } from "../components/PickCard.tsx";
import {
  backfillPicks,
  backfillProps,
  FULL_REACH_GAME_ORDER,
} from "../components/PickCard.tsx";
import type { GameMeta, PropPoolEntry, RealOddsEntry } from "./api.ts";
import {
  backfillGameLinesFromEvalScores,
  evaluateGameLines,
  mergeOddsEntries,
  type EvaluatedGameLine,
} from "./gameLineOptimizer.ts";
import type { CoachGameSimEntry } from "./gameSimScoring.ts";
import { classifySimAlignment } from "./finalAiScore.ts";
import { isMainTicketQualified, reasonPickNotQualified } from "./parlayQualifiedGate.ts";
import { dedupeSameTeamGameLegs, topUpDeepParlayToTarget } from "./ticketDiversity.ts";
import type { PropSelectionOpts } from "./propSelection.ts";
import {
  pickLegFingerprint,
  reachParlayMix,
  type ParlayLegReject,
} from "./parlayReachCore.ts";

export type { ParlayLegReject } from "./parlayReachCore.ts";
export {
  pickLegFingerprint,
  reachParlayMix,
  mergeParlayRejects,
  selectParlayBackupPicks,
  buildParlayShortfallNote,
} from "./parlayReachCore.ts";

function nearScoreFromEval(row: EvaluatedGameLine): number {
  const sim = row.finalAiScore.simHit ?? 0;
  const edge = row.edgePct ?? row.finalAiScore.edgePct ?? 0;
  const composite = row.finalAiScore.composite ?? 0;
  return composite * 0.5 + sim * 40 + Math.max(0, edge) * 2;
}

function reasonForEvalReject(row: EvaluatedGameLine): string {
  const pick = {
    ...row.pick,
    finalAiScore: row.finalAiScore,
    scores: row.finalAiScore.rubric,
  };
  return reasonPickNotQualified(pick);
}

/** Rank eval-ladder rungs that almost made the ticket (not already on it). */
export function collectNearMissGameLines(
  ticket: ParsedPick[],
  evalLinesByGame: Map<string, RealOddsEntry[]>,
  simByGame: Map<string, CoachGameSimEntry>,
  opts: {
    realOdds: RealOddsEntry[];
    matchupHistory?: Record<string, import("./api.ts").MatchupHistoryEntry>;
    matchupInjuries?: Record<string, import("./injuries.ts").GameInjuryReport>;
  },
): ParlayLegReject[] {
  const onTicket = new Set(ticket.map(pickLegFingerprint));
  const rejects: ParlayLegReject[] = [];
  const byGame = new Map<string, RealOddsEntry[]>();
  for (const lines of evalLinesByGame.values()) {
    for (const e of lines) {
      const arr = byGame.get(e.game) ?? [];
      arr.push(e);
      byGame.set(e.game, arr);
    }
  }
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
      const fp = pickLegFingerprint(row.pick);
      if (onTicket.has(fp)) continue;
      if (isMainTicketQualified(row.finalAiScore, row.pick.odds ?? null)) continue;
      rejects.push({
        pick: row.pick,
        reason: reasonForEvalReject(row),
        nearScore: nearScoreFromEval(row),
      });
    }
  }
  return rejects;
}

export type ReplenishParlayOpts = {
  longshotAsk?: boolean;
  plusMoneyBias?: boolean;
  diversify?: boolean;
  varietySeed?: string;
  avoidLegKeys?: Set<string>;
  selectionOpts?: PropSelectionOpts;
  propPool: PropPoolEntry[];
  realOdds: RealOddsEntry[];
  mergedGameOdds: RealOddsEntry[];
  gameMeta: GameMeta[];
  evalLinesByGame?: Map<string, RealOddsEntry[]> | null;
  gameSimulations?: Map<string, CoachGameSimEntry>;
  matchupHistory?: Record<string, import("./api.ts").MatchupHistoryEntry>;
  matchupInjuries?: Record<string, import("./injuries.ts").GameInjuryReport>;
};

/** Expand search across the full board before accepting a short ticket. */
export function replenishParlayToTarget(
  picks: ParsedPick[],
  target: number,
  opts: ReplenishParlayOpts,
): ParsedPick[] {
  if (picks.length >= target) return picks;
  const { maxGameLegs } = reachParlayMix(target);
  const boardOpts = {
    longshotAsk: opts.longshotAsk,
    plusMoneyBias: opts.plusMoneyBias,
    diversify: opts.diversify ?? true,
    varietySeed: opts.varietySeed,
    avoidLegKeys: opts.avoidLegKeys,
    selectionOpts: opts.selectionOpts,
    reachFull: true,
  };
  const propOpts = {
    target,
    plusMoneyBias: opts.plusMoneyBias ?? !!opts.longshotAsk,
    diversify: opts.diversify ?? true,
    varietySeed: opts.varietySeed,
    avoidLegKeys: opts.avoidLegKeys,
    selectionOpts: opts.selectionOpts,
    maxPerGame: target >= 12 ? 4 : undefined,
    maxPerMarket: target >= 12 ? 4 : undefined,
  };

  let out = dedupeSameTeamGameLegs(picks).picks;
  out = topUpDeepParlayToTarget(
    out,
    target,
    opts.propPool,
    opts.mergedGameOdds.length ? opts.mergedGameOdds : opts.realOdds,
    opts.gameMeta,
    boardOpts,
  );

  if (opts.evalLinesByGame && opts.gameSimulations && out.length < target) {
    out = backfillGameLinesFromEvalScores(
      out,
      target,
      opts.evalLinesByGame,
      opts.gameSimulations,
      {
        realOdds: opts.mergedGameOdds,
        matchupHistory: opts.matchupHistory,
        matchupInjuries: opts.matchupInjuries,
        maxGameLegs,
      },
    );
  }

  const pool = opts.mergedGameOdds.length ? opts.mergedGameOdds : opts.realOdds;
  if (out.length < target) {
    out = backfillPicks(out, pool, opts.gameMeta, {
      target,
      order: FULL_REACH_GAME_ORDER,
    });
  }
  if (out.length < target) {
    out = backfillProps(out, opts.propPool, pool, opts.gameMeta, propOpts);
  }
  if (out.length < target) {
    out = backfillPicks(out, pool, opts.gameMeta, { target, order: FULL_REACH_GAME_ORDER });
  }

  return dedupeSameTeamGameLegs(out).picks;
}

export function rejectFromSimDrop(
  pick: ParsedPick,
  hit: number | null,
  edge: number | null,
): ParlayLegReject {
  const { simAligned, highRiskValuePlay } = classifySimAlignment(hit, edge);
  let reason: string;
  if (!simAligned && !highRiskValuePlay) {
    const pct = hit != null ? Math.round(hit * 100) : 0;
    reason = `10k sim ${pct}% hit — needs ≥52% or +8% edge`;
  } else if (edge != null && edge < 0) {
    reason = `${edge}% edge`;
  } else {
    reason = "sim / edge filter";
  }
  const near = (hit ?? 0) * 50 + Math.max(0, edge ?? 0) * 3 + (simAligned ? 10 : 0);
  return { pick, reason, nearScore: near };
}

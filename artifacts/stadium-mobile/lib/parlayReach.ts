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
import { qualifiesCoachSimEvalLine, deriveGameSimLineMetrics } from "./gameSimQualityGates.ts";
import { qualifiesAltPick, qualifiesReachBoardPick, pickIsAiRecommended } from "./pickRecommendation.ts";
import { parsedPickFromPoolEntry } from "./propSelection.ts";
import { isAltPropPick, isMainLineGameLeg, isQualifyingBackupGameLine } from "./altLinePool.ts";
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
  buildQualifyingAltShortfallNote,
  buildFullBoardShortfallNote,
  promoteQualifyingAltsToTicket,
  promoteQualifyingStagedToTicket,
  selectParlayMainBackupPicks,
} from "./parlayReachCore.ts";

function nearScoreFromEval(row: EvaluatedGameLine): number {
  const sim = row.finalAiScore.simHit ?? 0;
  const edge = row.edgePct ?? row.finalAiScore.edgePct ?? 0;
  const composite = row.finalAiScore.composite ?? 0;
  return composite * 0.5 + sim * 40 + Math.max(0, edge) * 2;
}

function reasonForEvalReject(row: EvaluatedGameLine): string {
  const hit = row.finalAiScore.simHit;
  const edge = row.edgePct ?? row.finalAiScore.edgePct;
  if (!row.finalAiScore.simAligned && !row.finalAiScore.highRiskValuePlay) {
    const pct = hit != null ? Math.round(hit * 100) : 0;
    return `10k sim ${pct}% hit — needs ≥52% cover or +8% edge for a High-Risk Value Play`;
  }
  if ((edge ?? 0) < 0 && !row.finalAiScore.highRiskValuePlay) {
    return `${edge}% edge after Final AI Score`;
  }
  return "quality bar not met";
}

function qualifyScoreFromEval(row: EvaluatedGameLine): number {
  const sim = row.finalAiScore.simHit ?? 0;
  const edge = row.edgePct ?? row.finalAiScore.edgePct ?? 0;
  const composite = row.finalAiScore.composite ?? 0;
  const m = deriveGameSimLineMetrics(row);
  const evBoost = m?.evPct ?? 0;
  const altBoost = /\balt\b/i.test(row.entry.market) ? 8 : 0;
  const nonMlBoost = /^moneyline$/i.test(row.entry.market.trim()) ? 0 : 4;
  return composite * 0.5 + sim * 40 + Math.max(0, edge) * 2 + evBoost * 0.5 + altBoost + nonMlBoost;
}

function reasonForQualifyingLine(row: EvaluatedGameLine): string {
  const m = deriveGameSimLineMetrics(row);
  if (!m) return "10k sim graded";
  const hit = Math.round(m.simHit * 100);
  const edgeStr = m.edgePct >= 0 ? `+${m.edgePct.toFixed(1)}` : m.edgePct.toFixed(1);
  return `${edgeStr}% edge · ${hit}% sim hit · grade ${m.grade}`;
}

/** Every eval-ladder rung that passes 10k sim quality filters (not already on ticket). */
export function collectQualifyingGameLines(
  ticket: ParsedPick[],
  evalLinesByGame: Map<string, RealOddsEntry[]>,
  simByGame: Map<string, CoachGameSimEntry>,
  opts: {
    realOdds: RealOddsEntry[];
    matchupHistory?: Record<string, import("./api.ts").MatchupHistoryEntry>;
    matchupInjuries?: Record<string, import("./injuries.ts").GameInjuryReport>;
    excludedSports?: Set<string>;
  },
): ParlayLegReject[] {
  const onTicket = new Set(ticket.map(pickLegFingerprint));
  const qualified: ParlayLegReject[] = [];
  const byGame = new Map<string, RealOddsEntry[]>();
  for (const lines of evalLinesByGame.values()) {
    for (const e of lines) {
      if (opts.excludedSports?.size && e.sport && opts.excludedSports.has(e.sport)) continue;
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
      if (!isQualifyingBackupGameLine(row.pick)) continue;
      if (opts.excludedSports?.size && row.pick.sport && opts.excludedSports.has(row.pick.sport)) {
        continue;
      }
      if (!qualifiesAltPick(row.pick, row.finalAiScore) && !qualifiesReachBoardPick(row.pick, row.finalAiScore)) {
        continue;
      }
      qualified.push({
        pick: row.pick,
        reason: reasonForQualifyingLine(row),
        nearScore: qualifyScoreFromEval(row),
      });
    }
  }
  return qualified.sort((a, b) => b.nearScore - a.nearScore);
}

/** Main game lines (ML/spread/total) that pass the strict AI gate — not already on ticket. */
export function collectQualifyingMainGameLines(
  ticket: ParsedPick[],
  evalLinesByGame: Map<string, RealOddsEntry[]>,
  simByGame: Map<string, CoachGameSimEntry>,
  opts: {
    realOdds: RealOddsEntry[];
    matchupHistory?: Record<string, import("./api.ts").MatchupHistoryEntry>;
    matchupInjuries?: Record<string, import("./injuries.ts").GameInjuryReport>;
    excludedSports?: Set<string>;
  },
): ParlayLegReject[] {
  const onTicket = new Set(ticket.map(pickLegFingerprint));
  const qualified: ParlayLegReject[] = [];
  const byGame = new Map<string, RealOddsEntry[]>();
  for (const lines of evalLinesByGame.values()) {
    for (const e of lines) {
      if (opts.excludedSports?.size && e.sport && opts.excludedSports.has(e.sport)) continue;
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
      if (!isMainLineGameLeg(row.pick)) continue;
      if (opts.excludedSports?.size && row.pick.sport && opts.excludedSports.has(row.pick.sport)) {
        continue;
      }
      if (!pickIsAiRecommended(row.pick, row.finalAiScore)) continue;
      qualified.push({
        pick: row.pick,
        reason: reasonForQualifyingLine(row),
        nearScore: qualifyScoreFromEval(row),
      });
    }
  }
  return qualified.sort((a, b) => b.nearScore - a.nearScore);
}

/** Main (non-alt) props that pass the strict AI gate — not already on ticket. */
export function collectQualifyingMainProps(
  ticket: ParsedPick[],
  propPool: PropPoolEntry[],
  scoredMainProps: ParsedPick[],
): ParlayLegReject[] {
  const onTicket = new Set(ticket.map(pickLegFingerprint));
  const qualified: ParlayLegReject[] = [];
  const scoredByFp = new Map(scoredMainProps.map((p) => [pickLegFingerprint(p), p]));
  for (const entry of propPool) {
    if (entry.alt) continue;
    const scored = scoredByFp.get(pickLegFingerprint(parsedPickFromPoolEntry(entry)));
    if (!scored) continue;
    const fp = pickLegFingerprint(scored);
    if (onTicket.has(fp)) continue;
    if (isAltPropPick(scored)) continue;
    if (!pickIsAiRecommended(scored, scored.finalAiScore)) continue;
    qualified.push({
      pick: scored,
      reason: reasonForQualifyingAltProp(scored),
      nearScore:
        (scored.finalAiScore?.composite ?? 0) * 0.5 +
        (scored.finalAiScore?.simHit ?? 0) * 40 +
        Math.max(0, scored.finalAiScore?.edgePct ?? 0) * 2,
    });
  }
  return qualified.sort((a, b) => b.nearScore - a.nearScore);
}

/** Alt-ladder prop rows that pass the softer reach-N alt gate. */
export function collectQualifyingAltProps(
  ticket: ParsedPick[],
  propPool: PropPoolEntry[],
  scoredAltProps: ParsedPick[],
): ParlayLegReject[] {
  const onTicket = new Set(ticket.map(pickLegFingerprint));
  const qualified: ParlayLegReject[] = [];
  const scoredByFp = new Map(scoredAltProps.map((p) => [pickLegFingerprint(p), p]));
  for (const entry of propPool) {
    if (!entry.alt) continue;
    const scored = scoredByFp.get(
      pickLegFingerprint(parsedPickFromPoolEntry(entry)),
    );
    if (!scored) continue;
    const fp = pickLegFingerprint(scored);
    if (onTicket.has(fp)) continue;
    if (!isAltPropPick(scored)) continue;
    if (
      !qualifiesAltPick(scored, scored.finalAiScore) &&
      !qualifiesReachBoardPick(scored, scored.finalAiScore)
    ) {
      continue;
    }
    qualified.push({
      pick: scored,
      reason: reasonForQualifyingAltProp(scored),
      nearScore:
        (scored.finalAiScore?.composite ?? 0) * 0.5 +
        (scored.finalAiScore?.simHit ?? 0) * 40 +
        Math.max(0, scored.finalAiScore?.edgePct ?? 0) * 2,
    });
  }
  return qualified.sort((a, b) => b.nearScore - a.nearScore);
}

function reasonForQualifyingAltProp(pick: ParsedPick): string {
  const edge = pick.finalAiScore?.edgePct;
  const hit = pick.finalAiScore?.simHit;
  const grade = pick.finalAiScore?.grade ?? "?";
  const edgeStr =
    edge == null ? "?" : edge >= 0 ? `+${edge.toFixed(1)}` : edge.toFixed(1);
  const hitStr = hit != null ? `${Math.round(hit * 100)}%` : "?";
  return `${edgeStr}% edge · ${hitStr} sim hit · grade ${grade}`;
}

/** Promote qualifying alt game lines + alt props onto the main ticket. */
export function fillReachTicketWithQualifyingAlts(
  ticket: ParsedPick[],
  target: number,
  qualifying: ParlayLegReject[],
): { picks: ParsedPick[]; promoted: ParsedPick[] } {
  return promoteQualifyingAltsToTicket(ticket, qualifying, target);
}

/** Mains first, then qualifying alts — staged reach-N fill from the live board. */
export function fillReachTicketStaged(
  ticket: ParsedPick[],
  target: number,
  qualifyingMains: ParlayLegReject[],
  qualifyingAlts: ParlayLegReject[],
): { picks: ParsedPick[]; promotedMains: ParsedPick[]; promotedAlts: ParsedPick[] } {
  return promoteQualifyingStagedToTicket(ticket, qualifyingMains, qualifyingAlts, target);
}

/** Collect mains + alts from eval lines and prop pool for staged reach fill. */
export function collectReachStagedQualifiers(
  ticket: ParsedPick[],
  evalLinesByGame: Map<string, RealOddsEntry[]>,
  simByGame: Map<string, CoachGameSimEntry>,
  propPool: PropPoolEntry[],
  scoredMainProps: ParsedPick[],
  scoredAltProps: ParsedPick[],
  opts: {
    realOdds: RealOddsEntry[];
    matchupHistory?: Record<string, import("./api.ts").MatchupHistoryEntry>;
    matchupInjuries?: Record<string, import("./injuries.ts").GameInjuryReport>;
    excludedSports?: Set<string>;
  },
): { mains: ParlayLegReject[]; alts: ParlayLegReject[] } {
  const reachOpts = {
    realOdds: opts.realOdds,
    matchupHistory: opts.matchupHistory,
    matchupInjuries: opts.matchupInjuries,
    excludedSports: opts.excludedSports,
  };
  return {
    mains: mergeParlayRejects(
      collectQualifyingMainGameLines(ticket, evalLinesByGame, simByGame, reachOpts),
      collectQualifyingMainProps(ticket, propPool, scoredMainProps),
    ),
    alts: mergeParlayRejects(
      collectQualifyingGameLines(ticket, evalLinesByGame, simByGame, reachOpts),
      collectQualifyingAltProps(ticket, propPool, scoredAltProps),
    ),
  };
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
      if (row.finalAiScore.simAligned || row.finalAiScore.highRiskValuePlay) {
        if ((row.edgePct ?? 0) >= 0 || row.finalAiScore.highRiskValuePlay) continue;
      }
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

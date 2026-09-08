/**
 * Bounded fast Coach correlation — greedy candidate generation, pairwise scoring
 * on completed tickets only. Never blocks the UI; always finishes within 3s.
 */

import type { ParsedPick } from "../components/PickCard.tsx";
import { compareBoardLegsForRank } from "./coachBoardRankVariety.ts";
import { parlayCorrelationPenalty } from "./parlayCorrelationScore.ts";
import { pickLegFingerprint } from "./parlayReachCore.ts";
import {
  boardLegPoolRole,
  tagTicketRoles,
  type BoardScoredLeg,
} from "./ticketStaging.ts";

export const FAST_CORRELATION_MAX_CANDIDATES = 30;
export const FAST_CORRELATION_HIGH_QUALITY_STOP = 10;
export const FAST_CORRELATION_SEARCH_MS = 2_000;
export const FAST_CORRELATION_HARD_MS = 3_000;
export const FAST_CORRELATION_POOL_CAP = 48;

export type FastCorrelationResult = {
  picks: ParsedPick[];
  candidateCount: number;
  ticketsScored: number;
  highQualityFound: number;
  durationMs: number;
  usedFallback: boolean;
  timedOut: boolean;
};

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function filterQualifying(scored: BoardScoredLeg[]): BoardScoredLeg[] {
  return scored.filter((leg) => boardLegPoolRole(leg.pick, leg.pick.finalAiScore) != null);
}

function slicePoolForCorrelation(qualifying: BoardScoredLeg[], target: number): BoardScoredLeg[] {
  const cap = Math.max(FAST_CORRELATION_POOL_CAP, target * 10);
  if (qualifying.length <= cap) return qualifying;
  const sorted = [...qualifying].sort((a, b) => b.rankScore - a.rankScore);
  return sorted.slice(0, cap);
}

/** Fast greedy ticket — no pairwise work during assembly. */
export function buildGreedyCandidateTicket(
  qualifying: BoardScoredLeg[],
  target: number,
  variant: number,
  varietySeed?: string,
): ParsedPick[] {
  if (!qualifying.length || target <= 0) return [];
  const sorted = [...qualifying].sort((a, b) => compareBoardLegsForRank(a, b, varietySeed));
  const shift = sorted.length ? variant % sorted.length : 0;
  const rotated = [...sorted.slice(shift), ...sorted.slice(0, shift)];

  const out: ParsedPick[] = [];
  const seen = new Set<string>();
  for (const row of rotated) {
    const fp = pickLegFingerprint(row.pick);
    if (seen.has(fp)) continue;
    seen.add(fp);
    out.push(row.pick);
    if (out.length >= target) break;
  }
  return out.slice(0, target);
}

/** Pairwise correlation penalty — only on a completed candidate ticket. */
export function ticketPairwiseCorrelationPenalty(picks: ParsedPick[]): number {
  let penalty = 0;
  for (let i = 1; i < picks.length; i++) {
    penalty += parlayCorrelationPenalty(picks[i]!, picks.slice(0, i));
  }
  return penalty;
}

function ticketQualityScore(picks: ParsedPick[], qualifying: BoardScoredLeg[]): number {
  const byFp = new Map(qualifying.map((row) => [pickLegFingerprint(row.pick), row]));
  let score = 0;
  for (const pick of picks) {
    const row = byFp.get(pickLegFingerprint(pick));
    score += row?.rankScore ?? pick.finalAiScore?.composite ?? pick.scores?.composite ?? 0;
    score += (pick.finalAiScore?.edgePct ?? pick.scores?.edgePct ?? 0) * 0.3;
  }
  return score;
}

function ticketFingerprint(picks: ParsedPick[]): string {
  return picks.map((p) => pickLegFingerprint(p)).sort().join("|");
}

function isHighQualityTicket(picks: ParsedPick[], target: number): boolean {
  return picks.length >= target;
}

export type FastCorrelationSearchOpts = {
  varietySeed?: string;
  searchMs?: number;
  hardMs?: number;
  maxCandidates?: number;
  highQualityStop?: number;
  isAborted?: () => boolean;
  onProgress?: (ticketsScored: number, candidateCap: number) => void;
};

/**
 * Generate up to 30 greedy candidates, score pairwise correlation on each
 * completed ticket, stop at 2s or 10 high-quality tickets, pick the best.
 */
export async function runFastCoachCorrelation(
  scored: BoardScoredLeg[],
  target: number,
  opts: FastCorrelationSearchOpts = {},
): Promise<FastCorrelationResult> {
  const start = Date.now();
  const searchMs = opts.searchMs ?? FAST_CORRELATION_SEARCH_MS;
  const hardMs = opts.hardMs ?? FAST_CORRELATION_HARD_MS;
  const maxCandidates = opts.maxCandidates ?? FAST_CORRELATION_MAX_CANDIDATES;
  const highQualityStop = opts.highQualityStop ?? FAST_CORRELATION_HIGH_QUALITY_STOP;

  const qualifying = filterQualifying(scored);
  const pool = slicePoolForCorrelation(qualifying, target);

  const scoredTickets: { picks: ParsedPick[]; score: number }[] = [];
  const seenTickets = new Set<string>();
  let highQualityFound = 0;
  let timedOut = false;

  for (let variant = 0; variant < maxCandidates; variant++) {
    const elapsed = Date.now() - start;
    if (elapsed >= hardMs) {
      timedOut = true;
      break;
    }
    if (elapsed >= searchMs) {
      timedOut = true;
      break;
    }
    if (highQualityFound >= highQualityStop) break;
    if (opts.isAborted?.()) {
      timedOut = true;
      break;
    }

    await yieldToEventLoop();

    const raw = buildGreedyCandidateTicket(pool, target, variant, opts.varietySeed);
    if (!raw.length) continue;

    const fp = ticketFingerprint(raw);
    if (seenTickets.has(fp)) continue;
    seenTickets.add(fp);

    const quality = ticketQualityScore(raw, pool);
    const penalty = ticketPairwiseCorrelationPenalty(raw);
    const score = quality - penalty;
    const picks = tagTicketRoles(raw);

    scoredTickets.push({ picks, score });
    if (isHighQualityTicket(picks, target)) highQualityFound++;

    opts.onProgress?.(scoredTickets.length, maxCandidates);
  }

  scoredTickets.sort((a, b) => b.score - a.score);
  const best = scoredTickets[0];
  const durationMs = Date.now() - start;

  return {
    picks: best?.picks ?? [],
    candidateCount: maxCandidates,
    ticketsScored: scoredTickets.length,
    highQualityFound,
    durationMs,
    usedFallback: false,
    timedOut,
  };
}

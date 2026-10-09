/**
 * Post-lean final fill — top up a short ticket from already-qualified candidates.
 *
 * Reuses {@link topUpTicketFromQualifiedScored} (progressive GL raise, prop caps,
 * ladder / same-player / P0 team-total stack gates). Never invents odds or grades,
 * never re-runs mlLean, and never loosens qualification thresholds.
 */

import type { ParsedPick } from "../components/PickCard.tsx";
import { marketFamily } from "./altLinePool.ts";
import { p0UnvalidatedSimDecision } from "./coachP0UnvalidatedTotals.ts";
import { canonicalGameKey } from "./gameSimScoring.ts";
import { wouldRepeatMarketLadder } from "./marketLadderKey.ts";
import { pickLegFingerprint } from "./parlayReachCore.ts";
import { parseMarketPeriod, pickHasSimGrade } from "./simMarketSupport.ts";
import {
  boardLegPoolRole,
  topUpTicketFromQualifiedScored,
  type BoardScoredLeg,
} from "./ticketStaging.ts";

/**
 * Quarter / half / regulation-period markets are not eligible for post-lean
 * final fill (unvalidated period OD / calibration). Full-game alts + player
 * props remain eligible under existing sim / grade / ladder / P0 gates.
 * Does not strip period legs already seated before lean.
 */
export function isPostLeanFillBlockedPeriodMarket(pick: ParsedPick): boolean {
  if (pick.isProp) return false;
  const period = parseMarketPeriod(pick.market ?? "");
  return (
    period === "q1" ||
    period === "q2" ||
    period === "q3" ||
    period === "q4" ||
    period === "h1" ||
    period === "h2" ||
    period === "p1" ||
    period === "p2" ||
    period === "p3"
  );
}

const norm = (s: string) =>
  String(s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

function teamNick(team: string): string {
  const parts = norm(team).split(" ").filter(Boolean);
  return parts[parts.length - 1] ?? "";
}

/** Side identity for ML/spread conflict checks (nick / over / under). */
function pickSideKey(pick: string): string {
  const p = norm(pick);
  if (/\bover\b/.test(p)) return "over";
  if (/\bunder\b/.test(p)) return "under";
  const t = pick
    .replace(/\s*(ml|moneyline)\s*$/i, "")
    .replace(/\s*[+-]?\d+(?:\.\d+)?\s*$/, "")
    .trim();
  return teamNick(t) || norm(t);
}

function isGameSideMlOrSpread(pick: ParsedPick): boolean {
  if (pick.isProp) return false;
  if (/\b(over|under)\b/i.test(pick.pick)) return false;
  const fam = marketFamily(pick.market);
  return fam.endsWith("moneyline") || fam.endsWith("spread");
}

/**
 * Same event + same period/settlement family + opposite team/side → conflict.
 * Blocks Cowboys Q1 spread vs Bucs Q1 spread while allowing Bucs 1H/Q2 next to
 * Cowboys Q1 (distinct period families).
 */
export function wouldConflictOppositeSideSamePeriod(
  candidate: ParsedPick,
  ticket: readonly ParsedPick[],
): boolean {
  if (!isGameSideMlOrSpread(candidate)) return false;
  const fam = marketFamily(candidate.market);
  const gameKey = canonicalGameKey(candidate.game);
  const candSide = pickSideKey(candidate.pick);
  if (!gameKey || !candSide) return false;
  return ticket.some((leg) => {
    if (!isGameSideMlOrSpread(leg)) return false;
    if (canonicalGameKey(leg.game) !== gameKey) return false;
    if (marketFamily(leg.market) !== fam) return false;
    return pickSideKey(leg.pick) !== candSide;
  });
}

/** Build a scored leg only when qualification + sim evidence already exist. */
export function scoredLegFromQualifiedCandidate(pick: ParsedPick): BoardScoredLeg | null {
  if (pick.odds == null || !Number.isFinite(pick.odds) || pick.odds === 0) return null;
  if (!pick.game || !pick.market || !pick.pick) return null;
  if (isPostLeanFillBlockedPeriodMarket(pick)) return null;
  if (p0UnvalidatedSimDecision(pick)) return null;
  const score = pick.finalAiScore;
  if (!score) return null;
  if (boardLegPoolRole(pick, score) == null) return null;
  if (isGameSideMlOrSpread(pick) && !pickHasSimGrade(pick, score.simHit)) return null;
  if (pick.isProp && score.simHit != null && !pickHasSimGrade(pick, score.simHit)) {
    return null;
  }
  return {
    pick,
    evPct: score.edgePct ?? null,
    edgePct: score.edgePct ?? null,
    confidencePct: score.confidencePct ?? null,
    impliedProbPct: null,
    lineShoppingScore: null,
    grade: score.grade ?? null,
    simHit: score.simHit ?? null,
    composite: score.composite ?? null,
    rankScore: score.composite ?? score.edgePct ?? 0,
  };
}

export type PostLeanFinalFillOpts = {
  picks: ParsedPick[];
  qualifiedCandidates: readonly ParsedPick[];
  target: number;
  varietySeed?: string;
  legsPerGameCap?: number | null;
  collegeTeamMarketStacks?: boolean;
  /**
   * Fingerprints of picks lean explicitly discarded as invalid / ungradable.
   * Cap-overflow drops are not included — progressive fill may reseat those.
   */
  rejectedFingerprints?: ReadonlySet<string>;
};

function beltTicketCorrelation(picks: ParsedPick[]): ParsedPick[] {
  const out: ParsedPick[] = [];
  for (const p of picks) {
    if (wouldConflictOppositeSideSamePeriod(p, out)) continue;
    if (wouldRepeatMarketLadder(p, out)) continue;
    out.push(p);
  }
  return out;
}

function buildFillPool(
  current: readonly ParsedPick[],
  opts: PostLeanFinalFillOpts,
): BoardScoredLeg[] {
  const used = new Set(current.map(pickLegFingerprint));
  const rejected = opts.rejectedFingerprints ?? new Set<string>();
  const scored: BoardScoredLeg[] = [];
  for (const cand of opts.qualifiedCandidates) {
    const fp = pickLegFingerprint(cand);
    if (used.has(fp) || rejected.has(fp)) continue;
    if (wouldRepeatMarketLadder(cand, current)) continue;
    if (wouldConflictOppositeSideSamePeriod(cand, current)) continue;
    const leg = scoredLegFromQualifiedCandidate(cand);
    if (!leg) continue;
    scored.push(leg);
  }
  return scored;
}

/**
 * After mlLean (single phase): fill toward `target` from qualified leftovers.
 * Does not call enforceMlLeanOnPicks. Reuses production top-up + progressive
 * GL raise; belts opposite-side same-period / duplicate ladders after each round.
 */
export function topUpAfterMlLean(opts: PostLeanFinalFillOpts): ParsedPick[] {
  const { target } = opts;
  if (target < 3 || opts.picks.length >= target) {
    return opts.picks.slice(0, Math.max(0, target));
  }

  let current = opts.picks.slice();
  // At most a few rounds so greedy adds that fail the opposite-side belt can be
  // replaced by the next eligible distinct-period / prop candidate.
  for (let round = 0; round < 3 && current.length < target; round++) {
    const scored = buildFillPool(current, opts);
    if (!scored.length) break;

    // Progressive raise lives inside topUpTicketFromQualifiedScored — do not
    // pre-raise legsPerGameCap (that would skip the approved [3,4] steps).
    const filled = topUpTicketFromQualifiedScored(
      current,
      scored,
      target,
      opts.varietySeed,
      opts.legsPerGameCap,
      opts.collegeTeamMarketStacks
        ? { collegeTeamMarketStacks: true }
        : undefined,
    );
    const belted = beltTicketCorrelation(filled).slice(0, target);
    if (belted.length <= current.length) break;
    current = belted;
  }
  return current.slice(0, target);
}

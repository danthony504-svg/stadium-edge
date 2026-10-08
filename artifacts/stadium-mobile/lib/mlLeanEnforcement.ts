// Prefer matchupHistory.mlLean.side for game-side moneyline / spread legs when
// present. Substitutions MUST already be fully qualified (finalAiScore + staging
// gates); never promote a score-less rebuild from raw odds.
//
// When a lean-side qualified replacement exists → swap.
// When it does not → preserve an already-qualified original only if it still
// clears final ticket constraints (P0, sim grade, odds, ladder, per-game cap).
// Ungraded / unqualified anti-lean originals are still dropped.
// Never pads to a requested leg count and never re-raises progressive
// thin-slate caps — hard maxLegsPerGame applies after lean.

import type { ParsedPick } from "../components/PickCard.tsx";
import { marketFamily } from "./altLinePool.ts";
import type { GameMeta, MatchupHistoryEntry, RealOddsEntry } from "./api.ts";
import { p0UnvalidatedSimTotalDecision } from "./coachP0UnvalidatedTotals.ts";
import { gameLabelsMatch } from "./gameSimScoring.ts";
import { wouldRepeatMarketLadder } from "./marketLadderKey.ts";
import {
  maxLegsPerGame,
  wouldExceedMaxLegsPerGame,
} from "./parlayCorrelationScore.ts";
import { pickHasSimGrade } from "./simMarketSupport.ts";
import { boardLegPoolRole } from "./ticketStaging.ts";

const norm = (s: string) =>
  String(s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const teamNick = (team: string) => {
  const t = norm(team).split(" ").filter(Boolean);
  return t[t.length - 1] || "";
};

/** Token / nickname overlap — same helper spirit as matchupAlignment. */
export function teamsMatch(pickTeam: string, leanSide: string): boolean {
  const a = norm(pickTeam);
  const b = norm(leanSide);
  if (!a || !b) return false;
  if (a.includes(b) || b.includes(a)) return true;
  const na = teamNick(pickTeam);
  const nb = teamNick(leanSide);
  if (na.length > 2 && na === nb) return true;
  const ta = new Set(a.split(" ").filter((w) => w.length > 2));
  return b
    .split(" ")
    .filter((w) => w.length > 2)
    .some((w) => ta.has(w));
}

function findHistoryEntry(
  game: string,
  history?: Record<string, MatchupHistoryEntry>,
): MatchupHistoryEntry | null {
  if (!history) return null;
  if (history[game]) return history[game]!;
  for (const [k, v] of Object.entries(history)) {
    if (gameLabelsMatch(k, game)) return v;
  }
  return null;
}

/** Moneyline or spread/run-line — not props or game totals. */
export function isGameSideMlOrSpread(pick: ParsedPick): boolean {
  if (pick.isProp) return false;
  if (/\b(over|under)\b/i.test(pick.pick)) return false;
  const fam = marketFamily(pick.market);
  return fam.endsWith("moneyline") || fam.endsWith("spread");
}

function pickSideTeam(pick: ParsedPick): string | null {
  if (pick.isProp) return null;
  const text = norm(pick.pick);
  if (/\b(over|under)\b/i.test(pick.pick)) return null;
  const parts = String(pick.game ?? "").split(/\s+@\s+/);
  if (parts.length !== 2) return null;
  const [away, home] = parts.map((s) => s.trim());
  const homeNick = teamNick(home!);
  const awayNick = teamNick(away!);
  const matchHome =
    text.includes(norm(home!)) ||
    (homeNick.length > 2 && text.split(" ").includes(homeNick));
  const matchAway =
    text.includes(norm(away!)) ||
    (awayNick.length > 2 && text.split(" ").includes(awayNick));
  if (matchHome === matchAway) return null;
  return matchHome ? home! : away!;
}

function legKey(p: ParsedPick): string {
  return `${p.game}|${p.market}|${p.pick}`.toLowerCase();
}

/** Staging-qualified with preserved score — never fabricate a grade. */
export function isLeanQualifiedSubstitute(pick: ParsedPick): boolean {
  if (!pick.finalAiScore) return false;
  if (pick.odds == null || !Number.isFinite(pick.odds) || pick.odds === 0) return false;
  // P0 blocked totals must never re-enter via lean (belt; lean skips totals).
  if (p0UnvalidatedSimTotalDecision(pick)) return false;
  if (!pickHasSimGrade(pick, pick.finalAiScore.simHit)) return false;
  return boardLegPoolRole(pick, pick.finalAiScore) != null;
}

/**
 * Find a lean-side replacement that already cleared qualification with score.
 * Prefer main (non-alt) markets. Never rebuild from raw odds without a score.
 */
function findQualifiedLeanReplacement(
  pick: ParsedPick,
  leanSide: string,
  qualifiedCandidates: ParsedPick[],
  alreadyOnTicket: readonly ParsedPick[],
): ParsedPick | null {
  const fam = marketFamily(pick.market);
  const onLean = qualifiedCandidates.filter((q) => {
    if (!isGameSideMlOrSpread(q)) return false;
    if (!gameLabelsMatch(q.game, pick.game)) return false;
    if (marketFamily(q.market) !== fam) return false;
    if (!isLeanQualifiedSubstitute(q)) return false;
    // Same FG/period ladder already seated → not a valid substitute.
    if (wouldRepeatMarketLadder(q, alreadyOnTicket)) return false;
    const t = pickSideTeam(q);
    return t != null && teamsMatch(t, leanSide);
  });
  if (!onLean.length) return null;
  return onLean.find((r) => !/\balt\b/i.test(r.market)) ?? onLean[0]!;
}

export type LeanTicketConstraints = {
  /** Ask size — drives hard maxLegsPerGame (no progressive thin-slate raise). */
  requestedLegs?: number;
  /** Optional override for per-game GL cap (tests / game-lines-only). */
  legsPerGameCap?: number | null;
};

/** True when a pick may occupy a seat under hard ticket constraints. */
export function passesLeanTicketConstraints(
  pick: ParsedPick,
  alreadyOnTicket: readonly ParsedPick[],
  constraints: LeanTicketConstraints = {},
): boolean {
  if (pick.odds == null || !Number.isFinite(pick.odds) || pick.odds === 0) return false;
  if (!pick.game || !pick.market || !pick.pick) return false;
  if (p0UnvalidatedSimTotalDecision(pick)) return false;

  if (isGameSideMlOrSpread(pick)) {
    if (!pick.finalAiScore) return false;
    if (!pickHasSimGrade(pick, pick.finalAiScore.simHit)) return false;
    if (boardLegPoolRole(pick, pick.finalAiScore) == null) return false;
    const target = constraints.requestedLegs ?? 7;
    const maxPerGame = maxLegsPerGame(target, constraints.legsPerGameCap);
    if (wouldExceedMaxLegsPerGame(pick, alreadyOnTicket, maxPerGame)) return false;
  } else if (pick.finalAiScore && !pickHasSimGrade(pick, pick.finalAiScore.simHit)) {
    // Props/totals that carry a score object must still have a usable sim grade.
    return false;
  }

  if (wouldRepeatMarketLadder(pick, alreadyOnTicket)) return false;
  return true;
}

/** Try to seat a pick; returns false when constraints block it. */
function trySeat(
  pick: ParsedPick,
  out: ParsedPick[],
  seen: Set<string>,
  constraints: LeanTicketConstraints,
): boolean {
  if (!passesLeanTicketConstraints(pick, out, constraints)) return false;
  const k = legKey(pick);
  if (seen.has(k)) return false;
  seen.add(k);
  out.push(pick);
  return true;
}

/**
 * Final belt after swaps/preserves: re-validate P0, sim grade, odds/identity,
 * ladder uniqueness, and hard per-game GL cap. Never pads to N.
 */
function finalizeLeanTicket(
  picks: ParsedPick[],
  constraints: LeanTicketConstraints,
): { picks: ParsedPick[]; removed: number } {
  const out: ParsedPick[] = [];
  const seen = new Set<string>();
  let removed = 0;
  for (const pick of picks) {
    if (!trySeat(pick, out, seen, constraints)) removed += 1;
  }
  return { picks: out, removed };
}

export type MlLeanEnforcementResult = {
  picks: ParsedPick[];
  swapped: number;
  dropped: number;
};

/**
 * Prefer lean-side ML/spread legs when a qualified substitute exists. Props and
 * totals are untouched. Replacement MUST come from qualifiedCandidates with
 * preserved finalAiScore.
 *
 * Missing replacement: preserve an already-qualified original only when it
 * still passes hard ticket constraints; drop unqualified / ungraded anti-lean
 * originals. Never invent grades or pad to N.
 */
export function enforceMlLeanOnPicks(
  picks: ParsedPick[],
  opts: {
    matchupHistory?: Record<string, MatchupHistoryEntry>;
    /** @deprecated Ignored for substitutions — kept for call-site compatibility. */
    realOdds?: RealOddsEntry[];
    gameMeta?: GameMeta[];
    /** Already-qualified scored picks eligible as lean-side replacements. */
    qualifiedCandidates?: ParsedPick[];
    /** Ask size for hard maxLegsPerGame after lean (default 7). */
    requestedLegs?: number;
    legsPerGameCap?: number | null;
  },
): MlLeanEnforcementResult {
  const constraints: LeanTicketConstraints = {
    requestedLegs: opts.requestedLegs,
    legsPerGameCap: opts.legsPerGameCap,
  };
  const qualified =
    opts.qualifiedCandidates?.filter((p) => isLeanQualifiedSubstitute(p)) ??
    picks.filter((p) => isLeanQualifiedSubstitute(p));
  const seen = new Set<string>();
  let swapped = 0;
  let dropped = 0;
  const out: ParsedPick[] = [];

  for (const pick of picks) {
    if (!isGameSideMlOrSpread(pick)) {
      if (!trySeat(pick, out, seen, constraints)) dropped += 1;
      continue;
    }

    const entry = findHistoryEntry(pick.game, opts.matchupHistory);
    const leanSide = entry?.mlLean?.side;
    if (!leanSide) {
      if (!trySeat(pick, out, seen, constraints)) dropped += 1;
      continue;
    }

    const team = pickSideTeam(pick);
    if (!team || teamsMatch(team, leanSide)) {
      // Aligned — keep only if still unique on ladder and (if scored) still eligible.
      if (pick.finalAiScore && !isLeanQualifiedSubstitute(pick)) {
        dropped += 1;
        continue;
      }
      if (!trySeat(pick, out, seen, constraints)) dropped += 1;
      continue;
    }

    // Anti-lean: prefer a qualified lean-side replacement that fits constraints.
    const replacement = findQualifiedLeanReplacement(pick, leanSide, qualified, out);
    if (
      replacement &&
      isLeanQualifiedSubstitute(replacement) &&
      trySeat(replacement, out, seen, constraints)
    ) {
      swapped += 1;
      continue;
    }

    // No valid replacement — preserve already-qualified original under constraints.
    if (isLeanQualifiedSubstitute(pick) && trySeat(pick, out, seen, constraints)) {
      continue;
    }
    dropped += 1;
  }

  const finalized = finalizeLeanTicket(out, constraints);
  return {
    picks: finalized.picks,
    swapped,
    dropped: dropped + finalized.removed,
  };
}

export function mlLeanEnforcementNote(result: MlLeanEnforcementResult): string {
  if (result.swapped === 0 && result.dropped === 0) return "";
  const parts: string[] = [];
  if (result.swapped > 0) {
    const n = result.swapped;
    parts.push(
      `Updated ${n} moneyline/spread ${n === 1 ? "pick" : "picks"} to a qualified analytics-lean selection.`,
    );
  }
  if (result.dropped > 0) {
    const n = result.dropped;
    parts.push(
      `Dropped ${n} moneyline/spread ${n === 1 ? "pick" : "picks"} that opposed the analytics lean and were not staging-qualified for a lean-side seat.`,
    );
  }
  return parts.join("\n\n");
}

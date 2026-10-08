// Hard-lock game-side moneyline / spread legs to matchupHistory.mlLean.side when
// present. Substitutions MUST already be fully qualified (finalAiScore + staging
// gates); never promote a score-less rebuild from raw odds.

import type { ParsedPick } from "../components/PickCard.tsx";
import { marketFamily } from "./altLinePool.ts";
import type { GameMeta, MatchupHistoryEntry, RealOddsEntry } from "./api.ts";
import { p0UnvalidatedSimTotalDecision } from "./coachP0UnvalidatedTotals.ts";
import { gameLabelsMatch } from "./gameSimScoring.ts";
import { wouldRepeatMarketLadder } from "./marketLadderKey.ts";
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

export type MlLeanEnforcementResult = {
  picks: ParsedPick[];
  swapped: number;
  dropped: number;
};

/**
 * Swap or drop game-side ML/spread legs that oppose matchupHistory.mlLean. Props
 * and totals are untouched. Replacement MUST come from qualifiedCandidates with
 * preserved finalAiScore — otherwise the opposing leg is dropped.
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
  },
): MlLeanEnforcementResult {
  const qualified =
    opts.qualifiedCandidates?.filter((p) => isLeanQualifiedSubstitute(p)) ??
    picks.filter((p) => isLeanQualifiedSubstitute(p));
  const seen = new Set<string>();
  let swapped = 0;
  let dropped = 0;
  const out: ParsedPick[] = [];

  for (const pick of picks) {
    if (!isGameSideMlOrSpread(pick)) {
      const k = legKey(pick);
      if (!seen.has(k) && !wouldRepeatMarketLadder(pick, out)) {
        seen.add(k);
        out.push(pick);
      }
      continue;
    }

    const entry = findHistoryEntry(pick.game, opts.matchupHistory);
    const leanSide = entry?.mlLean?.side;
    if (!leanSide) {
      const k = legKey(pick);
      if (!seen.has(k) && !wouldRepeatMarketLadder(pick, out)) {
        seen.add(k);
        out.push(pick);
      } else if (wouldRepeatMarketLadder(pick, out)) {
        dropped += 1;
      }
      continue;
    }

    const team = pickSideTeam(pick);
    if (!team || teamsMatch(team, leanSide)) {
      // Aligned — keep only if still unique on ladder and (if scored) still eligible.
      if (wouldRepeatMarketLadder(pick, out)) {
        dropped += 1;
        continue;
      }
      if (pick.finalAiScore && !isLeanQualifiedSubstitute(pick)) {
        dropped += 1;
        continue;
      }
      const k = legKey(pick);
      if (!seen.has(k)) {
        seen.add(k);
        out.push(pick);
      }
      continue;
    }

    const replacement = findQualifiedLeanReplacement(pick, leanSide, qualified, out);
    if (!replacement) {
      dropped += 1;
      continue;
    }

    // Re-check eligibility after selection — never ship an unverified substitute.
    if (!isLeanQualifiedSubstitute(replacement)) {
      dropped += 1;
      continue;
    }
    if (wouldRepeatMarketLadder(replacement, out)) {
      dropped += 1;
      continue;
    }

    const k = legKey(replacement);
    if (seen.has(k)) {
      dropped += 1;
      continue;
    }
    seen.add(k);
    swapped += 1;
    // Preserve grading evidence on the qualified replacement — no fabricated score.
    out.push(replacement);
  }

  return { picks: out, swapped, dropped };
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
      `Dropped ${n} moneyline/spread ${n === 1 ? "pick" : "picks"} that opposed the analytics lean and had no qualified lean-side replacement.`,
    );
  }
  return parts.join("\n\n");
}

/**
 * Soft multi-sport mix for generic Coach board-scan tickets.
 * Does not change qualification thresholds — only swaps in already-qualified
 * NFL / NCAAF legs when the staged ticket omitted them.
 */

import type { ParsedPick } from "../components/PickCard.tsx";
import { pickLegFingerprint } from "./parlayReachCore.ts";
import { boardLegPoolRole, type BoardScoredLeg } from "./ticketStaging.ts";

/** Football leagues that must not be starved on generic fixed-leg parlays. */
export const COACH_PRIORITY_SPORTS = ["nfl", "ncaaf"] as const;

function sportId(pick: { sport?: string | null }): string {
  return String(pick.sport ?? "").toLowerCase();
}

function pickComposite(pick: ParsedPick): number {
  return pick.finalAiScore?.composite ?? pick.scores?.composite ?? 0;
}

/**
 * If the ticket is missing NFL or NCAAF but the scored pool has a qualifying
 * leg for that sport, swap out the weakest non-priority leg.
 */
export function injectPrioritySportsIntoTicket(
  picks: ParsedPick[],
  scored: BoardScoredLeg[],
  target: number,
  prioritySports: readonly string[] = COACH_PRIORITY_SPORTS,
): ParsedPick[] {
  if (target < 3 || picks.length === 0) return picks;
  let out = picks.slice(0, target);
  const used = new Set(out.map(pickLegFingerprint));

  for (const sport of prioritySports) {
    if (out.some((p) => sportId(p) === sport)) continue;

    const candidates = scored
      .filter((leg) => {
        if (sportId(leg.pick) !== sport) return false;
        if (used.has(pickLegFingerprint(leg.pick))) return false;
        return boardLegPoolRole(leg.pick, leg.pick.finalAiScore) != null;
      })
      .sort((a, b) => b.rankScore - a.rankScore);

    const best = candidates[0];
    if (!best) continue;

    let worstIdx = -1;
    let worstScore = Number.POSITIVE_INFINITY;
    for (let i = 0; i < out.length; i++) {
      const p = out[i]!;
      if (prioritySports.includes(sportId(p) as (typeof prioritySports)[number])) continue;
      const score = pickComposite(p);
      if (score < worstScore) {
        worstScore = score;
        worstIdx = i;
      }
    }
    if (worstIdx < 0) continue;

    const role = boardLegPoolRole(best.pick, best.pick.finalAiScore);
    if (!role) continue;

    used.delete(pickLegFingerprint(out[worstIdx]!));
    used.add(pickLegFingerprint(best.pick));
    out[worstIdx] = {
      ...best.pick,
      ticketRole: role,
      highRiskValuePlay: false,
    };
  }

  return out.slice(0, target);
}

/**
 * Soft multi-sport mix for generic Coach board-scan tickets.
 * Does not change qualification thresholds — only swaps in already-qualified
 * NFL / NCAAF legs when the staged ticket omitted them (or only has game lines).
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
 * Ensure NFL/NCAAF appear on generic tickets. Prefer already-qualified player
 * props over game lines so a Packers total alone does not "satisfy" football.
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
    // Already have a player prop for this sport — done. Game-line-only NFL
    // must still attempt prop injection.
    if (out.some((p) => sportId(p) === sport && !!p.isProp)) continue;

    const candidates = scored
      .filter((leg) => {
        if (sportId(leg.pick) !== sport) return false;
        if (used.has(pickLegFingerprint(leg.pick))) return false;
        return boardLegPoolRole(leg.pick, leg.pick.finalAiScore) != null;
      })
      .sort((a, b) => {
        const propDelta = Number(!!b.pick.isProp) - Number(!!a.pick.isProp);
        if (propDelta !== 0) return propDelta;
        return b.rankScore - a.rankScore;
      });

    const best = candidates[0];
    if (!best) continue;

    const sportAlreadyOnTicket = out.some((p) => sportId(p) === sport);
    // Sport only as game line → only upgrade when we have a real prop.
    if (sportAlreadyOnTicket && !best.pick.isProp) continue;

    let worstIdx = -1;
    let worstScore = Number.POSITIVE_INFINITY;

    if (best.pick.isProp) {
      for (let i = 0; i < out.length; i++) {
        const p = out[i]!;
        if (sportId(p) !== sport || p.isProp) continue;
        const score = pickComposite(p);
        if (score < worstScore) {
          worstScore = score;
          worstIdx = i;
        }
      }
    }
    if (worstIdx < 0) {
      worstScore = Number.POSITIVE_INFINITY;
      for (let i = 0; i < out.length; i++) {
        const p = out[i]!;
        if (prioritySports.includes(sportId(p) as (typeof prioritySports)[number])) {
          continue;
        }
        const score = pickComposite(p);
        if (score < worstScore) {
          worstScore = score;
          worstIdx = i;
        }
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

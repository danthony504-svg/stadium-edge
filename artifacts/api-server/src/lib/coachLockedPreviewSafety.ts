/**
 * Pure locked-preview safety helpers (no DB).
 */

import type { ParsedPick } from "./coachSlateTypes.js";

export const COACH_LOCKED_PARLAY_CTA = "Sign In / Subscribe to Reveal Picks";

export type LockedOpenParlayPreview = {
  content: string;
  pickCount: number;
  requestedLegs: number;
  picks: ParsedPick[];
  cta: string;
};

/**
 * Assert a preview payload has no pick-revealing identity fields.
 * Used by adversarial tests and as a last-line server guard.
 */
export function assertLockedPreviewSafe(preview: LockedOpenParlayPreview): string[] {
  const leaks: string[] = [];
  for (const [i, p] of preview.picks.entries()) {
    if (p.game && p.game !== "••••••") leaks.push(`pick[${i}].game`);
    if (p.pick && p.pick !== "••••••") leaks.push(`pick[${i}].pick`);
    if (typeof p.odds === "number" && p.odds !== 0) leaks.push(`pick[${i}].odds`);
    if (p.player) leaks.push(`pick[${i}].player`);
    if (p.startsAt) leaks.push(`pick[${i}].startsAt`);
    if (p.propLine != null) leaks.push(`pick[${i}].propLine`);
    if (p.propSide) leaks.push(`pick[${i}].propSide`);
    if (p.propMarketKey) leaks.push(`pick[${i}].propMarketKey`);
    if (p.teamAbbr || p.awayAbbr || p.homeAbbr) leaks.push(`pick[${i}].abbr`);
  }
  if (/\bPICK\s*:/i.test(preview.content)) leaks.push("content.PICK");
  if (/\bALT\s*:/i.test(preview.content)) leaks.push("content.ALT");
  return leaks;
}

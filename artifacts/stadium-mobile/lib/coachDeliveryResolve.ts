// Preserve rendered picks and rank scan candidates for final delivery.

import type { ParsedPick } from "../components/PickCard.tsx";
import type { CoachFlashEnrich } from "./pickScoreContext.ts";
import { pickLegFingerprint } from "./parlayReachCore.ts";
import {
  coerceCoachDisplayPicks,
  prepareCoachDeliveredTicket,
} from "./coachTicketKernel.ts";
import {
  finalizeBoardBuiltCoachTicket,
  pickQualifiesForTicketGrade,
} from "./pickRecommendation.ts";
import { tagTicketRoles } from "./ticketStaging.ts";
import {
  buildFixedLegCountShortfallLead,
  ensureFixedLegShortfallLegNote,
} from "./coachScanPolicy.ts";

function pickRank(p: ParsedPick): number {
  return p.finalAiScore?.composite ?? p.scores?.composite ?? 0;
}

function normGame(game: string): string {
  return String(game ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9@]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function conflictsOverUnder(a: ParsedPick, b: ParsedPick): boolean {
  if (!a.isProp || !b.isProp || !a.player || !b.player) return false;
  if (a.player.toLowerCase() !== b.player.toLowerCase()) return false;
  if (a.market.toLowerCase() !== b.market.toLowerCase()) return false;
  const pa = a.pick.toLowerCase();
  const pb = b.pick.toLowerCase();
  const aOver = /\bover\b|^o[\s.]/.test(pa);
  const aUnder = /\bunder\b|^u[\s.]/.test(pa);
  const bOver = /\bover\b|^o[\s.]/.test(pb);
  const bUnder = /\bunder\b|^u[\s.]/.test(pb);
  return (aOver && bUnder) || (aUnder && bOver);
}

/** True when a pick already on screen has posted odds and graded model data. */
export function pickHasRenderableDeliveryData(p: ParsedPick): boolean {
  if (p.odds == null || !Number.isFinite(p.odds) || p.odds === 0) return false;
  if (p.finalAiScore) {
    return (
      pickQualifiesForTicketGrade(p, p.finalAiScore) || (p.finalAiScore.composite ?? 0) > 0
    );
  }
  return (p.scores?.composite ?? 0) > 0;
}

export function assistantPicksEqual(
  a?: readonly ParsedPick[],
  b?: readonly ParsedPick[],
): boolean {
  if ((a?.length ?? 0) !== (b?.length ?? 0)) return false;
  if (!a?.length) return true;
  if (!b) return false;
  return a.every((p, i) => {
    const other = b[i];
    if (!other) return false;
    return pickLegFingerprint(p) === pickLegFingerprint(other);
  });
}

/** Never replace visible graded cards with an empty delivery-gate result. */
export function mergeResolvedWithExistingPicks(
  existing: readonly ParsedPick[],
  resolved: readonly ParsedPick[],
  legTarget: number,
): ParsedPick[] {
  const existingValid = existing.filter(pickHasRenderableDeliveryData);
  const resolvedValid = resolved.filter(pickHasRenderableDeliveryData);
  const chosen =
    resolvedValid.length >= existingValid.length ? resolvedValid : existingValid.length
      ? existingValid
      : resolvedValid;
  return legTarget > 0 ? chosen.slice(0, legTarget) : [...chosen];
}

/** Rank scan candidates — mains, alts, props; dedupe legs and conflicting O/U props. */
export function rankScanCandidatesForDelivery(
  candidates: readonly ParsedPick[],
  enrich: CoachFlashEnrich,
  legTarget: number,
): ParsedPick[] {
  if (!candidates.length) return [];

  const tagged = tagTicketRoles([...candidates]);
  const finalized = finalizeBoardBuiltCoachTicket(tagged, enrich);
  let pool = prepareCoachDeliveredTicket(finalized.picks, enrich);
  if (!pool.length) {
    pool = coerceCoachDisplayPicks(
      candidates.filter(pickHasRenderableDeliveryData),
      enrich,
    );
  }
  if (!pool.length) {
    pool = coerceCoachDisplayPicks([...candidates], enrich);
  }

  const selected: ParsedPick[] = [];
  const seen = new Set<string>();
  const ranked = [...pool].sort((a, b) => pickRank(b) - pickRank(a));
  for (const pick of ranked) {
    const fp = pickLegFingerprint(pick);
    if (seen.has(fp)) continue;
    if (selected.some((s) => conflictsOverUnder(s, pick))) continue;
    seen.add(fp);
    selected.push(pick);
    if (legTarget > 0 && selected.length >= legTarget) break;
  }
  return legTarget > 0 ? selected.slice(0, legTarget) : selected;
}

export function buildDeliveryLegNote(
  legNote: string,
  legTarget: number,
  deliveredCount: number,
): string {
  if (legTarget <= 0 || deliveredCount <= 0) return legNote;
  if (deliveredCount >= legTarget) return legNote;
  const lead = buildFixedLegCountShortfallLead(legTarget, deliveredCount);
  return ensureFixedLegShortfallLegNote(legNote, legTarget, deliveredCount) || lead || legNote;
}

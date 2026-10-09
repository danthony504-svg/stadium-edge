/**
 * Fail-closed provider provenance for seated Coach player props.
 *
 * A final ticket prop must retain the exact provider-backed side, line, price,
 * sportsbook, Odds API event id, ESPN athlete id, and market key. Under prices
 * are never inferred from Over quotes — each side must carry its own posted
 * American odds from the props feed.
 *
 * Odds API outcomes have no stable outcome id; we retain a deterministic
 * `providerOutcomeKey` (event|market|athlete|side|line|price|book) instead.
 */

import type { ParsedPick } from "../components/PickCard.tsx";

/** Fields every seated player prop must retain (provider-backed, never invented). */
export type PropProviderProvenanceFields = {
  propSide: "Over" | "Under" | string;
  propLine: number;
  odds: number;
  /** Best-price sportsbook for THIS side (overBook / underBook from props.ts). */
  sportsbook: string;
  /** Odds API event id for the matchup. */
  eventId: string;
  athleteId: string;
  /** Raw Odds API market key, e.g. player_pass_tds. */
  propMarketKey: string;
};

export type PropProvenanceCheck = {
  ok: boolean;
  missing: string[];
  providerOutcomeKey: string | null;
};

const SIDE_OK = new Set(["Over", "Under", "Yes", "No"]);

function nonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

function finiteOdds(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && v !== 0;
}

function finiteLine(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/** Deterministic identity for one provider-posted prop side (not an Odds API id). */
export function providerOutcomeKey(fields: {
  eventId: string;
  propMarketKey: string;
  athleteId: string;
  propSide: string;
  propLine: number;
  odds: number;
  sportsbook: string;
}): string {
  return [
    fields.eventId.trim(),
    fields.propMarketKey.trim().toLowerCase(),
    fields.athleteId.trim(),
    fields.propSide.trim(),
    String(fields.propLine),
    String(fields.odds),
    fields.sportsbook.trim().toLowerCase(),
  ].join("|");
}

/**
 * Read provenance from a pick. Does not invent Under from Over or guess books.
 */
export function readPropProviderProvenance(
  pick: ParsedPick,
): Partial<PropProviderProvenanceFields> {
  const sportsbook =
    (pick as { sportsbook?: string | null }).sportsbook ??
    (pick as { providerBook?: string | null }).providerBook ??
    null;
  const eventId =
    (pick as { eventId?: string | null }).eventId ??
    pick.liveCoach?.eventId ??
    null;
  return {
    propSide: pick.propSide ?? undefined,
    propLine: pick.propLine ?? undefined,
    odds: pick.odds,
    sportsbook: sportsbook ?? undefined,
    eventId: eventId ?? undefined,
    athleteId: pick.athleteId ?? undefined,
    propMarketKey: pick.propMarketKey ?? undefined,
  };
}

/** Fail-closed check: every required field present and self-consistent. */
export function checkPropProviderProvenance(pick: ParsedPick): PropProvenanceCheck {
  const missing: string[] = [];
  const raw = readPropProviderProvenance(pick);

  if (!nonEmptyString(raw.propSide) || !SIDE_OK.has(raw.propSide)) missing.push("propSide");
  if (!finiteLine(raw.propLine)) missing.push("propLine");
  if (!finiteOdds(raw.odds)) missing.push("odds");
  if (!nonEmptyString(raw.sportsbook)) missing.push("sportsbook");
  if (!nonEmptyString(raw.eventId)) missing.push("eventId");
  if (!nonEmptyString(raw.athleteId)) missing.push("athleteId");
  if (!nonEmptyString(raw.propMarketKey)) missing.push("propMarketKey");

  if (missing.length > 0) {
    return { ok: false, missing, providerOutcomeKey: null };
  }

  const fields: PropProviderProvenanceFields = {
    propSide: raw.propSide!,
    propLine: raw.propLine!,
    odds: raw.odds!,
    sportsbook: raw.sportsbook!.trim(),
    eventId: raw.eventId!.trim(),
    athleteId: raw.athleteId!.trim(),
    propMarketKey: raw.propMarketKey!.trim(),
  };

  return {
    ok: true,
    missing: [],
    providerOutcomeKey: providerOutcomeKey(fields),
  };
}

export function hasCompletePropProviderProvenance(pick: ParsedPick): boolean {
  return checkPropProviderProvenance(pick).ok;
}

/**
 * Strip player props that lack complete provider provenance from a ticket.
 * Game lines pass through unchanged. Never fabricates missing prices/books.
 */
export function enforceSeatedPropProviderProvenance<T extends ParsedPick>(
  picks: readonly T[],
): { picks: T[]; stripped: Array<{ pick: string; missing: string[] }> } {
  const kept: T[] = [];
  const stripped: Array<{ pick: string; missing: string[] }> = [];
  for (const p of picks) {
    if (!p.isProp) {
      kept.push(p);
      continue;
    }
    const check = checkPropProviderProvenance(p);
    if (check.ok) {
      kept.push(p);
    } else {
      stripped.push({ pick: p.pick, missing: check.missing });
    }
  }
  return { picks: kept, stripped };
}

/**
 * Historical release-evidence rows that cannot be tied to a retained
 * provider-posted American price. Excluded from merge/OTA proof — not used
 * as seating input and not replaced with invented odds.
 */
export const UNVERIFIED_RELEASE_EVIDENCE_PROPS = [
  {
    status: "UNVERIFIED" as const,
    player: "Rueben Bain Jr.",
    athleteId: "4870617",
    eventLabel: "Tampa Bay Buccaneers @ Dallas Cowboys",
    eventIdOddsApi: "259b5df9aa0d10257f56de78523495e0",
    propMarketKey: "player_sacks",
    propSide: "Under",
    propLine: 0.25,
    reason:
      "Reject-audit omitted odds; diag-56 retained only Over 0.25 @ +290; live props empty. No Under American price recovered. Not used as release evidence.",
    relatedConfirmedOver: { propSide: "Over", propLine: 0.25, odds: 290 },
  },
  {
    status: "UNVERIFIED" as const,
    player: "Jalon Daniels",
    athleteId: "4596472",
    eventLabel: "Tampa Bay Buccaneers @ Dallas Cowboys",
    eventIdOddsApi: "259b5df9aa0d10257f56de78523495e0",
    propMarketKey: "player_pass_tds",
    propSide: "Under",
    propLine: 1.5,
    reason:
      "Reject-audit omitted odds; diag-56 retained Over 1.5 @ +230 (alt) and Under 0.5 @ +201 (different line). No Under 1.5 American price recovered. Not used as release evidence.",
    relatedConfirmedOver: { propSide: "Over", propLine: 1.5, odds: 230, isAlt: true },
  },
] as const;

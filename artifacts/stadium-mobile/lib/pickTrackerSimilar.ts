// Similar-pick matching for the Coach AI Learning panel — uses REAL settled history.

import type { ParsedPick } from "../components/PickCard.tsx";
import { familyKeyForPick } from "./marketWeighting.ts";
import {
  isDecidedStatus,
  oddsBucket,
  type TrackedPick,
} from "./pickTracker.ts";

export type SimilarRecord = {
  wins: number;
  losses: number;
  total: number;
  label: string;
};

function signatureForPick(p: {
  sport?: string;
  isProp?: boolean;
  market?: string;
  propMarketKey?: string;
  odds: number;
}): string | null {
  const sport = (p.sport ?? "").toLowerCase();
  if (!sport) return null;
  const fam = familyKeyForPick(p) ?? (p.isProp ? "prop" : "game_line");
  const bucket = oddsBucket(p.odds);
  return `${sport}|${fam}|${bucket}`;
}

function signatureForTracked(t: TrackedPick): string | null {
  return signatureForPick({
    sport: t.sport,
    isProp: t.isProp,
    market: t.market,
    propMarketKey: t.propMarketKey,
    odds: t.odds,
  });
}

/** Settled record for picks sharing sport + market family + odds bucket. */
export function similarPickRecord(
  picks: ParsedPick[],
  history: TrackedPick[],
): SimilarRecord | null {
  if (picks.length === 0 || history.length === 0) return null;
  const sigs = new Set(
    picks.map(signatureForPick).filter((s): s is string => !!s),
  );
  if (sigs.size === 0) return null;

  let wins = 0;
  let losses = 0;
  for (const t of history) {
    if (!isDecidedStatus(t.status)) continue;
    const sig = signatureForTracked(t);
    if (!sig || !sigs.has(sig)) continue;
    if (t.status === "win") wins += 1;
    else losses += 1;
  }
  const total = wins + losses;
  if (total === 0) return null;
  return {
    wins,
    losses,
    total,
    label: "sport · market · odds range",
  };
}

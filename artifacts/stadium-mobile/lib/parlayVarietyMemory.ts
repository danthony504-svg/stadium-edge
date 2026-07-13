// Remember recent Coach parlay legs so identical taps don't replay the same ticket.

import type { ParsedPick } from "@/components/PickCard";
import type { PropPoolEntry } from "@/lib/api";

const norm = (s: string) =>
  String(s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Stable key for a prop leg — game + player + market (not line side noise). */
export function parlayLegKey(p: {
  game: string;
  market: string;
  player?: string | null;
  pick?: string;
  isProp?: boolean;
}): string {
  if (p.player) return `${norm(p.game)}|${norm(p.player)}|${norm(p.market)}`;
  return `${norm(p.game)}|${norm(p.market)}|${norm(p.pick ?? "")}`;
}

export function parlayLegKeyFromPool(e: PropPoolEntry): string {
  return `${norm(e.game)}|${norm(e.player)}|${norm(e.marketLabel)}`;
}

const MAX_BUILDS = 4;
const MAX_KEYS = 60;

let recentBuilds: string[][] = [];

/** Leg keys from the last few parlay builds (newest first). */
export function recentParlayLegKeys(): Set<string> {
  const out = new Set<string>();
  for (const build of recentBuilds) {
    for (const k of build) out.add(k);
    if (out.size >= MAX_KEYS) break;
  }
  return out;
}

/** Full leg-key sets for recent tickets — used to avoid replaying the same combination. */
export function recentParlayTicketLegSets(): readonly (readonly string[])[] {
  return recentBuilds;
}

/** Share of candidate legs that also appeared on a recent ticket (0–1). */
export function ticketOverlapRatio(
  candidateKeys: readonly string[],
  recentKeys: readonly string[],
): number {
  if (!candidateKeys.length || !recentKeys.length) return 0;
  const recent = new Set(recentKeys);
  const overlap = candidateKeys.filter((k) => recent.has(k)).length;
  return overlap / candidateKeys.length;
}

/** Call after a successful parlay render — feeds the next build's avoid list. */
export function rememberParlayBuild(picks: ParsedPick[]): void {
  if (!picks.length) return;
  const keys = picks.map((p) => parlayLegKey(p));
  recentBuilds = [keys, ...recentBuilds.filter((b) => b.join() !== keys.join())].slice(
    0,
    MAX_BUILDS,
  );
}

/** Test helper — clear session memory. */
export function clearParlayVarietyMemory(): void {
  recentBuilds = [];
}

/** Sort pool rows so legs from the last build are tried last. */
export function deprioritizePropPoolEntries(
  entries: PropPoolEntry[],
  avoid: Set<string>,
): PropPoolEntry[] {
  if (!avoid.size) return entries;
  return [...entries].sort((a, b) => {
    const aa = avoid.has(parlayLegKeyFromPool(a)) ? 1 : 0;
    const bb = avoid.has(parlayLegKeyFromPool(b)) ? 1 : 0;
    return aa - bb;
  });
}

/** Rotate ticket leg order so the lead card changes even when the set is similar. */
export function rotateParlayDisplayOrder<T>(picks: T[], seed: string): T[] {
  if (picks.length <= 1) return picks;
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const rot = h % picks.length;
  return [...picks.slice(rot), ...picks.slice(0, rot)];
}

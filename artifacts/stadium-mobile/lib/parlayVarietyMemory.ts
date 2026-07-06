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

/** Player names from recent builds — at most one prop per player per ticket. */
export function recentParlayPlayerKeys(): Set<string> {
  const out = new Set<string>();
  for (const build of recentBuilds) {
    for (const k of build) {
      const parts = k.split("|");
      if (parts.length >= 2 && parts[1]!.trim()) out.add(parts[1]!);
    }
  }
  return out;
}

/** Player appearance counts across recent builds — higher = shown more often. */
export function recentPlayerAppearanceCounts(): Map<string, number> {
  const counts = new Map<string, number>();
  for (const build of recentBuilds) {
    for (const k of build) {
      const parts = k.split("|");
      if (parts.length >= 2 && parts[1]!.trim()) {
        const playerKey = parts[1]!;
        counts.set(playerKey, (counts.get(playerKey) ?? 0) + 1);
      }
    }
  }
  return counts;
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

/** Rotate ticket leg order — vary the lead card and avoid always opening on spreads. */
export function rotateParlayDisplayOrder<T extends { isProp?: boolean; market?: string; odds?: number }>(
  picks: T[],
  seed: string,
): T[] {
  if (picks.length <= 1) return picks;
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const rot = h % picks.length;
  let out = [...picks.slice(rot), ...picks.slice(0, rot)];

  const isSpreadLead = (arr: T[]) => {
    const p = arr[0];
    if (!p || p.isProp) return false;
    return /spread|run line|puck/i.test(String(p.market ?? ""));
  };

  if (isSpreadLead(out)) {
    const altIdx = out.findIndex(
      (p) =>
        p.isProp ||
        /total|alt|team total|moneyline|ml/i.test(String(p.market ?? "")) ||
        (p.odds ?? -999) >= 250,
    );
    if (altIdx > 0) {
      out = [...out.slice(altIdx), ...out.slice(0, altIdx)];
    }
  }
  return out;
}

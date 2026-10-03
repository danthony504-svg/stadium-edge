// Remember recent Coach parlay tickets — avoid replaying anchors and combinations.

import type { ParsedPick } from "@/components/PickCard";
import type { PropPoolEntry } from "@/lib/api";
import { pickUsageSignature } from "./pickUsageSignature.ts";

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

/** Player-only key for anchor / frequency tracking. */
export function parlayPlayerKey(p: { player?: string | null }): string {
  return String(p.player ?? "")
    .toLowerCase()
    .trim();
}

export type ParlayBuildRecord = {
  legKeys: string[];
  /** Market-shape signatures (no player/team) — tracks alt-pattern reuse. */
  signatures: string[];
  legCount: number;
  leadPlayerKey: string;
  leadLegKey: string;
};

/** Keep the last 40 tickets shown (user: 20–50). */
export const MAX_PARLAY_BUILD_HISTORY = 40;
const MAX_KEYS = 200;

let recentBuilds: ParlayBuildRecord[] = [];

export type CoachParlayVarietyContext = {
  recentTickets: readonly (readonly string[])[];
  recentLeadPlayers: readonly string[];
  recentPlayerCounts: ReadonlyMap<string, number>;
  /**
   * How often each market-shape signature appeared across recent tickets
   * (player/team stripped). Soft-penalize overused alt patterns without a scan.
   */
  recentSignatureCounts: ReadonlyMap<string, number>;
  /** Tickets grouped by leg count — used to avoid smaller sizes prefixing larger ones. */
  recentTicketsByLegCount: ReadonlyMap<number, readonly (readonly string[])[]>;
  /**
   * "all new picks" / "fresh picks": hard-exclude recent leg keys while filling,
   * then relax only if the ticket would otherwise shortfall.
   */
  hardAvoidRecentLegs?: boolean;
};

function ticketsByLegCountFromBuilds(
  builds: ParlayBuildRecord[],
): Map<number, string[][]> {
  const out = new Map<number, string[][]>();
  for (const build of builds) {
    const size = build.legCount;
    const rows = out.get(size) ?? [];
    rows.push([...build.legKeys]);
    out.set(size, rows);
  }
  return out;
}

/** True when `shorter` is exactly the first N legs of `longer` (same order). */
export function isPrefixLegKeys(
  shorter: readonly string[],
  longer: readonly string[],
): boolean {
  if (!shorter.length || shorter.length >= longer.length) return false;
  for (let i = 0; i < shorter.length; i++) {
    if (shorter[i] !== longer[i]) return false;
  }
  return true;
}

function playerCountsFromBuilds(builds: ParlayBuildRecord[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const build of builds) {
    const seen = new Set<string>();
    for (const key of build.legKeys) {
      const parts = key.split("|");
      const player = parts.length >= 2 ? parts[1]! : "";
      if (!player) continue;
      if (seen.has(player)) continue;
      seen.add(player);
      counts.set(player, (counts.get(player) ?? 0) + 1);
    }
    if (build.leadPlayerKey) {
      counts.set(
        build.leadPlayerKey,
        (counts.get(build.leadPlayerKey) ?? 0) + 0,
      );
    }
  }
  for (const build of builds) {
    if (!build.leadPlayerKey) continue;
    counts.set(build.leadPlayerKey, (counts.get(build.leadPlayerKey) ?? 0) + 1);
  }
  return counts;
}

/** Count market-shape signatures across builds (once per signature per ticket). */
function signatureCountsFromBuilds(builds: ParlayBuildRecord[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const build of builds) {
    const seen = new Set<string>();
    for (const sig of build.signatures) {
      if (!sig || seen.has(sig)) continue;
      seen.add(sig);
      counts.set(sig, (counts.get(sig) ?? 0) + 1);
    }
  }
  return counts;
}

export function askWantsAllNewPicks(text?: string | null): boolean {
  const t = String(text ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
  if (!t) return false;
  if (/\ball\s+new\b/.test(t)) return true;
  if (/\bnew\s+picks?\b/.test(t)) return true;
  if (/\bfresh\s+picks?\b/.test(t)) return true;
  if (/\bdifferent\s+picks?\b/.test(t)) return true;
  if (/\bno\s+repeats?\b/.test(t)) return true;
  if (/\bavoid\s+repeats?\b/.test(t)) return true;
  return false;
}

/** Full variety context for independent ticket combinator. */
export function recentParlayVarietyContext(): CoachParlayVarietyContext {
  return {
    recentTickets: recentBuilds.map((b) => b.legKeys),
    recentLeadPlayers: recentBuilds
      .map((b) => b.leadPlayerKey)
      .filter((p) => p.length > 0),
    recentPlayerCounts: playerCountsFromBuilds(recentBuilds),
    recentSignatureCounts: signatureCountsFromBuilds(recentBuilds),
    recentTicketsByLegCount: ticketsByLegCountFromBuilds(recentBuilds),
  };
}

/** Leg keys from the last few parlay builds (newest first). */
export function recentParlayLegKeys(): Set<string> {
  const out = new Set<string>();
  for (const build of recentBuilds) {
    for (const k of build.legKeys) out.add(k);
    if (out.size >= MAX_KEYS) break;
  }
  return out;
}

/** Full leg-key sets for recent tickets — used to avoid replaying the same combination. */
export function recentParlayTicketLegSets(): readonly (readonly string[])[] {
  return recentBuilds.map((b) => b.legKeys);
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
  const legKeys = picks.map((p) => parlayLegKey(p));
  const signatures = picks.map((p) => pickUsageSignature(p));
  const lead = picks[0]!;
  const record: ParlayBuildRecord = {
    legKeys,
    signatures,
    legCount: picks.length,
    leadPlayerKey: parlayPlayerKey(lead),
    leadLegKey: parlayLegKey(lead),
  };
  const fingerprint = legKeys.join("||");
  recentBuilds = [
    record,
    ...recentBuilds.filter((b) => b.legKeys.join("||") !== fingerprint),
  ].slice(0, MAX_PARLAY_BUILD_HISTORY);
}

/** How many recent tickets reused this market-shape signature. */
export function pickUsageCount(pick: {
  market: string;
  pick: string;
  isProp?: boolean;
  player?: string | null;
  propSide?: string | null;
}): number {
  const sig = pickUsageSignature(pick);
  return signatureCountsFromBuilds(recentBuilds).get(sig) ?? 0;
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

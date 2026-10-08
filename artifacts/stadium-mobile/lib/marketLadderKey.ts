// Stable per-market ladder keys — shared by exhaustion collapse and ticket
// assembly so two alt rungs of the same side never share a Coach ticket.

import type { ParsedPick } from "../components/PickCard.tsx";
import { marketFamily } from "./altLinePool.ts";

const norm = (s: string) =>
  String(s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

function pickSideKey(pick: string): string {
  const p = norm(pick);
  if (/\bover\b/.test(p)) return "over";
  if (/\bunder\b/.test(p)) return "under";
  const t = pick
    .replace(/\s*(ml|moneyline)\s*$/i, "")
    .replace(/\s*[+-]?\d+(?:\.\d+)?\s*$/, "")
    .trim();
  return norm(t);
}

/** Extract posted line/point from a pick label for score-key uniqueness. */
export function postedLineKey(pick: {
  pick: string;
  propLine?: number | null;
}): string {
  if (pick.propLine != null && Number.isFinite(pick.propLine)) {
    return String(pick.propLine);
  }
  const m = String(pick.pick ?? "").match(/([+-]?\d+(?:\.\d+)?)/);
  return m?.[1] ?? "na";
}

/** Stable key for one posted market ladder (game line family or player prop market). */
export function marketLadderKey(pick: {
  game: string;
  market: string;
  pick: string;
  isProp?: boolean;
  player?: string | null;
  propSide?: string | null;
}): string {
  if (pick.isProp) {
    const player = norm(pick.player ?? pick.pick.split(/\s+/)[0] ?? "");
    const market = norm(pick.market);
    const side =
      pick.propSide ??
      (/\bover\b/i.test(pick.pick) ? "Over" : /\bunder\b/i.test(pick.pick) ? "Under" : "");
    return `${norm(pick.game)}|prop|${player}|${market}|${side}`.toLowerCase();
  }
  return `${norm(pick.game)}|${marketFamily(pick.market)}|${pickSideKey(pick.pick)}`.toLowerCase();
}

/**
 * Score-pool key: correlation ladder + distinct posted threshold.
 * Distinct alt lines (67.5 vs 149.5) score independently; ticket seating still
 * uses {@link marketLadderKey} / {@link wouldRepeatMarketLadder} so only one
 * correlated rung lands on a ticket.
 */
export function marketLadderScoreKey(pick: {
  game: string;
  market: string;
  pick: string;
  isProp?: boolean;
  player?: string | null;
  propSide?: string | null;
  propLine?: number | null;
}): string {
  return `${marketLadderKey(pick)}|${postedLineKey(pick)}`;
}

/** True when `candidate` shares a market ladder already on the ticket. */
export function wouldRepeatMarketLadder(
  candidate: {
    game: string;
    market: string;
    pick: string;
    isProp?: boolean;
    player?: string | null;
    propSide?: string | null;
  },
  ticket: readonly {
    game: string;
    market: string;
    pick: string;
    isProp?: boolean;
    player?: string | null;
    propSide?: string | null;
  }[],
): boolean {
  if (!ticket.length) return false;
  const key = marketLadderKey(candidate);
  return ticket.some((p) => marketLadderKey(p) === key);
}

/**
 * Keep one rung per market ladder on a finished ticket (highest composite wins).
 * Phone: Colts +4.5 and Colts +3.5 1H alt spreads on the same ticket.
 */
export function dedupePicksByMarketLadder<T extends ParsedPick>(picks: T[]): T[] {
  if (picks.length <= 1) return picks;
  const best = new Map<string, T>();
  const order: string[] = [];
  for (const p of picks) {
    const key = marketLadderKey(p);
    const prev = best.get(key);
    if (!prev) {
      best.set(key, p);
      order.push(key);
      continue;
    }
    const prevRank = prev.finalAiScore?.composite ?? prev.scores?.composite ?? 0;
    const nextRank = p.finalAiScore?.composite ?? p.scores?.composite ?? 0;
    if (nextRank > prevRank) best.set(key, p);
  }
  return order.map((k) => best.get(k)!).filter(Boolean);
}

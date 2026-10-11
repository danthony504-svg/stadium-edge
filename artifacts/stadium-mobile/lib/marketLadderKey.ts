// Stable per-market ladder keys — shared by ticket seating so two alt rungs
// of the same side never share a Coach ticket.

import type { ParsedPick } from "../components/PickCard.tsx";
import { marketFamily } from "./altLinePool.ts";
import { canonicalGameKey } from "./gameSimScoring.ts";

const norm = (s: string) =>
  String(s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

function teamNick(team: string): string {
  const parts = norm(team).split(" ").filter(Boolean);
  return parts[parts.length - 1] ?? "";
}

function pickSideKey(pick: string): string {
  const p = norm(pick);
  if (/\bover\b/.test(p)) return "over";
  if (/\bunder\b/.test(p)) return "under";
  const t = pick
    .replace(/\s*(ml|moneyline)\s*$/i, "")
    .replace(/\s*[+-]?\d+(?:\.\d+)?\s*$/, "")
    .trim();
  const nick = teamNick(t);
  return nick || norm(t);
}

function teamTotalSideKey(pick: string): string {
  const side = /\bunder\b/i.test(pick) ? "under" : /\bover\b/i.test(pick) ? "over" : "na";
  const stripped = pick
    .replace(/\b(over|under|o|u)\b/gi, " ")
    .replace(/[+-]?\d+(?:\.\d+)?/g, " ")
    .trim();
  const nick = teamNick(stripped);
  return `${nick || "team"}|${side}`;
}

function isTeamTotalMarket(market: string): boolean {
  return /team total/i.test(String(market ?? ""));
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
  const gameKey = canonicalGameKey(pick.game);
  if (pick.isProp) {
    const player = norm(pick.player ?? pick.pick.split(/\s+/)[0] ?? "");
    // Strip alt suffix so main + alt rungs of the same participant+stat+side
    // share one seating ladder (score pool still distinguishes via score key).
    const market = norm(pick.market)
      .replace(/\balternate\b/g, " ")
      .replace(/\balt\b/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    const side =
      pick.propSide ??
      (/\bover\b/i.test(pick.pick) ? "Over" : /\bunder\b/i.test(pick.pick) ? "Under" : "");
    return `${gameKey}|prop|${player}|${market}|${side}`.toLowerCase();
  }
  const fam = marketFamily(pick.market);
  if (isTeamTotalMarket(pick.market)) {
    const period = fam.includes(":") ? fam.split(":")[0] + ":" : "";
    return `${gameKey}|${period}teamtotal|${teamTotalSideKey(pick.pick)}`.toLowerCase();
  }
  return `${gameKey}|${fam}|${pickSideKey(pick.pick)}`.toLowerCase();
}

/** Score-pool key: correlation ladder + distinct posted threshold. */
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

/** Keep one rung per market ladder on a finished ticket (highest composite wins). */
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

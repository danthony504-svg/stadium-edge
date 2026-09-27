// Correlation scoring for multi-leg parlay construction — penalizes same-game
// stacks, duplicate player exposure, and anti-correlated game-line combos so the
// full-board ranker prefers independent legs. Pure module — no React imports.

import { pickLegFingerprint } from "./parlayReachCore.ts";

type CorrelationPick = {
  game: string;
  market: string;
  pick: string;
  odds?: number;
  isProp?: boolean;
  player?: string;
  sport?: string;
};

const normGame = (g: string) =>
  String(g ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9@]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

function isGameSideLeg(p: CorrelationPick): boolean {
  return !p.isProp && /moneyline|spread|total|run line|puck line/i.test(p.market);
}

/** Niche stat props (SB, etc.) — low volume, high variance; cap per ticket. */
const THIN_PROP_MARKET_RE =
  /\b(stolen bases?|steals?\b|first (td|basket|goal)|double[- ]?double)\b/i;

export function isThinPropStatMarket(market: string): boolean {
  return THIN_PROP_MARKET_RE.test(market.toLowerCase());
}

/** Max legs of the same thin stat market on a fixed-leg ticket. */
export function maxLegsPerThinStatMarket(target: number): number {
  if (target >= 9) return 2;
  if (target >= 6) return 2;
  return 1;
}

/**
 * Hard cap on legs from one matchup (period + FG + props count together).
 * Soft correlation alone cannot stop high-rank Q1/Q2/1H stacks from 2 games
 * filling a 10-leg ask. Short tickets / SGP stay uncapped here.
 */
export function maxLegsPerGame(target: number): number {
  if (target >= 8) return 2;
  if (target >= 5) return 2;
  if (target >= 3) return 3;
  return 99;
}

export function countLegsForGame(
  ticket: readonly CorrelationPick[],
  game: string,
): number {
  const g = normGame(game);
  if (!g) return 0;
  return ticket.filter((l) => normGame(l.game) === g).length;
}

export function wouldExceedMaxLegsPerGame(
  candidate: CorrelationPick,
  ticket: readonly CorrelationPick[],
  maxPerGame: number,
): boolean {
  if (maxPerGame >= 99) return false;
  return countLegsForGame(ticket, candidate.game) >= maxPerGame;
}

/** Higher = worse for parlay independence. */
export function parlayCorrelationPenalty(candidate: CorrelationPick, ticket: CorrelationPick[]): number {
  let penalty = 0;
  const candGame = normGame(candidate.game);

  // Thin stat markets (stolen bases, etc.) should not stack across a deep ticket.
  if (candidate.isProp && candidate.market) {
    const candMkt = candidate.market.toLowerCase();
    const sameMkt = ticket.filter(
      (l) => l.isProp && l.market.toLowerCase() === candMkt,
    ).length;
    const thin = isThinPropStatMarket(candidate.market);
    const perDup = thin ? 22 : 10;
    if (sameMkt > 0) penalty += perDup * sameMkt;
    if (thin) {
      const thinOnTicket = ticket.filter(
        (l) => l.isProp && isThinPropStatMarket(l.market),
      ).length;
      if (thinOnTicket > 0) penalty += 12 * thinOnTicket;
    }
  }

  for (const leg of ticket) {
    const legGame = normGame(leg.game);
    if (legGame !== candGame) {
      if (leg.sport && candidate.sport && leg.sport === candidate.sport) penalty += 0.75;
      continue;
    }

    if (leg.isProp && candidate.isProp) {
      const samePlayer =
        leg.player && candidate.player && leg.player.toLowerCase() === candidate.player.toLowerCase();
      if (samePlayer) {
        penalty += 16;
        if (leg.market.toLowerCase() === candidate.market.toLowerCase()) penalty += 10;
      } else {
        penalty += 5;
      }
      continue;
    }

    if (isGameSideLeg(leg) && isGameSideLeg(candidate)) {
      const sameLeg =
        leg.market.toLowerCase() === candidate.market.toLowerCase() &&
        leg.pick.toLowerCase() === candidate.pick.toLowerCase();
      penalty += sameLeg ? 22 : 14;
      continue;
    }

    penalty += 7;
  }

  return penalty;
}

/** Greedy top-N with correlation penalty — prefers independent legs across games. */
export function selectCorrelationAwareBoardLegs<T extends CorrelationPick>(
  ranked: Array<{ pick: T; rankScore: number }>,
  target: number,
  opts?: { ticketTarget?: number; existing?: readonly T[] },
): T[] {
  const ticketTarget = opts?.ticketTarget ?? target;
  const maxPerGame = maxLegsPerGame(ticketTarget);
  const existing = opts?.existing ?? [];
  const added: T[] = [];
  const pool = [...ranked];

  while (added.length < target && pool.length > 0) {
    let bestIdx = -1;
    let bestScore = -Infinity;
    const onTicket = [...existing, ...added];

    for (let i = 0; i < pool.length; i++) {
      const row = pool[i]!;
      const fp = pickLegFingerprint(row.pick as Parameters<typeof pickLegFingerprint>[0]);
      if (
        onTicket.some(
          (s) => pickLegFingerprint(s as Parameters<typeof pickLegFingerprint>[0]) === fp,
        )
      ) {
        continue;
      }
      if (wouldExceedMaxLegsPerGame(row.pick, onTicket, maxPerGame)) continue;
      const effective = row.rankScore - parlayCorrelationPenalty(row.pick, onTicket);
      if (effective > bestScore) {
        bestScore = effective;
        bestIdx = i;
      }
    }

    if (bestIdx < 0) break;
    added.push(pool[bestIdx]!.pick);
    pool.splice(bestIdx, 1);
  }

  return added.slice(0, target);
}

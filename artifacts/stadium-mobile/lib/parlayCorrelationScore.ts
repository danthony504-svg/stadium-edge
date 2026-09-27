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
 * Hard cap on **game-line** legs from one matchup (period + FG + alts).
 * Player props do not consume this budget — otherwise a 2-game NFL early
 * slate fills both seats with totals/spreads and ships zero props.
 * Soft correlation still penalizes same-game prop stacks.
 *
 * Pass `override` when the ask is game-lines-only / few-game stack so
 * period/alt rungs can fill a deep ticket without inventing filler.
 */
export function maxLegsPerGame(target: number, override?: number | null): number {
  if (override != null && override > 0) return override;
  if (target >= 8) return 2;
  if (target >= 5) return 2;
  if (target >= 3) return 3;
  return 99;
}

/** Compute per-game cap from ask intent (no props / from N games). */
export function legsPerGameCapForAsk(
  target: number,
  opts?: { gameLinesOnly?: boolean; maxGames?: number | null },
): number | null {
  if (!opts?.gameLinesOnly && (opts?.maxGames == null || opts.maxGames <= 0)) {
    return null;
  }
  const games = Math.max(1, opts?.maxGames ?? 2);
  return Math.max(maxLegsPerGame(target), Math.ceil(target / games));
}

export function countLegsForGame(
  ticket: readonly CorrelationPick[],
  game: string,
  opts?: { includeProps?: boolean },
): number {
  const g = normGame(game);
  if (!g) return 0;
  return ticket.filter((l) => {
    if (normGame(l.game) !== g) return false;
    // Default: only game-side legs count toward the hard diversity cap.
    if (!opts?.includeProps && l.isProp) return false;
    return true;
  }).length;
}

export function wouldExceedMaxLegsPerGame(
  candidate: CorrelationPick,
  ticket: readonly CorrelationPick[],
  maxPerGame: number,
): boolean {
  if (maxPerGame >= 99) return false;
  // Props never consume the hard game-line seat budget.
  if (candidate.isProp) return false;
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
  opts?: { ticketTarget?: number; existing?: readonly T[]; legsPerGameCap?: number | null },
): T[] {
  const ticketTarget = opts?.ticketTarget ?? target;
  const maxPerGame = maxLegsPerGame(ticketTarget, opts?.legsPerGameCap);
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

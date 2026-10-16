// Correlation scoring for multi-leg parlay construction — penalizes same-game
// stacks, duplicate player exposure, and anti-correlated game-line combos so the
// full-board ranker prefers independent legs. Pure module — no React imports.

import { pickLegFingerprint } from "./parlayReachCore.ts";
import { wouldRepeatMarketLadder } from "./marketLadderKey.ts";
import { wouldStackSameTeamTeamTotals } from "./coachP0UnvalidatedTotals.ts";

type CorrelationPick = {
  game: string;
  market: string;
  pick: string;
  odds?: number;
  isProp?: boolean;
  player?: string;
  /** Stable athlete id when present — preferred over display-name forms. */
  athleteId?: string | null;
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

function pickLineNumber(pick: string): number | null {
  const m = String(pick ?? "").match(/([+-]?\d+(?:\.\d+)?)\s*$/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

function teamNickForCorr(name: string): string {
  return String(name ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .pop() ?? "";
}

/** Same-team team-total / alt-spread ladders — keep candidates, heavy soft penalty. */
function sameTeamNearIdenticalLadder(
  a: CorrelationPick,
  b: CorrelationPick,
): boolean {
  const am = String(a.market ?? "").toLowerCase();
  const bm = String(b.market ?? "").toLowerCase();
  const aTeamTotal = /team total/.test(am);
  const bTeamTotal = /team total/.test(bm);
  const aSpread = /spread|run line|puck line/.test(am) && !aTeamTotal;
  const bSpread = /spread|run line|puck line/.test(bm) && !bTeamTotal;
  if (!(aTeamTotal && bTeamTotal) && !(aSpread && bSpread)) return false;

  const aLine = pickLineNumber(a.pick);
  const bLine = pickLineNumber(b.pick);
  if (aLine == null || bLine == null) return false;
  // Near-identical ladder rungs (within 7 pts for spreads / 10 for team totals).
  const maxDelta = aTeamTotal ? 10 : 7;
  if (Math.abs(aLine - bLine) > maxDelta) return false;

  const aTokens = String(a.pick ?? "")
    .toLowerCase()
    .replace(/\b(over|under|o|u)\b/g, " ")
    .replace(/[+-]?\d+(?:\.\d+)?/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const bTokens = String(b.pick ?? "")
    .toLowerCase()
    .replace(/\b(over|under|o|u)\b/g, " ")
    .replace(/[+-]?\d+(?:\.\d+)?/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const aNick = teamNickForCorr(aTokens.join(" "));
  const bNick = teamNickForCorr(bTokens.join(" "));
  return !!aNick && aNick === bNick;
}

/** Niche stat props (SB, etc.) — low volume, high variance; cap per ticket. */
const THIN_PROP_MARKET_RE =
  /\b(stolen bases?|steals?\b|first (td|basket|goal)|double[- ]?double)\b/i;

export function isThinPropStatMarket(market: string): boolean {
  return THIN_PROP_MARKET_RE.test(market.toLowerCase());
}

/** QB pass-TD props — positively dependent with same-game receiving volume. */
export function isPassTdPropMarket(market: string): boolean {
  return /\bpass(?:ing)?\s*tds?\b|\bpassing touchdowns?\b/i.test(String(market ?? ""));
}

/** Receiving props that rise with pass-TD outcomes (soft dependence only). */
export function isReceivingPropMarket(market: string): boolean {
  const m = String(market ?? "").toLowerCase();
  if (/\bpass(?:ing)?\s*tds?\b|\bpassing touchdowns?\b/.test(m)) return false;
  return (
    /\brec(?:eption|eiving)?\s*yds?\b/.test(m) ||
    /\breceptions?\b/.test(m) ||
    /\blongest reception\b/.test(m) ||
    /\breceiving touchdowns?\b/.test(m) ||
    /\banytime\s*tds?\b/.test(m)
  );
}

function passTdReceiverSoftBump(aMarket: string, bMarket: string): number {
  const aPass = isPassTdPropMarket(aMarket);
  const bPass = isPassTdPropMarket(bMarket);
  const aRec = isReceivingPropMarket(aMarket);
  const bRec = isReceivingPropMarket(bMarket);
  if ((aPass && bRec) || (bPass && aRec)) return 12;
  return 0;
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
  opts?: {
    gameLinesOnly?: boolean;
    maxGames?: number | null;
    /** College team markets: FG + Q2 + team totals may share a game. */
    collegeTeamMarketStacks?: boolean;
  },
): number | null {
  // Bare college mix is not gameLinesOnly, but still needs FG+Q2+team-total
  // seats per game so "7 leg college" can fill from real posted team markets.
  if (opts?.collegeTeamMarketStacks) {
    const games = Math.max(1, opts?.maxGames ?? 2);
    const base = Math.max(maxLegsPerGame(target), Math.ceil(target / games));
    return Math.max(base, Math.min(target, 4));
  }
  if (!opts?.gameLinesOnly && (opts?.maxGames == null || opts.maxGames <= 0)) {
    return null;
  }
  const games = Math.max(1, opts?.maxGames ?? 2);
  return Math.max(maxLegsPerGame(target), Math.ceil(target / games));
}

/**
 * When a thin slate cannot reach the fixed-leg target under the default
 * game-line diversity cap, raise the per-matchup budget step-by-step so
 * already-qualified period/alt rungs can fill seats. Never invents legs —
 * callers still only pull from the AI-qualified pool.
 *
 * Ceiling is ceil(target / 2): enough for a 2-game early NFL window without
 * turning a deep ask into a single-game SGP dump. College team-market fills
 * may climb higher (up to min(target, 5)) so FG+Q2+team-total stacks can
 * finish a deep ask from a thin Saturday slate.
 */
export function progressiveLegsPerGameRelaxation(
  target: number,
  currentCap?: number | null,
  opts?: { collegeTeamMarketStacks?: boolean },
): number[] {
  if (target < 5) return [];
  const base = maxLegsPerGame(target, currentCap);
  const ceiling = opts?.collegeTeamMarketStacks
    ? Math.min(target, Math.max(Math.ceil(target / 2), 5))
    : Math.min(target, Math.ceil(target / 2));
  if (base >= ceiling) return [];
  const out: number[] = [];
  for (let c = base + 1; c <= ceiling; c++) out.push(c);
  return out;
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

function normalizePlayerNameTokens(
  raw: string,
): string[] {
  return String(raw ?? "")
    .toLowerCase()
    .replace(/,/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

/** Surname / last token — aligns with propSideConsistency.normPlayer. */
export function propPlayerSurname(name: string): string {
  const parts = normalizePlayerNameTokens(name);
  return parts.length ? parts[parts.length - 1]! : "";
}

/**
 * Normalize player identity for same-player prop stacking.
 * Prefers athleteId; otherwise a stable name key. Matching across name forms
 * (Shohei Ohtani vs Ohtani vs S. Ohtani) is handled by {@link propPlayersMatch}.
 */
export function propPlayerKey(pick: {
  player?: string | null;
  pick?: string | null;
  athleteId?: string | null;
}): string {
  const athleteId = String(pick.athleteId ?? "").trim().toLowerCase();
  if (athleteId) return `id:${athleteId}`;
  const named = normalizePlayerNameTokens(String(pick.player ?? "")).join(" ");
  if (named) return named;
  // Fallback: first two tokens of the pick label ("Chase Meidroth Over…").
  const fromPick = String(pick.pick ?? "")
    .toLowerCase()
    .replace(/\b(over|under|o|u)\b.*$/i, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .join(" ");
  return fromPick;
}

/**
 * True when two prop legs refer to the same athlete despite display-name
 * variants ("Shohei Ohtani" / "Ohtani" / "S. Ohtani") or shared athleteId.
 */
export function propPlayersMatch(
  a: { player?: string | null; pick?: string | null; athleteId?: string | null },
  b: { player?: string | null; pick?: string | null; athleteId?: string | null },
): boolean {
  const aId = String(a.athleteId ?? "").trim().toLowerCase();
  const bId = String(b.athleteId ?? "").trim().toLowerCase();
  if (aId && bId) return aId === bId;

  const aKey = propPlayerKey({ ...a, athleteId: null });
  const bKey = propPlayerKey({ ...b, athleteId: null });
  if (!aKey || !bKey) return false;
  if (aKey === bKey) return true;

  const aSur = propPlayerSurname(aKey);
  const bSur = propPlayerSurname(bKey);
  if (!aSur || !bSur || aSur !== bSur) return false;

  // Same surname only. Unify display variants without collapsing distinct
  // athletes (J. Smith vs T. Smith must stay different).
  const aParts = normalizePlayerNameTokens(aKey);
  const bParts = normalizePlayerNameTokens(bKey);
  // Surname-only vs full name: "Ohtani" ⊆ "Shohei Ohtani".
  if (aParts.length === 1 || bParts.length === 1) return true;

  const aFirst = aParts[0]!;
  const bFirst = bParts[0]!;
  // Initial forms: "S Ohtani" ↔ "Shohei Ohtani"; "J Smith" ↛ "T Smith".
  if (aFirst.length === 1 && bFirst.length === 1) return aFirst === bFirst;
  if (aFirst.length === 1) return bFirst.startsWith(aFirst);
  if (bFirst.length === 1) return aFirst.startsWith(bFirst);
  return aKey.endsWith(` ${bKey}`) || bKey.endsWith(` ${aKey}`);
}

/**
 * Hard block: at most one player-prop leg per athlete on a ticket.
 * Phone: "9 leg tonight mixed sports" staged Chase Meidroth Hits + Total Bases
 * + Hits+Runs+RBIs — soft correlation wasn't enough. Also blocks Ohtani name
 * forms (Shohei Ohtani vs Ohtani) that previously bypassed exact-key equality.
 */
export function wouldRepeatPlayerProp(
  candidate: CorrelationPick,
  ticket: readonly CorrelationPick[],
): boolean {
  if (!candidate.isProp) return false;
  const key = propPlayerKey(candidate);
  if (!key) return false;
  return ticket.some((l) => l.isProp && propPlayersMatch(candidate, l));
}

/** Max player-prop legs from one matchup (separate from game-line cap). */
export function maxPropsPerGame(target: number): number {
  if (target >= 8) return 2;
  if (target >= 5) return 2;
  return 3;
}

export function countPropsForGame(
  ticket: readonly CorrelationPick[],
  game: string,
): number {
  const g = normGame(game);
  if (!g) return 0;
  return ticket.filter((l) => l.isProp && normGame(l.game) === g).length;
}

/**
 * Cap same-game prop stacks on mix tickets (White Sox @ Guardians × 5 props).
 * Does not apply to game lines — those use wouldExceedMaxLegsPerGame.
 */
export function wouldExceedMaxPropsPerGame(
  candidate: CorrelationPick,
  ticket: readonly CorrelationPick[],
  maxProps: number,
): boolean {
  if (!candidate.isProp) return false;
  if (maxProps >= 99) return false;
  return countPropsForGame(ticket, candidate.game) >= maxProps;
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
      const samePlayer = propPlayersMatch(leg, candidate);
      if (samePlayer) {
        penalty += 16;
        if (leg.market.toLowerCase() === candidate.market.toLowerCase()) penalty += 10;
      } else {
        // Base same-game different-player prop stack, plus Pass-TD↔receiver bump.
        penalty += 5 + passTdReceiverSoftBump(leg.market, candidate.market);
      }
      continue;
    }

    if (isGameSideLeg(leg) && isGameSideLeg(candidate)) {
      const sameLeg =
        leg.market.toLowerCase() === candidate.market.toLowerCase() &&
        leg.pick.toLowerCase() === candidate.pick.toLowerCase();
      if (sameLeg) {
        penalty += 22;
      } else if (sameTeamNearIdenticalLadder(leg, candidate)) {
        // Keep alt rungs as separate candidates, but do not fill a deep ask
        // with several nearly identical same-team ladder lines.
        penalty += 28;
      } else {
        penalty += 14;
      }
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
    const maxProps = maxPropsPerGame(ticketTarget);

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
      if (wouldRepeatPlayerProp(row.pick, onTicket)) continue;
      if (wouldExceedMaxPropsPerGame(row.pick, onTicket, maxProps)) continue;
      if (wouldRepeatMarketLadder(row.pick, onTicket)) continue;
      // P0: hard-block same-team FG/1H/2H team-total stacks (all sports).
      if (wouldStackSameTeamTeamTotals(row.pick, onTicket)) continue;
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

/**
 * Shared cross-sport single-event ticket seating framework.
 *
 * Activation: explicit team/game/event-scoped asks only.
 * Multi-event Coach behavior is unchanged (callers skip this path).
 *
 * Pure / in-memory — no network, no simulations, no awaits.
 */

import { isAltBoardPick, isAltPropPick } from "./altLinePool.ts";
import { askNamesTeamGame, coachAskTeamScope } from "./coachAskTeamScope.ts";
import { canonicalGameKey } from "./gameSimScoring.ts";
import { marketLadderKey } from "./marketLadderKey.ts";
import { propPlayerKey } from "./parlayCorrelationScore.ts";
// wouldRepeatPlayerProp / wouldRepeatMarketLadder identities are preserved via
// propPlayerKey + marketLadderKey Sets in the seat loop (same helpers).
import { isPeriodPropMarketKey } from "./propStats.ts";
import { explicitSingleGameIntent } from "./slate.ts";
import {
  getSportSeatingAdapter,
  isFamilySeatable,
  isGameEventFamily,
  isParticipantPropFamily,
  resolveMarketFamilyId,
  type SportSeatingAdapter,
} from "./sportSeatingAdapters.ts";

/**
 * Composition preferences for single-event tickets (not hard shortage ceilings).
 * When enough legitimate qualified selections exist, staging may seat up to N
 * even if that exceeds these preference ratios.
 */
export const SINGLE_EVENT_CAPS = {
  4: { maxProps: 3, maxGameEventLines: 3 },
  5: { maxProps: 4, maxGameEventLines: 3 },
  8: { maxProps: 6, maxGameEventLines: 4 },
  10: { maxProps: 8, maxGameEventLines: 5 },
} as const;

export type SingleEventLimitingRule =
  | "single_event_quality_pool_short"
  | "single_event_participant_cap"
  | "single_event_market_ladder_exhausted"
  | "single_event_game_line_family_exhausted"
  | "single_event_correlation_exhausted"
  | null;

export type SingleEventSeatCaps = {
  maxProps: number;
  maxGameEventLines: number;
};

export type SeatPick = {
  game: string;
  market: string;
  pick: string;
  odds?: number;
  isProp?: boolean;
  player?: string | null;
  propSide?: string | null;
  propIsAlt?: boolean;
  sport?: string | null;
  propLine?: number | null;
};

export type SingleEventSeatingContext = {
  active: boolean;
  eventKey: string | null;
  sport: string | null;
  target: number;
  caps: SingleEventSeatCaps | null;
  adapter: SportSeatingAdapter | null;
  activationReason: "explicit_single_game" | "team_game_scope" | null;
};

export function singleEventCapsForTarget(target: number): SingleEventSeatCaps {
  if (target >= 10) return { ...SINGLE_EVENT_CAPS[10] };
  if (target >= 8) return { ...SINGLE_EVENT_CAPS[8] };
  if (target >= 5) return { ...SINGLE_EVENT_CAPS[5] };
  if (target >= 4) return { ...SINGLE_EVENT_CAPS[4] };
  return { maxProps: Math.max(1, target), maxGameEventLines: Math.max(1, target) };
}

/**
 * Lift composition preferences into effective seat budgets when enough
 * legitimate selections exist. Pure — no I/O, no threshold weakening.
 *
 * - maxProps is a preference, not a hard shortage ceiling.
 * - maxGameEventLines must not force shortfall when GLs are unavailable
 *   and enough distinct qualified props remain.
 */
export function effectiveSingleEventCaps(opts: {
  target: number;
  preference?: SingleEventSeatCaps | null;
  /** Distinct seatable prop participants (one prop per player). */
  distinctQualifiedProps: number;
  /** Count of seatable game-event lines in the prepared pool. */
  availableGameEventLines: number;
}): SingleEventSeatCaps {
  const target = Math.max(0, opts.target);
  const pref = opts.preference ?? singleEventCapsForTarget(target);
  const propSlots = Math.max(0, opts.distinctQualifiedProps);
  const glSlots = Math.max(0, opts.availableGameEventLines);

  const preferredGlBudget = Math.min(pref.maxGameEventLines, glSlots);
  let maxProps = Math.min(target, Math.max(pref.maxProps, target - preferredGlBudget));
  maxProps = Math.min(maxProps, propSlots);

  let maxGameEventLines = Math.min(target, Math.max(pref.maxGameEventLines, target - maxProps));
  maxGameEventLines = Math.min(maxGameEventLines, glSlots);

  // Guarantee the pool can be used up to min(target, available) without a
  // preference-ratio artificial shortfall.
  const pool = propSlots + glSlots;
  const capacityTarget = Math.min(target, pool);
  if (maxProps + maxGameEventLines < capacityTarget) {
    maxProps = Math.min(propSlots, Math.max(maxProps, capacityTarget - maxGameEventLines));
    maxGameEventLines = Math.min(glSlots, Math.max(maxGameEventLines, capacityTarget - maxProps));
  }

  return {
    maxProps: Math.max(0, maxProps),
    maxGameEventLines: Math.max(0, maxGameEventLines),
  };
}

/**
 * Single-event mode activates ONLY for explicit team/game/event-scoped asks.
 * Loading a single game alone does NOT activate.
 */
export function shouldActivateSingleEventSeating(askText?: string | null): boolean {
  const t = String(askText ?? "").trim();
  if (!t) return false;
  if (explicitSingleGameIntent(t)) return true;
  if (askNamesTeamGame(t)) return true;
  if (coachAskTeamScope(t) != null) return true;
  return false;
}

export function resolveSingleEventSeatingContext(opts: {
  askText?: string | null;
  target: number;
  eventKey?: string | null;
  sport?: string | null;
}): SingleEventSeatingContext {
  const active = shouldActivateSingleEventSeating(opts.askText);
  if (!active) {
    return {
      active: false,
      eventKey: null,
      sport: null,
      target: opts.target,
      caps: null,
      adapter: null,
      activationReason: null,
    };
  }
  const reason: SingleEventSeatingContext["activationReason"] = explicitSingleGameIntent(
    opts.askText,
  )
    ? "explicit_single_game"
    : "team_game_scope";
  const sport = opts.sport ?? coachAskTeamScope(opts.askText)?.sport ?? null;
  return {
    active: true,
    // Keep the raw event label — canonicalize once at seat/compare time so
    // "Vikings @ Saints" → "vikings|saints" is not re-normalized to "vikings saints".
    eventKey: opts.eventKey ? String(opts.eventKey) : null,
    sport,
    target: opts.target,
    caps: singleEventCapsForTarget(opts.target),
    adapter: sport ? getSportSeatingAdapter(sport) : null,
    activationReason: reason,
  };
}

function isAltCandidate(p: SeatPick): boolean {
  return isAltPropPick(p) || isAltBoardPick(p) || !!p.propIsAlt;
}

function familyFor(adapter: SportSeatingAdapter, p: SeatPick): string | null {
  return resolveMarketFamilyId(adapter, p.market, {
    isProp: !!p.isProp,
    propIsAlt: !!p.propIsAlt || isAltPropPick(p),
  });
}

function countProps(ticket: readonly SeatPick[]): number {
  return ticket.filter((p) => p.isProp).length;
}

function countGameLines(ticket: readonly SeatPick[]): number {
  return ticket.filter((p) => !p.isProp).length;
}

function participantKey(p: SeatPick): string {
  return propPlayerKey(p);
}

type RankedSeat<T extends SeatPick> = { pick: T; rankScore: number };

export type SingleEventSeatResult<T extends SeatPick> = {
  picks: T[];
  limitingRule: SingleEventLimitingRule;
  caps: SingleEventSeatCaps;
  eventKey: string;
  sport: string;
};

type PreparedSeat<T extends SeatPick> = {
  row: RankedSeat<T>;
  fp: string;
  fam: string | null;
  participant: string;
  ladder: string;
  alt: boolean;
  isProp: boolean;
};

/**
 * Seat a single-event ticket from an already-scored candidate pool.
 * Preserves wouldRepeatPlayerProp + wouldRepeatMarketLadder; never fabricates.
 * Precomputes family/ladder maps once — O(C) prepare + O(C·T) seat (T≤10).
 */
export function seatSingleEventTicket<T extends SeatPick>(
  ranked: Array<RankedSeat<T>>,
  opts: {
    target: number;
    eventKey: string;
    sport: string;
    existing?: readonly T[];
  },
): SingleEventSeatResult<T> {
  const preferenceCaps = singleEventCapsForTarget(opts.target);
  const adapter = getSportSeatingAdapter(opts.sport);
  const eventKey = canonicalGameKey(opts.eventKey);
  const existing = opts.existing ?? [];
  const out: T[] = [...existing];
  let limitingRule: SingleEventLimitingRule = null;

  const prepared: PreparedSeat<T>[] = [];
  for (const row of ranked) {
    if (canonicalGameKey(row.pick.game) !== eventKey) continue;
    // Period player props are unsimulatable without periodTag series — never seat.
    if (row.pick.isProp && isPeriodPropMarketKey(row.pick.market)) continue;
    const fam = familyFor(adapter, row.pick);
    if (!isFamilySeatable(adapter, fam)) continue;
    if (row.pick.isProp && !adapter.supportsParticipantProps) continue;
    if (
      row.pick.isProp &&
      fam &&
      !isParticipantPropFamily(adapter, fam) &&
      !adapter.participantPropFamilies.has(fam)
    ) {
      continue;
    }
    if (
      !row.pick.isProp &&
      fam &&
      !isGameEventFamily(adapter, fam) &&
      !adapter.teamGameEventFamilies.has(fam) &&
      !adapter.periodFamilies.has(fam) &&
      !adapter.altFamilies.has(fam)
    ) {
      continue;
    }
    prepared.push({
      row,
      fp: `${eventKey}|${row.pick.market}|${row.pick.pick}|${row.pick.player ?? ""}`.toLowerCase(),
      fam,
      participant: row.pick.isProp ? participantKey(row.pick) : "",
      ladder: marketLadderKey(row.pick),
      alt: isAltCandidate(row.pick),
      isProp: !!row.pick.isProp,
    });
  }

  const distinctPropParticipants = new Set(
    prepared.filter((p) => p.isProp && p.participant).map((p) => p.participant),
  ).size;
  const availableGameEventLines = prepared.filter((p) => !p.isProp).length;
  const caps = effectiveSingleEventCaps({
    target: opts.target,
    preference: preferenceCaps,
    distinctQualifiedProps: distinctPropParticipants,
    availableGameEventLines,
  });

  if (!prepared.length) {
    return {
      picks: out.slice(0, opts.target),
      limitingRule: "single_event_quality_pool_short",
      caps,
      eventKey,
      sport: opts.sport,
    };
  }

  const usedFp = new Set(
    out.map((p) => `${canonicalGameKey(p.game)}|${p.market}|${p.pick}|${p.player ?? ""}`.toLowerCase()),
  );
  const usedLadders = new Set(out.map((p) => marketLadderKey(p)));
  const usedParticipants = new Set(
    out.filter((p) => p.isProp).map((p) => participantKey(p)).filter(Boolean),
  );
  const usedFamilies = new Set(
    out.map((p) => familyFor(adapter, p)).filter(Boolean) as string[],
  );
  let propCount = countProps(out);
  let glCount = countGameLines(out);

  while (out.length < opts.target) {
    let best: PreparedSeat<T> | null = null;
    let bestRank: [number, number, number, number] | null = null;
    let sawAny = false;
    let sawParticipantBlock = false;
    let sawLadderBlock = false;
    let sawPropCap = false;
    let sawGlCap = false;

    for (const cand of prepared) {
      if (usedFp.has(cand.fp)) continue;
      sawAny = true;

      if (cand.isProp && cand.participant && usedParticipants.has(cand.participant)) {
        sawParticipantBlock = true;
        continue;
      }
      if (usedLadders.has(cand.ladder)) {
        sawLadderBlock = true;
        continue;
      }
      // Sets above mirror wouldRepeatPlayerProp / wouldRepeatMarketLadder using
      // the same marketLadderKey + propPlayerKey identities (preserved helpers).

      if (cand.isProp) {
        if (propCount >= caps.maxProps) {
          sawPropCap = true;
          continue;
        }
      } else if (glCount >= caps.maxGameEventLines) {
        sawGlCap = true;
        continue;
      }

      const newParticipant =
        cand.isProp && cand.participant && !usedParticipants.has(cand.participant) ? 0 : 1;
      const newFamily = cand.fam && !usedFamilies.has(cand.fam) ? 0 : 1;
      const altLast = cand.alt ? 1 : 0;
      const rank: [number, number, number, number] = [
        newParticipant,
        newFamily,
        altLast,
        -cand.row.rankScore,
      ];
      if (
        !bestRank ||
        rank[0]! < bestRank[0]! ||
        (rank[0] === bestRank[0] && rank[1]! < bestRank[1]!) ||
        (rank[0] === bestRank[0] && rank[1] === bestRank[1] && rank[2]! < bestRank[2]!) ||
        (rank[0] === bestRank[0] &&
          rank[1] === bestRank[1] &&
          rank[2] === bestRank[2] &&
          rank[3]! < bestRank[3]!)
      ) {
        best = cand;
        bestRank = rank;
      }
    }

    if (!best) {
      if (!sawAny) limitingRule = "single_event_quality_pool_short";
      else if (sawPropCap && propCount >= caps.maxProps && glCount >= caps.maxGameEventLines) {
        limitingRule = "single_event_correlation_exhausted";
      } else if (sawGlCap && glCount >= caps.maxGameEventLines) {
        limitingRule = "single_event_game_line_family_exhausted";
      } else if (sawParticipantBlock && !sawLadderBlock) {
        limitingRule = "single_event_participant_cap";
      } else if (sawLadderBlock) {
        limitingRule = "single_event_market_ladder_exhausted";
      } else if (sawPropCap) {
        limitingRule = "single_event_correlation_exhausted";
      } else {
        limitingRule = "single_event_correlation_exhausted";
      }
      break;
    }

    usedFp.add(best.fp);
    usedLadders.add(best.ladder);
    if (best.isProp && best.participant) usedParticipants.add(best.participant);
    if (best.fam) usedFamilies.add(best.fam);
    if (best.isProp) propCount += 1;
    else glCount += 1;
    out.push(best.row.pick);
  }

  if (out.length < opts.target && limitingRule == null) {
    limitingRule = "single_event_quality_pool_short";
  }

  return {
    picks: out.slice(0, opts.target),
    limitingRule: out.length >= opts.target ? null : limitingRule,
    caps,
    eventKey,
    sport: opts.sport,
  };
}

/**
 * Infer the single event key from a scoped ask + candidate pool.
 * Prefers team-scope match; does NOT fall back to "only one game loaded".
 */
export function inferSingleEventKeyFromPool(
  askText: string | null | undefined,
  games: readonly string[],
): string | null {
  if (!games.length) return null;
  const scope = coachAskTeamScope(askText);
  if (scope) {
    const tokens = scope.matchTokens;
    const hit = games.find((g) => {
      const gl = g.toLowerCase();
      return tokens.some((t) => gl.includes(t));
    });
    // Return the pool's raw label (not pre-canonicalized) so seating can
    // canonicalize once against candidate game strings.
    if (hit) return hit;
  }
  const t = String(askText ?? "");
  const vs = t.match(
    /\bfor\s+([\w.&'’-]+(?:\s+[\w.&'’-]+){0,3})\s+(?:@|vs\.?|versus|at|against)\s+([\w.&'’-]+(?:\s+[\w.&'’-]+){0,3})/i,
  );
  if (vs) {
    const a = vs[1]!.toLowerCase();
    const b = vs[2]!.toLowerCase();
    const hit = games.find((g) => {
      const gl = g.toLowerCase();
      return gl.includes(a.split(/\s+/).pop()!) && gl.includes(b.split(/\s+/).pop()!);
    });
    if (hit) return hit;
  }
  return null;
}

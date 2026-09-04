// Normalized pick keys, cross-request novelty, and diversified ticket assembly.

import type { ParsedPick } from "../components/PickCard.tsx";
import type { PropPoolEntry } from "./api.ts";
import { canonicalGameKey, normalizedGamePickKey } from "./gameSimScoring.ts";
import { parlayCorrelationPenalty } from "./parlayCorrelationScore.ts";

const norm = (s: string) =>
  String(s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s.+-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

export type CoachDiversityTag = "REPEAT VALUE" | "LIMITED BOARD";

export type DiversityRejectionReason =
  | "duplicate"
  | "conflicting-side"
  | "same-player"
  | "same-game-limit"
  | "market-concentration"
  | "recent-pick";

/** 0 = strict, 3 = allow recent + concentration/same-game with labels. */
export type DiversityRelaxation = 0 | 1 | 2 | 3;

export function parsePickSideFromText(pick: string): string {
  const t = String(pick ?? "");
  if (/\bunder\b/i.test(t)) return "under";
  if (/\bover\b/i.test(t)) return "over";
  if (/\byes\b/i.test(t)) return "yes";
  if (/\bno\b/i.test(t)) return "no";
  return "";
}

export function parsePickLineFromText(pick: string): string {
  const m = String(pick ?? "").match(/([+-]?\d+(?:\.\d+)?)/);
  return m?.[1] ?? "";
}

/** sport + eventId + player + marketKey + line + side (or game-line equivalent). */
export function normalizedCoachPickKey(p: ParsedPick): string {
  const sport = norm(p.sport ?? "");
  const eventId = canonicalGameKey(p.game);
  const marketKey = norm(p.propMarketKey ?? p.market ?? "");
  const line =
    p.propLine != null && Number.isFinite(p.propLine)
      ? String(p.propLine)
      : parsePickLineFromText(p.pick);
  const side = norm(p.propSide ?? parsePickSideFromText(p.pick) ?? "");
  const player = norm(p.athleteId ?? p.player ?? "");
  if (player) {
    return `${sport}|${eventId}|${player}|${marketKey}|${line}|${side}`;
  }
  const gameLeg = normalizedGamePickKey(p.game, p.market, p.pick);
  return `${sport}|${eventId}|${marketKey}|${gameLeg}`;
}

export function normalizedCoachPickKeyFromPool(e: PropPoolEntry): string {
  return normalizedCoachPickKey({
    sport: e.sport,
    game: e.game,
    market: e.marketLabel,
    pick: `${e.player} ${e.side} ${e.line ?? ""} ${e.marketLabel}`,
    player: e.player,
    athleteId: e.athleteId,
    propMarketKey: e.marketKey,
    propLine: e.line,
    propSide: e.side,
    isProp: true,
    odds: e.odds,
  } as ParsedPick);
}

export function maxPicksPerGame(legTarget: number): number {
  if (legTarget <= 5) return 2;
  if (legTarget <= 9) return 3;
  return 4;
}

export function maxPicksPerMarket(legTarget: number): number {
  return Math.max(2, Math.floor(legTarget * 0.4));
}

export function playerIdentityKey(p: ParsedPick): string {
  return norm(p.athleteId ?? p.player ?? "");
}

export function marketFamilyKey(p: ParsedPick): string {
  return String(p.propMarketKey ?? p.market ?? "")
    .toLowerCase()
    .replace(/\+/g, "_")
    .replace(/\s+/g, " ")
    .trim();
}

export function teamKeysForPick(p: ParsedPick): string[] {
  const gk = canonicalGameKey(p.game);
  if (p.teamAbbr) return [`${gk}|${norm(p.teamAbbr)}`];
  const parts = p.game.split(/\s*@\s*/);
  if (parts.length === 2) {
    return parts.map((t) => `${gk}|${norm(t)}`);
  }
  return [gk];
}

function logCoachTicket(event: string, detail: Record<string, unknown>): void {
  if (typeof __DEV__ !== "undefined" && !__DEV__) return;
  console.log(`[coach-ticket] ${event}`, JSON.stringify(detail));
}

export function logDuplicateRejected(pick: ParsedPick): void {
  logCoachTicket("duplicate-rejected", { key: normalizedCoachPickKey(pick) });
}

export function logRecentPickRejected(pick: ParsedPick): void {
  logCoachTicket("recent-pick-rejected", { key: normalizedCoachPickKey(pick) });
}

export function logSameGameLimit(pick: ParsedPick, legTarget: number): void {
  logCoachTicket("same-game-limit", {
    game: pick.game,
    legTarget,
    key: normalizedCoachPickKey(pick),
  });
}

export function logMarketConcentrationLimit(pick: ParsedPick, legTarget: number): void {
  logCoachTicket("market-concentration-limit", {
    market: pick.market,
    legTarget,
    key: normalizedCoachPickKey(pick),
  });
}

export function logDiversityRelaxed(from: DiversityRelaxation, to: DiversityRelaxation, legTarget: number): void {
  logCoachTicket("diversity-relaxed", { from, to, legTarget });
}

export function conflictsWithTicket(
  pick: ParsedPick,
  ticket: readonly ParsedPick[],
): DiversityRejectionReason | null {
  const key = normalizedCoachPickKey(pick);
  const player = playerIdentityKey(pick);
  const market = marketFamilyKey(pick);
  const side = norm(pick.propSide ?? parsePickSideFromText(pick.pick));

  for (const on of ticket) {
    if (normalizedCoachPickKey(on) === key) return "duplicate";
    const onPlayer = playerIdentityKey(on);
    if (player && onPlayer && player === onPlayer) {
      if (pick.isProp || on.isProp) return "same-player";
      const onMarket = marketFamilyKey(on);
      const onSide = norm(on.propSide ?? parsePickSideFromText(on.pick));
      if (
        market &&
        onMarket &&
        market === onMarket &&
        side &&
        onSide &&
        side !== onSide
      ) {
        return "conflicting-side";
      }
    }
  }
  return null;
}

export function countPicksInGame(ticket: readonly ParsedPick[], game: string): number {
  const gk = canonicalGameKey(game);
  return ticket.filter((p) => canonicalGameKey(p.game) === gk).length;
}

export function countPicksForMarket(ticket: readonly ParsedPick[], market: string): number {
  const mk = norm(market);
  return ticket.filter((p) => marketFamilyKey(p) === mk).length;
}

export type PickDiversityVerdict = {
  ok: boolean;
  reason?: DiversityRejectionReason;
  tag?: CoachDiversityTag;
};

export function canAddPickToTicket(
  pick: ParsedPick,
  ticket: readonly ParsedPick[],
  legTarget: number,
  opts: {
    structureRelaxation?: 0 | 1 | 2;
    allowRecentRepeats?: boolean;
    allowMarketOverflow?: boolean;
    recentPickKeys?: Set<string>;
    sameTicketRepeat?: boolean;
    /** @deprecated use structureRelaxation */
    relaxation?: DiversityRelaxation;
  },
): PickDiversityVerdict {
  const structureRelaxation =
    opts.structureRelaxation ??
    (opts.relaxation != null && opts.relaxation >= 2 ? 2 : opts.relaxation === 1 ? 1 : 0);
  const allowRecentRepeats =
    opts.allowRecentRepeats ??
    (opts.sameTicketRepeat === true || (opts.relaxation ?? 0) >= 3);

  const hard = conflictsWithTicket(pick, ticket);
  if (hard === "duplicate") {
    logDuplicateRejected(pick);
    return { ok: false, reason: "duplicate" };
  }
  if (hard === "conflicting-side") {
    return { ok: false, reason: "conflicting-side" };
  }
  if (hard === "same-player" && structureRelaxation < 2) {
    return { ok: false, reason: "same-player" };
  }

  const gameCount = countPicksInGame(ticket, pick.game);
  if (gameCount >= maxPicksPerGame(legTarget)) {
    if (structureRelaxation < 2) {
      logSameGameLimit(pick, legTarget);
      return { ok: false, reason: "same-game-limit" };
    }
    return { ok: true, tag: "LIMITED BOARD" };
  }

  const marketCount = countPicksForMarket(ticket, marketFamilyKey(pick));
  if (marketCount >= maxPicksPerMarket(legTarget)) {
    if (!opts.allowMarketOverflow) {
      logMarketConcentrationLimit(pick, legTarget);
      return { ok: false, reason: "market-concentration" };
    }
    return { ok: true, tag: "LIMITED BOARD" };
  }

  const key = normalizedCoachPickKey(pick);
  if (opts.recentPickKeys?.has(key) && !opts.sameTicketRepeat && !allowRecentRepeats) {
    logRecentPickRejected(pick);
    return { ok: false, reason: "recent-pick" };
  }
  if (opts.recentPickKeys?.has(key) && !opts.sameTicketRepeat && allowRecentRepeats) {
    return { ok: true, tag: "REPEAT VALUE" };
  }

  return { ok: true };
}

export function ticketDiversityComponents(
  picks: readonly ParsedPick[],
  recentPickKeys?: Set<string>,
): {
  eventDiversity: number;
  teamDiversity: number;
  playerDiversity: number;
  marketDiversity: number;
  novelty: number;
  correlationRisk: number;
} {
  if (!picks.length) {
    return {
      eventDiversity: 0,
      teamDiversity: 0,
      playerDiversity: 0,
      marketDiversity: 0,
      novelty: 0,
      correlationRisk: 0,
    };
  }
  const games = new Set(picks.map((p) => canonicalGameKey(p.game)));
  const teams = new Set(picks.flatMap((p) => teamKeysForPick(p)));
  const players = new Set(
    picks.map((p) => playerIdentityKey(p)).filter((p) => p.length > 0),
  );
  const markets = new Set(picks.map((p) => marketFamilyKey(p)).filter((m) => m.length > 0));
  const recentHits = recentPickKeys
    ? picks.filter((p) => recentPickKeys.has(normalizedCoachPickKey(p))).length
    : 0;

  let correlationSum = 0;
  for (let i = 0; i < picks.length; i++) {
    for (let j = i + 1; j < picks.length; j++) {
      correlationSum += parlayCorrelationPenalty(picks[i]!, [picks[j]!]);
    }
  }
  const pairCount = (picks.length * (picks.length - 1)) / 2;
  const correlationRisk = pairCount ? correlationSum / pairCount : 0;

  return {
    eventDiversity: games.size / picks.length,
    teamDiversity: teams.size / Math.max(picks.length * 2, 1),
    playerDiversity: players.size / picks.length,
    marketDiversity: markets.size / picks.length,
    novelty: 1 - recentHits / picks.length,
    correlationRisk,
  };
}

export function coachTicketDiversityScore(
  picks: readonly ParsedPick[],
  recentPickKeys?: Set<string>,
): number {
  const c = ticketDiversityComponents(picks, recentPickKeys);
  return (
    c.eventDiversity * 34 +
    c.teamDiversity * 18 +
    c.playerDiversity * 28 +
    c.marketDiversity * 16 +
    c.novelty * 22 -
    c.correlationRisk * 12
  );
}

export function applyCoachDiversityTag(pick: ParsedPick, tag?: CoachDiversityTag): ParsedPick {
  if (!tag) return pick;
  return { ...pick, coachDiversityTag: tag };
}

/** Strip exact duplicates and conflicting sides — last-mile guard before delivery. */
export function dedupeTicketByNormalizedKey(picks: ParsedPick[]): ParsedPick[] {
  const out: ParsedPick[] = [];
  for (const pick of picks) {
    if (conflictsWithTicket(pick, out)) continue;
    out.push(pick);
  }
  return out;
}

export function ticketCoreOverlapRatio(
  a: readonly ParsedPick[],
  b: readonly ParsedPick[],
): number {
  if (!a.length || !b.length) return 0;
  const keysB = new Set(b.map((p) => normalizedCoachPickKey(p)));
  const overlap = a.filter((p) => keysB.has(normalizedCoachPickKey(p))).length;
  return overlap / Math.min(a.length, b.length);
}

export function dominantGameShare(picks: readonly ParsedPick[]): number {
  if (!picks.length) return 0;
  const counts = new Map<string, number>();
  for (const p of picks) {
    const gk = canonicalGameKey(p.game);
    counts.set(gk, (counts.get(gk) ?? 0) + 1);
  }
  const max = Math.max(...counts.values(), 0);
  return max / picks.length;
}

export function ticketReuseFromPriorRatio(
  candidateKeys: readonly string[],
  priorTicketKeys: readonly string[],
): number {
  if (!priorTicketKeys.length) return 0;
  const prior = new Set(priorTicketKeys);
  const overlap = candidateKeys.filter((k) => prior.has(k)).length;
  return overlap / priorTicketKeys.length;
}

export function capSameGameOnTicket(picks: ParsedPick[], legTarget: number): ParsedPick[] {
  const maxPerGame = maxPicksPerGame(legTarget);
  const counts = new Map<string, number>();
  const out: ParsedPick[] = [];
  for (const pick of picks) {
    const gk = canonicalGameKey(pick.game);
    const count = counts.get(gk) ?? 0;
    if (count >= maxPerGame) continue;
    counts.set(gk, count + 1);
    out.push(pick);
  }
  return out;
}

export function capMarketConcentrationOnTicket(picks: ParsedPick[], legTarget: number): ParsedPick[] {
  const maxPerMarket = maxPicksPerMarket(legTarget);
  const counts = new Map<string, number>();
  const out: ParsedPick[] = [];
  for (const pick of picks) {
    const mk = marketFamilyKey(pick);
    const count = counts.get(mk) ?? 0;
    if (count >= maxPerMarket) continue;
    counts.set(mk, count + 1);
    out.push(pick);
  }
  return out;
}

export function finalizeDiversifiedCoachTicket(
  picks: ParsedPick[],
  legTarget: number,
): ParsedPick[] {
  return capMarketConcentrationOnTicket(
    capSameGameOnTicket(dedupeTicketByNormalizedKey(picks), legTarget),
    legTarget,
  ).slice(0, legTarget);
}

export function dominantMarketShare(picks: readonly ParsedPick[]): number {
  if (!picks.length) return 0;
  const counts = new Map<string, number>();
  for (const p of picks) {
    const mk = marketFamilyKey(p);
    counts.set(mk, (counts.get(mk) ?? 0) + 1);
  }
  const max = Math.max(...counts.values(), 0);
  return max / picks.length;
}

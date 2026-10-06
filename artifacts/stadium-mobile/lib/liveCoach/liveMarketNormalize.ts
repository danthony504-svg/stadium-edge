/**
 * Normalize live game state + price records around ESPN eventId.
 * Phase 1: join + validate identity — no recommendations.
 */

import { classifyLivePriceFreshness } from "./liveFreshness.ts";
import { detectLiveGameStateAdvance } from "./liveGameStateAdvance.ts";
import { parseEndOfPeriodLabel } from "./remainingGameSim.ts";
import type {
  LiveGameStateRecord,
  LiveMarketStatus,
  LivePriceRecord,
  NormalizedLiveMarket,
} from "./types.ts";

export type LiveNormalizeIssue = {
  kind:
    | "missing_event_id"
    | "unknown_event_id"
    | "event_id_mismatch"
    | "name_only_join_rejected";
  message: string;
  eventId?: string | null;
  matchup?: string;
};

export type LiveNormalizeResult = {
  markets: NormalizedLiveMarket[];
  issues: LiveNormalizeIssue[];
};

/**
 * Join prices to game state by eventId only.
 * Rejects name-only joins when a reliable eventId exists on the board.
 */
export function normalizeLiveMarkets(opts: {
  games: LiveGameStateRecord[];
  prices: LivePriceRecord[];
  nowMs?: number;
  staleAfterMs?: number;
}): LiveNormalizeResult {
  const nowMs = opts.nowMs ?? Date.now();
  const byId = new Map<string, LiveGameStateRecord>();
  for (const g of opts.games) {
    const id = String(g.eventId ?? "").trim();
    if (!id) continue;
    byId.set(id, g);
  }

  const markets: NormalizedLiveMarket[] = [];
  const issues: LiveNormalizeIssue[] = [];

  for (const price of opts.prices) {
    const eventId = price.eventId != null ? String(price.eventId).trim() : "";
    if (!eventId) {
      issues.push({
        kind: "missing_event_id",
        message: `Price without eventId rejected (name-only join not allowed): ${price.matchup} ${price.market}`,
        eventId: null,
        matchup: price.matchup,
      });
      continue;
    }

    const game = byId.get(eventId);
    if (!game) {
      issues.push({
        kind: "unknown_event_id",
        message: `Price eventId=${eventId} has no matching live game state row`,
        eventId,
        matchup: price.matchup,
      });
      continue;
    }

    // Identity check: if price carries team names, they must match the event row.
    if (teamsConflict(game, price)) {
      issues.push({
        kind: "event_id_mismatch",
        message: `eventId=${eventId} team/matchup mismatch: game=${game.matchup} price=${price.matchup}`,
        eventId,
        matchup: price.matchup,
      });
      continue;
    }

    const freshness = classifyLivePriceFreshness({
      providerLastUpdate: price.providerLastUpdate,
      fetchedAt: price.fetchedAt,
      nowMs,
      staleAfterMs: opts.staleAfterMs,
    });

    const marketStatus = normalizeMarketStatus(price.marketStatus);
    const advance = detectLiveGameStateAdvance(game, price.quoteGameState ?? undefined);

    const unsafeReasons: string[] = [];
    // Period transitions: fetchedAt alone ≠ sportsbook sync with the board.
    // Keep ageMs from fetchedAt for display, but do not treat as trustworthy fresh.
    const inPeriodTransition = parseEndOfPeriodLabel(game.periodLabel) != null;
    const providerMissing =
      price.providerLastUpdate == null || String(price.providerLastUpdate).trim() === "";
    let freshnessStatus = freshness.status;
    if (inPeriodTransition && providerMissing && freshness.ageSource !== "providerLastUpdate") {
      freshnessStatus = "unknown";
      unsafeReasons.push("transition_unsynchronized_quote");
    }

    if (freshnessStatus === "stale") unsafeReasons.push("stale_price");
    if (freshnessStatus === "unknown") unsafeReasons.push("unknown_freshness");
    if (marketStatus === "suspended") unsafeReasons.push("suspended");
    if (marketStatus === "closed") unsafeReasons.push("closed");
    if (marketStatus === "unknown") unsafeReasons.push("unknown_market_status");
    if (advance.advanced) {
      unsafeReasons.push("game_state_advanced");
      unsafeReasons.push(...advance.reasons);
    }

    markets.push({
      eventId: game.eventId,
      sport: game.sport || price.sport,
      matchup: game.matchup,
      awayTeam: game.awayTeam,
      homeTeam: game.homeTeam,
      awayScore: game.awayScore,
      homeScore: game.homeScore,
      state: game.state,
      period: game.period,
      periodLabel: game.periodLabel,
      clock: game.clock,
      source: price.source,
      market: price.market,
      pick: price.pick,
      line: price.line,
      price: price.price,
      providerLastUpdate: price.providerLastUpdate,
      fetchedAt: price.fetchedAt,
      freshness: freshnessStatus,
      ageMs: freshness.ageMs,
      marketStatus,
      gameStateAdvanced: advance.advanced,
      unsafe: unsafeReasons.length > 0,
      unsafeReasons,
    });
  }

  // Log name-only temptation: game board has ids; reject any attempt that only had names.
  for (const g of opts.games) {
    if (!String(g.eventId ?? "").trim()) {
      issues.push({
        kind: "name_only_join_rejected",
        message: `Live game missing eventId — cannot normalize prices by name: ${g.matchup}`,
        eventId: null,
        matchup: g.matchup,
      });
    }
  }

  return { markets, issues };
}

function teamsConflict(game: LiveGameStateRecord, price: LivePriceRecord): boolean {
  const gAway = normTeam(game.awayTeam);
  const gHome = normTeam(game.homeTeam);
  // Price matchup "Away @ Home" — if parseable, must match.
  const parts = String(price.matchup ?? "").split(/\s+@\s+/);
  if (parts.length === 2) {
    const pAway = normTeam(parts[0]!);
    const pHome = normTeam(parts[1]!);
    if (pAway && pHome && gAway && gHome) {
      if (pAway !== gAway || pHome !== gHome) return true;
    }
  }
  return false;
}

function normTeam(s: string | null | undefined): string {
  return String(s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function normalizeMarketStatus(
  raw: LiveMarketStatus | string | null | undefined,
): LiveMarketStatus {
  const s = String(raw ?? "")
    .toLowerCase()
    .trim();
  if (s === "open") return "open";
  if (s === "suspended" || s === "suspend" || s === "locked") return "suspended";
  if (s === "closed" || s === "settled" || s === "final") return "closed";
  return "unknown";
}

/**
 * Build a LivePriceRecord from an enriched /sports/live-odds row,
 * stamping quoteGameState from the same payload for race detection.
 */
export function livePriceFromFeedRow(row: {
  eventId?: string | null;
  sport?: string;
  game?: string;
  market?: string;
  pick?: string;
  odds?: number;
  line?: number | null;
  source?: string | null;
  providerLastUpdate?: string | null;
  fetchedAt?: string | null;
  marketStatus?: string | null;
  awayScore?: number | null;
  homeScore?: number | null;
  period?: number | null;
  periodLabel?: string | null;
  clock?: string | null;
  state?: string | null;
}): LivePriceRecord {
  return {
    eventId: row.eventId != null ? String(row.eventId) : null,
    sport: String(row.sport ?? ""),
    matchup: String(row.game ?? ""),
    market: String(row.market ?? ""),
    pick: String(row.pick ?? ""),
    line: row.line ?? null,
    price: Number(row.odds),
    source: row.source ?? null,
    providerLastUpdate: row.providerLastUpdate ?? null,
    fetchedAt: row.fetchedAt ?? null,
    marketStatus: normalizeMarketStatus(row.marketStatus),
    quoteGameState: {
      awayScore: row.awayScore ?? null,
      homeScore: row.homeScore ?? null,
      period: row.period ?? null,
      periodLabel: row.periodLabel ?? null,
      clock: row.clock ?? null,
      state: row.state ?? undefined,
    },
  };
}

export function liveGameFromFeedRow(row: {
  eventId?: string | null;
  sport?: string;
  game?: string;
  awayTeam?: string | null;
  homeTeam?: string | null;
  awayScore?: number | null;
  homeScore?: number | null;
  state?: string | null;
  status?: string | null;
  period?: number | null;
  periodLabel?: string | null;
  clock?: string | null;
  fetchedAt?: string | null;
}): LiveGameStateRecord {
  const matchup = String(row.game ?? "");
  let awayTeam = String(row.awayTeam ?? "").trim();
  let homeTeam = String(row.homeTeam ?? "").trim();
  if ((!awayTeam || !homeTeam) && matchup.includes(" @ ")) {
    const [a, h] = matchup.split(/\s+@\s+/);
    awayTeam = awayTeam || String(a ?? "").trim();
    homeTeam = homeTeam || String(h ?? "").trim();
  }
  return {
    eventId: String(row.eventId ?? "").trim(),
    sport: String(row.sport ?? ""),
    awayTeam,
    homeTeam,
    matchup: matchup || `${awayTeam} @ ${homeTeam}`,
    awayScore: row.awayScore ?? null,
    homeScore: row.homeScore ?? null,
    state: String(row.state ?? row.status ?? "in"),
    period: row.period ?? null,
    periodLabel: row.periodLabel ?? null,
    clock: row.clock ?? null,
    fetchedAt: row.fetchedAt ?? null,
  };
}

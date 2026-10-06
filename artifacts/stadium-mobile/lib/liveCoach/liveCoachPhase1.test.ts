/**
 * Live Coach Phase 1 — board hygiene tests.
 * Run: node --import ./test/register-hooks.mjs --test lib/liveCoach/*.test.ts
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  wantsLiveCoachAsk,
  classifyLivePriceFreshness,
  LIVE_PRICE_STALE_AFTER_MS,
  normalizeLiveMarkets,
  livePriceFromFeedRow,
  liveGameFromFeedRow,
  detectLiveGameStateAdvance,
  materialClockAdvance,
  buildLiveBoardDiagnosticRows,
  formatLiveBoardDiagnosticsTable,
} from "./index.ts";
import type { LiveGameStateRecord, LivePriceRecord } from "./types.ts";

// ---------- Intent ----------

test("wantsLiveCoachAsk: pregame N-leg / sport N-leg stay false", () => {
  for (const ask of ["5 leg", "5 leg NFL", "7 leg MLB", "10 leg tonight", "build a 6 leg parlay"]) {
    assert.equal(wantsLiveCoachAsk(ask), false, ask);
  }
});

test("wantsLiveCoachAsk: explicit live phrasing is true", () => {
  for (const ask of [
    "live bets",
    "best live bets",
    "3 live NBA picks",
    "live NFL",
    "NBA live",
    "in-play parlays",
    "in progress bets",
    "give me live moneylines",
  ]) {
    assert.equal(wantsLiveCoachAsk(ask), true, ask);
  }
});

// ---------- Freshness ----------

test("freshness: fetchedAt within window → fresh", () => {
  const now = 1_700_000_000_000;
  const r = classifyLivePriceFreshness({
    fetchedAt: new Date(now - 10_000).toISOString(),
    providerLastUpdate: null,
    nowMs: now,
  });
  assert.equal(r.status, "fresh");
  assert.equal(r.ageSource, "fetchedAt");
  assert.ok(r.ageMs != null && r.ageMs >= 10_000);
});

test("freshness: fetchedAt older than stale window → stale", () => {
  const now = 1_700_000_000_000;
  const r = classifyLivePriceFreshness({
    fetchedAt: new Date(now - LIVE_PRICE_STALE_AFTER_MS - 1_000).toISOString(),
    nowMs: now,
  });
  assert.equal(r.status, "stale");
});

test("freshness: missing provider + missing fetchedAt → unknown (not fresh)", () => {
  const r = classifyLivePriceFreshness({
    providerLastUpdate: null,
    fetchedAt: null,
    nowMs: Date.now(),
  });
  assert.equal(r.status, "unknown");
  assert.equal(r.ageMs, null);
  assert.equal(r.ageSource, "none");
});

test("freshness: genuine providerLastUpdate preferred over fetchedAt", () => {
  const now = 1_700_000_000_000;
  const r = classifyLivePriceFreshness({
    providerLastUpdate: new Date(now - 5_000).toISOString(),
    fetchedAt: new Date(now - 120_000).toISOString(),
    nowMs: now,
  });
  assert.equal(r.ageSource, "providerLastUpdate");
  assert.equal(r.status, "fresh");
});

test("freshness: provider and fetchedAt remain distinct concepts", () => {
  const now = 1_700_000_000_000;
  const provider = new Date(now - 8_000).toISOString();
  const fetched = new Date(now - 2_000).toISOString();
  assert.notEqual(provider, fetched);
  const r = classifyLivePriceFreshness({
    providerLastUpdate: provider,
    fetchedAt: fetched,
    nowMs: now,
  });
  assert.equal(r.ageSource, "providerLastUpdate");
});

// ---------- Event identity join ----------

function sampleGame(over: Partial<LiveGameStateRecord> = {}): LiveGameStateRecord {
  return {
    eventId: "401772001",
    sport: "nba",
    awayTeam: "Boston Celtics",
    homeTeam: "New York Knicks",
    matchup: "Boston Celtics @ New York Knicks",
    awayScore: 88,
    homeScore: 92,
    state: "in",
    period: 3,
    periodLabel: "3rd Qtr",
    clock: "4:21",
    fetchedAt: "2026-10-06T01:00:00.000Z",
    ...over,
  };
}

function samplePrice(over: Partial<LivePriceRecord> = {}): LivePriceRecord {
  return {
    eventId: "401772001",
    sport: "nba",
    matchup: "Boston Celtics @ New York Knicks",
    market: "Moneyline",
    pick: "Knicks ML",
    line: null,
    price: -140,
    source: "espn_pickcenter",
    providerLastUpdate: null,
    fetchedAt: "2026-10-06T01:00:00.000Z",
    marketStatus: "open",
    quoteGameState: {
      awayScore: 88,
      homeScore: 92,
      period: 3,
      periodLabel: "3rd Qtr",
      clock: "4:21",
      state: "in",
    },
    ...over,
  };
}

test("event identity: joins on eventId", () => {
  const { markets, issues } = normalizeLiveMarkets({
    games: [sampleGame()],
    prices: [samplePrice()],
    nowMs: Date.parse("2026-10-06T01:00:05.000Z"),
  });
  assert.equal(markets.length, 1);
  assert.equal(markets[0]!.eventId, "401772001");
  assert.equal(markets[0]!.clock, "4:21");
  assert.equal(issues.filter((i) => i.kind === "missing_event_id").length, 0);
});

test("event identity: rejects missing eventId (no name-only join)", () => {
  const { markets, issues } = normalizeLiveMarkets({
    games: [sampleGame()],
    prices: [samplePrice({ eventId: null })],
  });
  assert.equal(markets.length, 0);
  assert.ok(issues.some((i) => i.kind === "missing_event_id"));
});

test("event identity: rejects unknown eventId", () => {
  const { markets, issues } = normalizeLiveMarkets({
    games: [sampleGame()],
    prices: [samplePrice({ eventId: "999" })],
  });
  assert.equal(markets.length, 0);
  assert.ok(issues.some((i) => i.kind === "unknown_event_id"));
});

test("event identity: rejects eventId/matchup mismatch", () => {
  const { markets, issues } = normalizeLiveMarkets({
    games: [sampleGame()],
    prices: [
      samplePrice({
        matchup: "Lakers @ Warriors",
      }),
    ],
  });
  assert.equal(markets.length, 0);
  assert.ok(issues.some((i) => i.kind === "event_id_mismatch"));
});

test("missing clock remains null/— and does not invent a clock", () => {
  const { markets } = normalizeLiveMarkets({
    games: [sampleGame({ clock: null })],
    prices: [
      samplePrice({
        quoteGameState: {
          awayScore: 88,
          homeScore: 92,
          period: 3,
          periodLabel: "3rd Qtr",
          clock: null,
          state: "in",
        },
      }),
    ],
    nowMs: Date.parse("2026-10-06T01:00:05.000Z"),
  });
  assert.equal(markets[0]!.clock, null);
  const diag = buildLiveBoardDiagnosticRows(markets);
  assert.equal(diag[0]!.clock, "—");
});

test("missing provider timestamp stays null; fetchedAt still usable", () => {
  const { markets } = normalizeLiveMarkets({
    games: [sampleGame()],
    prices: [samplePrice({ providerLastUpdate: null })],
    nowMs: Date.parse("2026-10-06T01:00:05.000Z"),
  });
  assert.equal(markets[0]!.providerLastUpdate, null);
  assert.equal(markets[0]!.fetchedAt, "2026-10-06T01:00:00.000Z");
  assert.equal(markets[0]!.freshness, "fresh");
});

// ---------- Race / advance ----------

test("game-state advance: score change marks unsafe", () => {
  const game = sampleGame({ awayScore: 90, homeScore: 92 });
  const price = samplePrice({
    quoteGameState: {
      awayScore: 88,
      homeScore: 92,
      period: 3,
      clock: "4:21",
      state: "in",
    },
  });
  const { markets } = normalizeLiveMarkets({
    games: [game],
    prices: [price],
    nowMs: Date.parse("2026-10-06T01:00:05.000Z"),
  });
  assert.equal(markets[0]!.gameStateAdvanced, true);
  assert.equal(markets[0]!.unsafe, true);
  assert.ok(markets[0]!.unsafeReasons.includes("away_score_changed"));
});

test("game-state advance: period change marks unsafe", () => {
  const adv = detectLiveGameStateAdvance(
    { awayScore: 88, homeScore: 92, period: 4, periodLabel: "4th", clock: "11:00", state: "in" },
    { awayScore: 88, homeScore: 92, period: 3, periodLabel: "3rd", clock: "0:12", state: "in" },
  );
  assert.equal(adv.advanced, true);
  assert.ok(adv.reasons.includes("period_changed"));
});

test("game-state advance: material clock countdown marks unsafe", () => {
  assert.equal(materialClockAdvance("8:42", "8:10"), true);
  assert.equal(materialClockAdvance("8:42", "8:40"), false);
  const adv = detectLiveGameStateAdvance(
    { awayScore: 88, homeScore: 92, period: 3, periodLabel: "3rd", clock: "3:50", state: "in" },
    { awayScore: 88, homeScore: 92, period: 3, periodLabel: "3rd", clock: "4:21", state: "in" },
  );
  assert.equal(adv.advanced, true);
  assert.ok(adv.reasons.includes("clock_advanced"));
});

test("suspended / closed / unknown market status → unsafe", () => {
  for (const status of ["suspended", "closed", "unknown"] as const) {
    const { markets } = normalizeLiveMarkets({
      games: [sampleGame()],
      prices: [samplePrice({ marketStatus: status })],
      nowMs: Date.parse("2026-10-06T01:00:05.000Z"),
    });
    assert.equal(markets[0]!.unsafe, true, status);
    assert.ok(
      markets[0]!.unsafeReasons.includes(status) ||
        markets[0]!.unsafeReasons.includes(`unknown_market_status`),
      status,
    );
  }
});

test("open + fresh + synced state is not game-state-advanced", () => {
  const { markets } = normalizeLiveMarkets({
    games: [sampleGame()],
    prices: [samplePrice({ marketStatus: "open" })],
    nowMs: Date.parse("2026-10-06T01:00:05.000Z"),
  });
  // marketStatus unknown default was changed — we set open.
  // unknown freshness avoided via fetchedAt.
  assert.equal(markets[0]!.gameStateAdvanced, false);
  assert.equal(markets[0]!.freshness, "fresh");
  // open status alone — still may be unsafe if marketStatus path; open clears that
  assert.equal(markets[0]!.marketStatus, "open");
  assert.equal(markets[0]!.unsafe, false);
});

// ---------- Diagnostics ----------

test("diagnostics table is read-only sync proof (not a recommendation)", () => {
  const { markets } = normalizeLiveMarkets({
    games: [sampleGame()],
    prices: [
      samplePrice(),
      samplePrice({
        market: "Spread",
        pick: "Knicks -3.5",
        line: -3.5,
        price: -110,
      }),
    ],
    nowMs: Date.parse("2026-10-06T01:00:05.000Z"),
  });
  const table = formatLiveBoardDiagnosticsTable(markets);
  assert.match(table, /eventId \| matchup \| score/);
  assert.match(table, /401772001/);
  assert.match(table, /88-92/);
  assert.match(table, /espn_pickcenter/);
  assert.doesNotMatch(table, /recommend|ticket|parlay/i);
});

test("livePriceFromFeedRow / liveGameFromFeedRow round-trip eventId join", () => {
  const game = liveGameFromFeedRow({
    eventId: "401",
    sport: "nfl",
    game: "Kansas City Chiefs @ Buffalo Bills",
    awayTeam: "Kansas City Chiefs",
    homeTeam: "Buffalo Bills",
    awayScore: 14,
    homeScore: 17,
    state: "in",
    period: 2,
    periodLabel: "Q2",
    clock: "6:00",
    fetchedAt: "2026-10-06T02:00:00.000Z",
  });
  const price = livePriceFromFeedRow({
    eventId: "401",
    sport: "nfl",
    game: "Kansas City Chiefs @ Buffalo Bills",
    market: "Total",
    pick: "Over 47.5",
    odds: -105,
    line: 47.5,
    source: "espn_pickcenter",
    fetchedAt: "2026-10-06T02:00:00.000Z",
    awayScore: 14,
    homeScore: 17,
    period: 2,
    clock: "6:00",
    state: "in",
  });
  const { markets } = normalizeLiveMarkets({
    games: [game],
    prices: [price],
    nowMs: Date.parse("2026-10-06T02:00:10.000Z"),
  });
  assert.equal(markets.length, 1);
  assert.equal(markets[0]!.line, 47.5);
  assert.equal(markets[0]!.eventId, "401");
});

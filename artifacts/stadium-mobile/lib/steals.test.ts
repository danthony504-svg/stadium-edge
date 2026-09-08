import assert from "node:assert/strict";
import { test } from "node:test";

import {
  americanToDecimal,
  formatCountdownSeconds,
  formatLastScanTime,
  formatOdds,
  formatPct,
  inStealBand,
  recordLabel,
  recordWinPct,
  stealScanIsComplete,
  stealScanLiveStats,
  stealScanStatsAreConsistent,
  STEAL_MAX_ODDS,
  STEAL_MIN_ODDS,
  trackRecordStatsFromHistory,
  type StealRecord,
} from "./steals.ts";

const rec = (over: Partial<StealRecord> = {}): StealRecord => ({
  wins: 0,
  losses: 0,
  pushes: 0,
  pending: 0,
  ungraded: 0,
  graded: 0,
  ...over,
});

test("inStealBand only accepts +500..+30000", () => {
  assert.equal(inStealBand(STEAL_MIN_ODDS), true);
  assert.equal(inStealBand(STEAL_MAX_ODDS), true);
  assert.equal(inStealBand(650), true);
  assert.equal(inStealBand(499), false);
  assert.equal(inStealBand(STEAL_MAX_ODDS + 1), false);
  assert.equal(inStealBand(-120), false);
  assert.equal(inStealBand(null), false);
  assert.equal(inStealBand(undefined), false);
});

test("formatOdds always signs positive American odds", () => {
  assert.equal(formatOdds(650), "+650");
  assert.equal(formatOdds(-120), "-120");
});

test("formatPct signs, rounds, and blanks null", () => {
  assert.equal(formatPct(12.37), "+12.4%");
  assert.equal(formatPct(-3), "-3%");
  assert.equal(formatPct(null), "");
  assert.equal(formatPct(undefined), "");
  assert.equal(formatPct(NaN), "");
});

test("recordWinPct counts only decided W/L, null when none", () => {
  assert.equal(recordWinPct(rec()), null); // nothing decided
  assert.equal(recordWinPct(rec({ pushes: 2, pending: 3 })), null); // no W/L
  assert.equal(recordWinPct(rec({ wins: 7, losses: 3 })), 70);
  assert.equal(recordWinPct(rec({ wins: 1, losses: 2, pushes: 5 })), 33.3);
});

test("recordLabel shows push only when present", () => {
  assert.equal(recordLabel(rec({ wins: 7, losses: 3 })), "7-3");
  assert.equal(recordLabel(rec({ wins: 7, losses: 3, pushes: 1 })), "7-3-1");
});

test("americanToDecimal", () => {
  assert.equal(americanToDecimal(100), 2);
  assert.equal(americanToDecimal(-100), 2);
  assert.equal(americanToDecimal(650), 7.5);
});

test("stealScanStatsAreConsistent rejects zero books with market counts", () => {
  assert.equal(
    stealScanStatsAreConsistent({
      booksScanned: 0,
      marketsChecked: 2184,
      longshotsAnalyzed: 117,
      stealsFound: 0,
      sportCounts: {},
      totalOpportunities: 0,
    }),
    false,
  );
  assert.equal(
    stealScanStatsAreConsistent({
      booksScanned: 12,
      marketsChecked: 2184,
      longshotsAnalyzed: 117,
      stealsFound: 0,
      sportCounts: {},
      totalOpportunities: 0,
      scanComplete: true,
    }),
    true,
  );
});

test("stealScanIsComplete honors scanComplete flag", () => {
  assert.equal(
    stealScanIsComplete({
      booksScanned: 12,
      marketsChecked: 100,
      longshotsAnalyzed: 10,
      stealsFound: 0,
      sportCounts: {},
      totalOpportunities: 0,
      scanComplete: true,
    }),
    true,
  );
  assert.equal(stealScanIsComplete(undefined, true), false);
});

test("trackRecordStatsFromHistory computes units and highest win", () => {
  const stats = trackRecordStatsFromHistory([
    { pick: "Team A ML", price: 650, status: "win" },
    { pick: "Player O 2.5", player: "Star Player", price: 900, status: "win" },
    { pick: "Team B ML", price: 700, status: "loss" },
  ]);
  assert.equal(stats.unitsWon, 15.5);
  assert.equal(stats.unitsLost, 1);
  assert.equal(stats.highestWinPick?.label, "Star Player");
  assert.equal(stats.highestWinPick?.price, 900);
  assert.equal(stats.avgOdds, 750);
});

test("stealScanLiveStats exposes backend counts and availability", () => {
  const stats = stealScanLiveStats(
    {
      booksScanned: 18,
      gamesScanned: 42,
      marketsChecked: 2100,
      longshotsAnalyzed: 90,
      stealsFound: 0,
      sportCounts: {},
      totalOpportunities: 0,
      scanComplete: true,
      scannedAt: "2026-06-28T12:00:00.000Z",
    },
    0,
    "2026-06-28T12:00:00.000Z",
  );
  assert.equal(stats.sportsbookCount, 18);
  assert.equal(stats.gameCount, 42);
  assert.equal(stats.marketCount, 2100);
  assert.equal(stats.available, true);
  assert.equal(stats.lastScanAt, "2026-06-28T12:00:00.000Z");
});

test("stealScanLiveStats marks unavailable when counts disagree", () => {
  const stats = stealScanLiveStats(
    {
      booksScanned: 0,
      marketsChecked: 2184,
      longshotsAnalyzed: 117,
      stealsFound: 0,
      sportCounts: {},
      totalOpportunities: 0,
      scanComplete: true,
    },
    0,
    null,
  );
  assert.equal(stats.available, false);
  assert.equal(stats.sportsbookCount, null);
  assert.equal(stats.marketCount, null);
});

test("formatLastScanTime and countdown helpers", () => {
  assert.equal(formatLastScanTime(null), "—");
  assert.equal(formatCountdownSeconds(0), "0s");
  assert.equal(formatCountdownSeconds(65), "1m 05s");
});

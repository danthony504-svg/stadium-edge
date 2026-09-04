import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildScanMeta,
  finalizeStealScanStats,
  STEAL_BOOKS_FALLBACK,
  tallyGameScan,
} from "../src/lib/liveStealsCore.ts";

test("finalizeStealScanStats never reports markets without a sportsbook count", () => {
  const gameTallies = [
    tallyGameScan([
      {
        id: "evt1",
        sport: "mlb",
        homeTeam: "A",
        awayTeam: "B",
        commenceTime: new Date(Date.now() + 3_600_000).toISOString(),
        markets: [
          {
            key: "h2h",
            outcomes: [
              { name: "B", price: 650, point: null },
              { name: "A", price: -180, point: null },
            ],
          },
        ],
      },
    ]),
  ];
  const stats = finalizeStealScanStats(gameTallies, { marketsChecked: 0, longshotsAnalyzed: 0 });
  assert.ok(stats.marketsChecked > 0);
  assert.equal(stats.booksScanned, STEAL_BOOKS_FALLBACK);
  assert.equal(stats.scanComplete, true);
});

test("finalizeStealScanStats returns zeros when nothing was scanned", () => {
  const stats = finalizeStealScanStats([], { marketsChecked: 0, longshotsAnalyzed: 0 });
  assert.equal(stats.marketsChecked, 0);
  assert.equal(stats.booksScanned, 0);
  assert.equal(stats.scanComplete, false);
});

test("buildScanMeta marks scanComplete from stats", () => {
  const meta = buildScanMeta([], [], {
    marketsChecked: 100,
    longshotsAnalyzed: 12,
    booksScanned: 9,
    scanComplete: true,
    gamesScanned: 24,
    scannedAt: "2026-06-28T12:00:00.000Z",
  });
  assert.equal(meta.scanComplete, true);
  assert.equal(meta.booksScanned, 9);
  assert.equal(meta.marketsChecked, 100);
  assert.equal(meta.gamesScanned, 24);
  assert.equal(meta.scannedAt, "2026-06-28T12:00:00.000Z");
});

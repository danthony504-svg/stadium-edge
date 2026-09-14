import assert from "node:assert/strict";
import test from "node:test";

import type { FantasyNflGameLog } from "./api.ts";
import {
  fantasyPointsFromRecordedNflGame,
  historicalFantasyAnalysis,
} from "./fantasyNflAnalysis.ts";

const game = (stats: Record<string, string>): FantasyNflGameLog => ({
  eventId: "1",
  date: "2025-09-01",
  opponent: "Opponent",
  isHome: true,
  stats,
});

test("fantasyPointsFromRecordedNflGame scores a recorded PPR receiving line", () => {
  const points = fantasyPointsFromRecordedNflGame(
    game({
      receptions: "5",
      receivingYards: "60",
      receivingTouchdowns: "1",
    }),
    "ppr",
  );
  assert.ok(points != null && points > 0);
});

test("historicalFantasyAnalysis returns nulls when no recorded games score", () => {
  const out = historicalFantasyAnalysis([game({})], "ppr");
  assert.equal(out.games, 0);
  assert.equal(out.recentAverage, null);
});

test("historicalFantasyAnalysis summarizes recent recorded games", () => {
  const out = historicalFantasyAnalysis(
    [
      game({ receptions: "4", receivingYards: "40", receivingTouchdowns: "0", receivingTargets: "6" }),
      game({ receptions: "6", receivingYards: "80", receivingTouchdowns: "1", receivingTargets: "8" }),
    ],
    "ppr",
  );
  assert.equal(out.games, 2);
  assert.ok(out.recentAverage != null);
  assert.ok(out.floor != null && out.ceiling != null);
});

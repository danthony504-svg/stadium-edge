import assert from "node:assert/strict";
import test from "node:test";

import type { HistoricalFantasyAnalysis } from "./fantasyNflAnalysis.ts";
import { fantasyRecommendation, selectFantasyStarter } from "./fantasyRecommendation.ts";
import type { FantasyRosterPlayer } from "./fantasyRoster.ts";

function analysis(overrides: Partial<HistoricalFantasyAnalysis> = {}): HistoricalFantasyAnalysis {
  return {
    recentAverage: 12,
    floor: 8,
    ceiling: 18,
    targetsPerGame: 6,
    carriesPerGame: 0,
    touchesPerGame: 6,
    games: 5,
    sourceInputs: {
      provider: "ESPN athlete gamelog",
      eventIds: ["1"],
      scoringFormat: "ppr",
    },
    ...overrides,
  };
}

test("fantasyRecommendation ranks recorded production", () => {
  const rec = fantasyRecommendation(analysis({ recentAverage: 15 }), "Active");
  assert.ok(rec.score != null && rec.score > 0);
  assert.match(rec.reason, /recorded|Ranked/i);
});

test("selectFantasyStarter picks eligible player with best recommendation", () => {
  const players: FantasyRosterPlayer[] = [
    {
      athleteId: "a",
      name: "A",
      team: "NO",
      position: "WR",
      headshot: null,
      rosterSlot: "WR",
      dateAdded: 1,
    },
    {
      athleteId: "b",
      name: "B",
      team: "ATL",
      position: "WR",
      headshot: null,
      rosterSlot: "Bench",
      dateAdded: 2,
    },
  ];
  const byId = {
    a: analysis({ recentAverage: 10 }),
    b: analysis({ recentAverage: 16 }),
  };
  const pick = selectFantasyStarter(players, "WR", byId, {});
  assert.equal(pick.winner?.player.athleteId, "b");
});

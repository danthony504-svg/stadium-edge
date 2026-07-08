import assert from "node:assert/strict";
import { test } from "node:test";
import { selectSoccerScorerGkPropEntries } from "./soccerScorerGkPicks.ts";
import type { PropPoolEntry } from "./api.ts";

test("selectSoccerScorerGkPropEntries prioritizes anytime goal over extreme SOT alts", () => {
  const pool: PropPoolEntry[] = [
    {
      sport: "soccer",
      game: "Morocco @ France",
      marketLabel: "Anytime Goal",
      player: "Kylian Mbappe",
      line: null,
      side: "Over",
      odds: 180,
      marketKey: "player_goal_scorer_anytime",
      startsAt: "2026-07-09T20:00:00Z",
    },
    {
      sport: "soccer",
      game: "Morocco @ France",
      marketLabel: "Shots on Target",
      player: "Kylian Mbappe",
      line: 4.5,
      side: "Over",
      odds: 850,
      marketKey: "player_shots_on_target",
      startsAt: "2026-07-09T20:00:00Z",
    },
    {
      sport: "soccer",
      game: "Morocco @ France",
      marketLabel: "Anytime Goal",
      player: "Ousmane Dembele",
      line: null,
      side: "Over",
      odds: 320,
      marketKey: "player_goal_scorer_anytime",
      startsAt: "2026-07-09T20:00:00Z",
    },
  ];
  const selected = selectSoccerScorerGkPropEntries(pool);
  assert.ok(selected.length >= 2);
  assert.equal(selected[0]?.marketKey, "player_goal_scorer_anytime");
  assert.equal(selected[0]?.player, "Kylian Mbappe");
  assert.ok(!selected.some((e) => e.line === 4.5));
});

import assert from "node:assert/strict";
import test from "node:test";

import type { ParsedPick } from "../components/PickCard.tsx";
import {
  footballMixSimFamily,
  selectFootballMixPropSimCandidates,
} from "./boardPropSimExpansion.ts";
import { boardScanMaxPropsToSimForMix } from "./boardScanScope.ts";
import { gameValueForMarket } from "./propStats.ts";

function pick(
  market: string,
  player: string,
  line = 0.5,
): ParsedPick {
  return {
    game: "Away @ Home",
    market,
    propMarketKey: market,
    pick: `${player} Over ${line}`,
    odds: -110,
    isProp: true,
    player,
    propLine: line,
    propSide: "Over",
    sport: "nfl",
  } as ParsedPick;
}

test("footballMixSimFamily buckets yards vs TD vs volume", () => {
  assert.equal(footballMixSimFamily({ propMarketKey: "player_pass_yds" }), "yards");
  assert.equal(footballMixSimFamily({ propMarketKey: "player_rush_yds" }), "yards");
  assert.equal(footballMixSimFamily({ propMarketKey: "player_reception_yds" }), "yards");
  assert.equal(footballMixSimFamily({ propMarketKey: "player_anytime_td" }), "td");
  assert.equal(footballMixSimFamily({ propMarketKey: "player_first_td" }), "td");
  assert.equal(footballMixSimFamily({ propMarketKey: "player_receptions" }), "volume");
});

test("phone PROP_ALL_NO_SIM_GRADE rebuild: mix candidacy forces yards into deep-sim set", () => {
  // 500 anytime TD rows would previously consume the entire deep-sim cap.
  const tds = Array.from({ length: 500 }, (_, i) =>
    pick("player_anytime_td", `TdPlayer${i}`, 0.5),
  );
  const yards = Array.from({ length: 200 }, (_, i) =>
    pick(
      i % 3 === 0
        ? "player_pass_yds"
        : i % 3 === 1
          ? "player_rush_yds"
          : "player_reception_yds",
      `YdPlayer${i}`,
      75.5 + (i % 10),
    ),
  );
  const ranked = [...tds, ...yards];
  const maxToSim = boardScanMaxPropsToSimForMix(10, ranked.length);
  const { selected, familyCounts } = selectFootballMixPropSimCandidates(
    ranked,
    maxToSim,
  );
  assert.ok(selected.length <= maxToSim);
  assert.ok(
    familyCounts.yards >= 48,
    `expected yards quota, got ${familyCounts.yards}`,
  );
  assert.ok(familyCounts.td > 0, "TD still represented");
  assert.ok(
    selected.some((p) => /pass_yds|rush_yds|reception_yds/.test(p.propMarketKey ?? "")),
    "yards markets must appear in deep-sim set",
  );
});

test("player_anytime_td / first_td map to real rush+rec+pass TD columns", () => {
  const none = new Set<string>();
  const wr = {
    rushingTouchdowns: "0",
    receivingTouchdowns: "1",
    passingTouchdowns: "0",
  };
  assert.equal(gameValueForMarket("player_anytime_td", wr, none), 1);
  assert.equal(gameValueForMarket("player_first_td", wr, none), 1);
  const qb = {
    rushingTouchdowns: "0",
    receivingTouchdowns: "0",
    passingTouchdowns: "2",
  };
  assert.equal(gameValueForMarket("player_anytime_td", qb, none), 2);
  assert.equal(gameValueForMarket("player_anytime_td", {}, none), null);
});

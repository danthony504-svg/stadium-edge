import assert from "node:assert/strict";
import test from "node:test";

import type { ParsedPick } from "../components/PickCard.tsx";
import {
  boardPropSimMixBatchSize,
  footballMixSimFamily,
  selectFootballMixPropSimCandidates,
  shouldUseFootballSkillPropSim,
} from "./boardPropSimExpansion.ts";
import { boardScanMaxPropsToSimForMix } from "./boardScanScope.ts";
import { gameValueForMarket } from "./propStats.ts";

function pick(
  market: string,
  player: string,
  line = 0.5,
  opts?: { athleteId?: string | null; sport?: string },
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
    sport: opts?.sport ?? "nfl",
    athleteId: opts?.athleteId ?? null,
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
  assert.ok(maxToSim <= 96, "mix deep-sim set must stay finishable");
  const { selected, familyCounts } = selectFootballMixPropSimCandidates(
    ranked,
    maxToSim,
  );
  assert.ok(selected.length <= maxToSim);
  assert.ok(
    familyCounts.yards >= 12,
    `expected yards quota, got ${familyCounts.yards}`,
  );
  assert.ok(familyCounts.td > 0, "TD still represented");
  assert.ok(
    selected.some((p) => /pass_yds|rush_yds|reception_yds/.test(p.propMarketKey ?? "")),
    "yards markets must appear in deep-sim set",
  );
});

test("finishable mix set fits a few wide batches under the mix deadline", () => {
  const maxToSim = boardScanMaxPropsToSimForMix(10, 11_840);
  const batch = boardPropSimMixBatchSize(10);
  const batchesNeeded = Math.ceil(maxToSim / batch);
  assert.ok(batchesNeeded <= 3, `expected ≤3 batches for ${maxToSim} rows @ ${batch}, got ${batchesNeeded}`);
  assert.ok(batchesNeeded * 18_000 < 75_000, "worst-case batch timeouts must fit mix deadline");
});

test("phone PROP_ALL_NO_SIM_GRADE: props-only NFL uses football skill sim path", () => {
  // "9 leg NFL player props" — propsOnly, not requirePropMix.
  assert.equal(
    shouldUseFootballSkillPropSim({
      propsOnly: true,
      pool: Array.from({ length: 20 }, () => ({ sport: "nfl" })),
    }),
    true,
  );
  assert.equal(
    shouldUseFootballSkillPropSim({
      propsOnly: true,
      pool: Array.from({ length: 20 }, () => ({ sport: "mlb" })),
    }),
    false,
  );
  assert.equal(
    shouldUseFootballSkillPropSim({
      requirePropMix: true,
      pool: [{ sport: "nba" }],
    }),
    true,
  );
  const maxToSim = boardScanMaxPropsToSimForMix(9, 4704);
  assert.ok(maxToSim <= 96, "must not deep-sim 500 generic rows on props-only NFL");
  assert.ok(maxToSim < 500);
});

test("football skill candidacy prefers athleteId rows (local enrich can grade)", () => {
  const ranked = [
    ...Array.from({ length: 40 }, (_, i) =>
      pick("player_pass_yds", `NoId${i}`, 220.5, { athleteId: null }),
    ),
    ...Array.from({ length: 20 }, (_, i) =>
      pick("player_pass_yds", `WithId${i}`, 225.5, { athleteId: `id-${i}` }),
    ),
    ...Array.from({ length: 30 }, (_, i) =>
      pick("player_anytime_td", `Td${i}`, 0.5, { athleteId: i < 10 ? `td-${i}` : null }),
    ),
  ];
  const { selected } = selectFootballMixPropSimCandidates(ranked, 48);
  const yards = selected.filter((p) => /pass_yds/.test(p.propMarketKey ?? ""));
  assert.ok(yards.length > 0);
  const withId = yards.filter((p) => !!p.athleteId).length;
  assert.ok(
    withId >= Math.min(20, yards.length),
    `expected athleteId yards first, got ${withId}/${yards.length}`,
  );
  // First yards slots should be the athleteId cohort.
  assert.ok(!!yards[0]?.athleteId, "first yards candidate must have athleteId");
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

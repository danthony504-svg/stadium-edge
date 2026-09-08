import assert from "node:assert/strict";
import test from "node:test";

import { MARKETS_BY_SPORT, coreMarketsForSport } from "../src/routes/props.ts";

const PASSING = ["player_pass_yds", "player_pass_attempts", "player_pass_completions", "player_pass_tds", "player_pass_interceptions", "player_pass_longest_completion"];
const RUSHING = ["player_rush_yds", "player_rush_attempts", "player_rush_longest"];
const RECEIVING = ["player_reception_yds", "player_receptions", "player_reception_longest"];

const familiesIn = (markets: string[]) => ({
  passing: markets.filter((m) => PASSING.includes(m)),
  rushing: markets.filter((m) => RUSHING.includes(m)),
  receiving: markets.filter((m) => RECEIVING.includes(m)),
});

for (const sport of ["nfl", "ncaaf"]) {
  test(`${sport} degraded fallback covers passing, rushing and receiving`, () => {
    const core = coreMarketsForSport(sport, MARKETS_BY_SPORT[sport]!);
    const fam = familiesIn(core);
    assert.ok(fam.passing.length >= 1, `no passing market in ${sport} core: ${core.join(", ")}`);
    assert.ok(fam.rushing.length >= 1, `no rushing market in ${sport} core: ${core.join(", ")}`);
    assert.ok(fam.receiving.length >= 1, `no receiving market in ${sport} core: ${core.join(", ")}`);
  });

  test(`${sport} degraded fallback is not passing-only`, () => {
    const core = coreMarketsForSport(sport, MARKETS_BY_SPORT[sport]!);
    assert.ok(core.length > 0);
    assert.ok(
      core.some((m) => !PASSING.includes(m)),
      `${sport} core degraded to passing-only: ${core.join(", ")}`,
    );
  });

  test(`${sport} degraded fallback only requests markets from the full list`, () => {
    const full = MARKETS_BY_SPORT[sport]!;
    const core = coreMarketsForSport(sport, full);
    for (const m of core) assert.ok(full.includes(m), `${m} is not a posted ${sport} market`);
  });

  test(`${sport} degraded fallback stays narrower than the full batch`, () => {
    const full = MARKETS_BY_SPORT[sport]!;
    const core = coreMarketsForSport(sport, full);
    assert.ok(core.length < full.length, `${sport} core must be narrower so the retry is meaningful`);
  });
}

test("full football market lists still carry every expanded market", () => {
  const expanded = [
    "player_pass_attempts",
    "player_pass_completions",
    "player_pass_interceptions",
    "player_pass_longest_completion",
    "player_rush_attempts",
    "player_rush_longest",
    "player_reception_longest",
  ];
  for (const sport of ["nfl", "ncaaf"]) {
    for (const m of expanded) {
      assert.ok(MARKETS_BY_SPORT[sport]!.includes(m), `${sport} full list lost ${m}`);
    }
  }
});

test("non-football sports keep the positional leading slice", () => {
  for (const sport of ["nba", "wnba", "mlb", "nhl", "ncaab", "soccer"]) {
    const full = MARKETS_BY_SPORT[sport]!;
    assert.deepEqual(coreMarketsForSport(sport, full), full.slice(0, Math.min(4, full.length)));
  }
});

test("a sport whose core keys are absent falls back to the positional slice", () => {
  const trimmed = ["player_pass_yds", "player_pass_tds"];
  assert.deepEqual(coreMarketsForSport("nfl", trimmed), trimmed);
});

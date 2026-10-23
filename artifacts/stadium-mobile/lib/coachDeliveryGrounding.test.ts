/**
 * Incident-derived fixtures for the delivery grounding gate.
 * Original greenfield asks/candidates were unavailable — synthetic tickets only.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import type { ParsedPick } from "../components/PickCard.tsx";
import {
  applyDeliveryGroundingGate,
  filterPicksForPlayerGameGrounding,
} from "./coachDeliveryGrounding.ts";

function prop(
  overrides: Partial<ParsedPick> & Pick<ParsedPick, "game" | "teamAbbr" | "player">,
): ParsedPick {
  return {
    market: "Hits",
    pick: "Over 0.5",
    odds: -110,
    isProp: true,
    propMarketKey: "batter_hits",
    sport: "mlb",
    ...overrides,
  };
}

test("incident-derived: proven mismatch and unknown player team both excluded", () => {
  const picks = [
    prop({
      game: "Rays @ Guardians",
      teamAbbr: "TB",
      player: "Junior Caminero",
    }),
    prop({
      game: "Rays @ Guardians",
      teamAbbr: "NYY",
      player: "Aaron Judge",
    }),
    prop({
      game: "Rays @ Guardians",
      teamAbbr: "",
      player: "Unknown Player",
    }),
  ];
  const kept = filterPicksForPlayerGameGrounding(picks);
  assert.equal(kept.length, 1);
  assert.equal(kept[0]!.player, "Junior Caminero");
});

test("incident-derived: replace only with grounded qualified candidates; honest shortfall", () => {
  const picks = [
    prop({
      game: "Rays @ Guardians",
      teamAbbr: "TB",
      player: "Junior Caminero",
    }),
    prop({
      game: "Rays @ Guardians",
      teamAbbr: "NYY",
      player: "Aaron Judge",
    }),
  ];
  const qualified = [
    prop({
      game: "Rays @ Guardians",
      teamAbbr: "CLE",
      player: "Jose Ramirez",
      market: "Hits",
      pick: "Over 1.5",
    }),
    prop({
      game: "Rays @ Guardians",
      teamAbbr: "BOS",
      player: "Rafael Devers",
      market: "Hits",
      pick: "Over 0.5",
    }),
  ];
  const result = applyDeliveryGroundingGate({
    picks,
    qualifiedCandidates: qualified,
    target: 3,
  });
  assert.equal(result.removedCount, 1);
  assert.equal(result.replacedCount, 1);
  assert.equal(result.picks.length, 2);
  assert.equal(result.shortfall, 1);
  assert.ok(result.picks.every((p) => p.teamAbbr !== "NYY"));
  assert.ok(result.picks.some((p) => p.player === "Jose Ramirez"));
  assert.ok(!result.picks.some((p) => p.player === "Rafael Devers"));
  assert.equal(result.affectedGame, "Rays @ Guardians");
});

test("buildParlay wires delivery grounding after final belts", async () => {
  const { readFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const src = readFileSync(join(process.cwd(), "lib/coach/buildParlay.ts"), "utf8");
  assert.match(src, /applyDeliveryGroundingGate/);
  assert.match(src, /revalidateCoachTerminalDeliveryPicks/);
  // Props-only keeps applyDeliveryGroundingGate; mixed uses shared revalidate
  // (started / quality / grounding incl. ALT) after final slate belts.
  const gateHits = src.match(/applyDeliveryGroundingGate/g) ?? [];
  assert.ok(gateHits.length >= 2, "import + props-only wire sites");
  const propsBelt = src.indexOf(
    "picks = filterPicksForCoachAskTeams(picks, inputs.teamScope, inputs.excludedTeams);",
  );
  const propsGate = src.indexOf("qualifiedCandidates: [],");
  assert.ok(propsBelt > 0 && propsGate > propsBelt, "props-only gate after team belt");
  const mixedSportBelt = src.lastIndexOf(
    "picks = filterPicksByAllowedSports(picks, askSportScope, inputs.espnGames);",
  );
  const mixedGate = src.lastIndexOf("revalidateCoachTerminalDeliveryPicks");
  assert.ok(
    mixedSportBelt > 0 && mixedGate > mixedSportBelt,
    "mixed revalidate after sport belt",
  );
});

test("formatting-only name on grounded TB leg is not stripped; verified mismatch is", () => {
  const picks = [
    prop({
      game: "Rays @ Guardians",
      teamAbbr: "TB",
      player: "J. Caminero",
    }),
    prop({
      game: "Rays @ Guardians",
      teamAbbr: "NYY",
      player: "Aaron Judge",
    }),
    prop({
      game: "Rays @ Guardians",
      teamAbbr: "CLE",
      player: "José Ramírez",
    }),
  ];
  const result = applyDeliveryGroundingGate({
    picks,
    qualifiedCandidates: [],
    target: 3,
  });
  assert.equal(result.removedCount, 1);
  assert.equal(result.picks.length, 2);
  assert.equal(result.shortfall, 1);
  assert.ok(result.picks.some((p) => p.player === "J. Caminero"));
  assert.ok(result.picks.some((p) => p.player === "José Ramírez"));
  assert.ok(!result.picks.some((p) => p.teamAbbr === "NYY"));
});

test("NFL Buccaneers TB kept; MLB Rays on NFL game stripped", () => {
  const picks = [
    prop({
      game: "Tampa Bay Buccaneers @ Atlanta Falcons",
      teamAbbr: "TB",
      player: "Baker Mayfield",
      market: "Pass Yds",
      propMarketKey: "player_pass_yds",
      sport: "nfl",
    }),
    prop({
      game: "Tampa Bay Buccaneers @ Atlanta Falcons",
      teamAbbr: "TB",
      player: "Yandy Diaz",
      market: "Hits",
      propMarketKey: "batter_hits",
      sport: "mlb",
    }),
  ];
  const result = applyDeliveryGroundingGate({
    picks,
    qualifiedCandidates: [],
    target: 2,
  });
  assert.equal(result.removedCount, 1);
  assert.equal(result.picks.length, 1);
  assert.equal(result.picks[0]!.player, "Baker Mayfield");
});

test("NHL prop missing team evidence is excluded even with a plausible game", () => {
  const bad = prop({ game: "Columbus Blue Jackets @ Minnesota Wild", teamAbbr: "", player: "Quinn Hughes", sport: "nhl", market: "Points", propMarketKey: "player_points" });
  const valid = prop({ game: "Columbus Blue Jackets @ Minnesota Wild", teamAbbr: "MIN", player: "Verified Player", sport: "nhl", market: "Points", propMarketKey: "player_points", pick: "Over 1.5" });
  const out = applyDeliveryGroundingGate({picks:[bad],qualifiedCandidates:[valid],target:1});
  assert.equal(out.removedCount,1);
  assert.equal(out.replacedCount,1);
  assert.equal(out.picks[0]?.player,"Verified Player");
});

// Anonymous fixtures reproduce the final-refill fault without production data.
for (const sport of ["nba", "wnba", "ncaab", "nfl", "ncaaf", "mlb", "nhl", "soccer", "tennis", "ufc"]) {
  test(`${sport}: final refill cannot bypass ladder, athlete or same-game prop limits`, () => {
    const seat = (player: string, line: number, game = "Away @ Home") => prop({
      sport, player, game, teamAbbr: "HOME", market: "Points", propMarketKey: "player_points",
      propSide: "Over", propLine: line, pick: `${player} Over ${line} Points`,
    });
    const first = seat("Player A", 8.5);
    const duplicate = seat("Player A", 18.5);
    const otherStat = { ...seat("Player A", 1.5), market: "Assists", propMarketKey: "player_assists" };
    const second = seat("Player B", .5);
    const excess = seat("Player C", 9.5);
    const independent = seat("Player D", 10.5, "Other Away @ Other Home");
    const reasons: string[] = [];
    const result = applyDeliveryGroundingGate({
      picks: [first, duplicate, otherStat, second, excess],
      qualifiedCandidates: [duplicate, otherStat, excess, independent], target: 5,
      onRejected: (_p, reason) => reasons.push(reason),
    });
    assert.deepEqual(result.picks.map(p => p.player), ["Player A", "Player B", "Player D"]);
    assert.equal(result.shortfall, 2);
    assert.ok(reasons.includes("duplicate_market_ladder"));
    assert.ok(reasons.includes("same_player_exposure"));
    assert.ok(reasons.includes("same_game_prop_cap"));
  });
}

test("final refill enforces opposite-side conflicts and preserves explicit game-line caps", () => {
  const leg = (pick: string, market = "Spread") => ({ game: "Dallas Cowboys @ New York Giants", market, pick, odds: -110 });
  const result = applyDeliveryGroundingGate({ picks: [leg("Cowboys -3.5")],
    qualifiedCandidates: [leg("Giants +3.5"), leg("Cowboys ML", "Moneyline"), leg("Over 40.5", "Total")],
    target: 5, legsPerGameCap: 1 });
  assert.equal(result.picks.length, 1);
});

test("provider athlete identity blocks display aliases without conflating sports", () => {
  const base = prop({ game: "Away @ Home", teamAbbr: "HOME", player: "Full Player", athleteId: "42", sport: "nba" });
  const alias = { ...base, player: "F. Player", market: "Assists", propMarketKey: "player_assists" };
  const otherSport = { ...alias, sport: "wnba", game: "Other Away @ Other Home" };
  const result = applyDeliveryGroundingGate({ picks: [base], qualifiedCandidates: [alias, otherSport], target: 5 });
  assert.deepEqual(result.picks.map(p => p.sport), ["nba", "wnba"]);
});

test("explicit single-event ceilings remain distinct from generic slate ceilings", () => {
  const picks = Array.from({length: 4}, (_, i) => prop({game: "Away @ Home", teamAbbr: "HOME", player: `Player ${i}`, pick: `Player ${i} Over 1.5`, propLine: 1.5}));
  assert.equal(applyDeliveryGroundingGate({picks, target: 5}).picks.length, 2);
  assert.equal(applyDeliveryGroundingGate({picks, target: 5, maxPropsPerGameCap: 4}).picks.length, 4);
});

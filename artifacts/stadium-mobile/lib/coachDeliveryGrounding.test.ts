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

test("incident-derived: proven mismatch removed; unknown identity kept", () => {
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
  assert.equal(kept.length, 2);
  assert.equal(kept[0]!.player, "Junior Caminero");
  assert.equal(kept[1]!.player, "Unknown Player");
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
  assert.match(src, /Delivery grounding/);
  // Gate must appear twice (props-only + mixed) and after final slate belts.
  const gateHits = src.match(/applyDeliveryGroundingGate/g) ?? [];
  assert.ok(gateHits.length >= 3, "import + props-only + mixed wire sites");
  const propsBelt = src.indexOf(
    "picks = filterPicksForCoachAskTeams(picks, inputs.teamScope, inputs.excludedTeams);",
  );
  const propsGate = src.indexOf("qualifiedCandidates: [],");
  assert.ok(propsBelt > 0 && propsGate > propsBelt, "props-only gate after team belt");
  const mixedSportBelt = src.lastIndexOf(
    "picks = filterPicksByAllowedSports(picks, askSportScope, inputs.espnGames);",
  );
  const mixedGate = src.lastIndexOf("Delivery grounding — after belts");
  assert.ok(
    mixedSportBelt > 0 && mixedGate > mixedSportBelt,
    "mixed gate after sport belt",
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

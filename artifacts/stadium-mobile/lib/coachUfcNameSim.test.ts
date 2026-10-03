/**
 * Phone: "4 leg UFC" staged only 2 MLs with a quality-bar shortfall because
 * Coach slate sims required ESPN athlete ids. Odds-board fights without ids
 * were dropped as unresolved — even though the server + Simulator already
 * sim UFC by fighter names.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  isNameOnlyGameSimSport,
  nameOnlyIdsFromGameLabel,
} from "./nameOnlyGameSim.ts";
import { resolveCoachGameTeamIds } from "./coachTeamIdResolve.ts";

const root = dirname(fileURLToPath(import.meta.url));

/** Same resolve order as coachGameMonteCarlo.resolveTeamIds — map then names. */
function resolveWithNameFallback(
  gameLabel: string,
  sport: string | undefined,
  map: Map<string, import("./coachTeamIdResolve.ts").CoachGameTeamIds>,
) {
  const fromMap = resolveCoachGameTeamIds(gameLabel, sport, map);
  if (fromMap) return fromMap;
  return nameOnlyIdsFromGameLabel(gameLabel, sport);
}

test("UFC/MMA/tennis are name-only game-sim sports; NFL is not", () => {
  assert.equal(isNameOnlyGameSimSport("ufc"), true);
  assert.equal(isNameOnlyGameSimSport("mma"), true);
  assert.equal(isNameOnlyGameSimSport("tennis"), true);
  assert.equal(isNameOnlyGameSimSport("UFC"), true);
  assert.equal(isNameOnlyGameSimSport("nfl"), false);
  assert.equal(isNameOnlyGameSimSport("ncaaf"), false);
  assert.equal(isNameOnlyGameSimSport(null), false);
});

test("nameOnlyIdsFromGameLabel parses odds Away @ Home for UFC", () => {
  const ids = nameOnlyIdsFromGameLabel("Anthony Romero @ Marcus McGhee", "ufc");
  assert.ok(ids);
  assert.equal(ids!.awayTeam, "Anthony Romero");
  assert.equal(ids!.homeTeam, "Marcus McGhee");
  assert.equal(ids!.sport, "ufc");
  assert.equal(ids!.homeTeamId, "");
  assert.equal(ids!.awayTeamId, "");
  assert.equal(nameOnlyIdsFromGameLabel("Anthony Romero @ Marcus McGhee", "nfl"), null);
  assert.equal(nameOnlyIdsFromGameLabel("Broken Label", "ufc"), null);
});

test("resolve falls back to fighter names when ESPN map is empty (4 leg UFC)", () => {
  const empty = new Map();
  const romero = resolveWithNameFallback("Anthony Romero @ Marcus McGhee", "ufc", empty);
  assert.ok(romero);
  assert.equal(romero!.awayTeam, "Anthony Romero");
  assert.equal(romero!.homeTeam, "Marcus McGhee");

  const cong = resolveWithNameFallback("Wang Cong @ Natalia Silva", "ufc", empty);
  assert.ok(cong);
  assert.equal(cong!.awayTeam, "Wang Cong");

  // Team sports still require a real ESPN bind.
  assert.equal(resolveWithNameFallback("Chiefs @ Bills", "nfl", empty), null);
});

test("resolve prefers ESPN map when athlete ids exist", () => {
  const map = new Map([
    [
      "anthony romero @ marcus mcghee",
      {
        sport: "ufc",
        homeTeamId: "401",
        awayTeamId: "402",
        homeTeam: "Marcus McGhee",
        awayTeam: "Anthony Romero",
      },
    ],
  ]);
  const ids = resolveWithNameFallback("Anthony Romero @ Marcus McGhee", "ufc", map);
  assert.ok(ids);
  assert.equal(ids!.homeTeamId, "401");
  assert.equal(ids!.awayTeamId, "402");
});

test("slate sim path wires name-only + UFC client fallback", () => {
  const src = readFileSync(join(root, "coachGameMonteCarlo.ts"), "utf8");
  assert.match(src, /nameOnlyIdsFromGameLabel/);
  assert.match(src, /fetchUfcSimulatorGameOutcome/);
  assert.match(src, /4 leg UFC/);
  assert.match(src, /homeTeamId: ids\.homeTeamId \|\| undefined/);
});

test("fetchGameOutcomeSimulation omits blank team ids for name-only sports", () => {
  const src = readFileSync(join(root, "api.ts"), "utf8");
  assert.match(src, /Omit blank ids so name-only combat\/tennis/);
  assert.match(src, /if \(opts\.homeTeamId\) body\.homeTeamId = opts\.homeTeamId/);
  assert.match(src, /if \(opts\.awayTeamId\) body\.awayTeamId = opts\.awayTeamId/);
});

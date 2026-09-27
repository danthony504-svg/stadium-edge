import assert from "node:assert/strict";
import test from "node:test";

import type { ParsedPick } from "../components/PickCard.tsx";
import {
  FOOTBALL_PROPS_ONLY_BATCH,
  footballPropsOnlyFamilyCounts,
  footballPropsOnlyMaxCandidates,
  selectFootballPropsOnlyFromPicks,
  shouldBuildFootballPropsOnlyTicket,
} from "./coachFootballPropsOnly.ts";
import { clipPropSimHitForGrade, pickHasSimGrade } from "./simMarketSupport.ts";

function pick(
  market: string,
  player: string,
  line: number,
  opts?: { athleteId?: string | null },
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
    athleteId: opts?.athleteId === null ? null : (opts?.athleteId ?? `ath-${player}`),
  } as ParsedPick;
}

test("props-only NFL ask uses dedicated football props-only rebuild path", () => {
  assert.equal(
    shouldBuildFootballPropsOnlyTicket({
      propsOnly: true,
      pool: Array.from({ length: 30 }, () => ({ sport: "nfl" })),
    }),
    true,
  );
  assert.equal(
    shouldBuildFootballPropsOnlyTicket({
      propsOnly: true,
      pool: Array.from({ length: 30 }, () => ({ sport: "mlb" })),
    }),
    false,
  );
});

test("phone PROP_ALL_NO_SIM_GRADE rebuild: athleteId required + finishable skill mix", () => {
  const ranked: ParsedPick[] = [
    ...Array.from({ length: 200 }, (_, i) =>
      pick("player_anytime_td", `TdNoId${i}`, 0.5, { athleteId: null }),
    ),
    ...Array.from({ length: 80 }, (_, i) => pick("player_anytime_td", `Td${i}`, 0.5)),
    ...Array.from({ length: 60 }, (_, i) =>
      pick("player_pass_yds", `Pass${i}`, 240.5 + (i % 5)),
    ),
    ...Array.from({ length: 40 }, (_, i) => pick("player_rush_yds", `Rush${i}`, 65.5)),
  ];
  const selected = selectFootballPropsOnlyFromPicks(ranked, 9);
  assert.ok(selected.length > 0);
  assert.ok(selected.length <= footballPropsOnlyMaxCandidates(9, 5000));
  assert.ok(selected.length < 72, "must stay well under the failed 72-wide enrich batches");
  assert.ok(selected.every((p) => !!p.athleteId), "no missing-athleteId dead ends");
  const families = footballPropsOnlyFamilyCounts(selected);
  assert.ok((families.yards ?? 0) > 0, "yards must be in the graded set");
  assert.ok((families.td ?? 0) > 0, "TD still represented");
});

test("tiny batch size lets local enrich finish (phone wipe was wide-batch timeout)", () => {
  assert.equal(FOOTBALL_PROPS_ONLY_BATCH, 8);
  const max = footballPropsOnlyMaxCandidates(9, 4713);
  assert.ok(Math.ceil(max / FOOTBALL_PROPS_ONLY_BATCH) <= 8);
});

test("binary TD 0/1 soft-clip clears sim grade admission", () => {
  const p = {
    market: "Anytime TD",
    propMarketKey: "player_anytime_td",
    propLine: 0.5,
    isProp: true,
    sport: "nfl",
  };
  assert.equal(pickHasSimGrade(p, 0), false);
  assert.equal(pickHasSimGrade(p, clipPropSimHitForGrade(p, 0)), true);
  assert.equal(pickHasSimGrade(p, clipPropSimHitForGrade(p, 1)), true);
});

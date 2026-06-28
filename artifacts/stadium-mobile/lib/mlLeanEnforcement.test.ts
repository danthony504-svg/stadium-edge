import assert from "node:assert/strict";
import { test } from "node:test";

import type { ParsedPick } from "@/components/PickCard";
import {
  enforceMlLeanOnPicks,
  isGameSideMlOrSpread,
  teamsMatch,
} from "./mlLeanEnforcement.ts";

const GAME = "New York Yankees @ Boston Red Sox";
const HISTORY = {
  [GAME]: {
    mlLean: { side: "Boston Red Sox", edge: 11.8, reasons: ["Sox 6-4 L10"] },
  },
};

const REAL_ODDS = [
  { sport: "mlb", game: GAME, market: "Moneyline", pick: "Sox ML", odds: -105 },
  { sport: "mlb", game: GAME, market: "Moneyline", pick: "Yankees ML", odds: -104 },
  { sport: "mlb", game: GAME, market: "Spread", pick: "Sox +1.5", odds: -180 },
  { sport: "mlb", game: GAME, market: "Spread", pick: "Yankees -1.5", odds: 165 },
  { sport: "mlb", game: GAME, market: "Total", pick: "Over 8.5", odds: -110 },
];

test("teamsMatch: nicknames and full names", () => {
  assert.equal(teamsMatch("Sox", "Boston Red Sox"), true);
  assert.equal(teamsMatch("Yankees", "New York Yankees"), true);
  assert.equal(teamsMatch("Yankees", "Boston Red Sox"), false);
});

test("isGameSideMlOrSpread: ML and spread yes, total no", () => {
  assert.equal(
    isGameSideMlOrSpread({ game: GAME, market: "Moneyline", pick: "Yankees ML", odds: -104 }),
    true,
  );
  assert.equal(
    isGameSideMlOrSpread({ game: GAME, market: "Spread", pick: "Yankees -1.5", odds: 165 }),
    true,
  );
  assert.equal(
    isGameSideMlOrSpread({ game: GAME, market: "Total", pick: "Over 8.5", odds: -110 }),
    false,
  );
});

test("enforceMlLeanOnPicks: swaps opposing ML to lean-side ML", () => {
  const picks: ParsedPick[] = [
    { game: GAME, market: "Moneyline", pick: "Yankees ML", odds: -104 },
  ];
  const { picks: out, swapped, dropped } = enforceMlLeanOnPicks(picks, {
    matchupHistory: HISTORY,
    realOdds: REAL_ODDS,
    gameMeta: [],
  });
  assert.equal(swapped, 1);
  assert.equal(dropped, 0);
  assert.equal(out.length, 1);
  assert.equal(out[0]!.pick, "Sox ML");
  assert.equal(out[0]!.odds, -105);
});

test("enforceMlLeanOnPicks: swaps opposing spread to lean-side spread", () => {
  const picks: ParsedPick[] = [
    { game: GAME, market: "Spread", pick: "Yankees -1.5", odds: 165 },
  ];
  const { picks: out, swapped } = enforceMlLeanOnPicks(picks, {
    matchupHistory: HISTORY,
    realOdds: REAL_ODDS,
    gameMeta: [],
  });
  assert.equal(swapped, 1);
  assert.equal(out[0]!.pick, "Sox +1.5");
});

test("enforceMlLeanOnPicks: leaves aligned Sox legs untouched", () => {
  const picks: ParsedPick[] = [
    { game: GAME, market: "Spread", pick: "Sox +1.5", odds: -180 },
  ];
  const { picks: out, swapped, dropped } = enforceMlLeanOnPicks(picks, {
    matchupHistory: HISTORY,
    realOdds: REAL_ODDS,
    gameMeta: [],
  });
  assert.equal(swapped, 0);
  assert.equal(dropped, 0);
  assert.equal(out[0]!.pick, "Sox +1.5");
});

test("enforceMlLeanOnPicks: totals and props pass through", () => {
  const picks: ParsedPick[] = [
    { game: GAME, market: "Total", pick: "Over 8.5", odds: -110 },
    {
      game: GAME,
      market: "Strikeouts",
      pick: "Cole Over 6.5 Strikeouts",
      odds: -120,
      isProp: true,
    },
  ];
  const { picks: out, swapped, dropped } = enforceMlLeanOnPicks(picks, {
    matchupHistory: HISTORY,
    realOdds: REAL_ODDS,
    gameMeta: [],
  });
  assert.equal(swapped, 0);
  assert.equal(dropped, 0);
  assert.equal(out.length, 2);
});

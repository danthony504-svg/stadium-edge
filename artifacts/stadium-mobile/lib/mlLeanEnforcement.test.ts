import assert from "node:assert/strict";
import { test } from "node:test";

import type { ParsedPick } from "@/components/PickCard";
import {
  enforceMlLeanOnPicks,
  isGameSideMlOrSpread,
  mlLeanEnforcementNote,
  teamsMatch,
} from "./mlLeanEnforcement.ts";

const GAME = "New York Yankees @ Boston Red Sox";
const HISTORY = {
  [GAME]: {
    home: null,
    away: null,
    homePace: null,
    awayPace: null,
    homeVenueForm: null,
    awayVenueForm: null,
    homeStreak: null,
    awayStreak: null,
    homeSeason: null,
    awaySeason: null,
    homeRest: null,
    awayRest: null,
    h2h: null,
    lastMeeting: null,
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

test("mlLeanEnforcementNote: 0 swaps → no alignment note", () => {
  assert.equal(mlLeanEnforcementNote({ picks: [], swapped: 0, dropped: 0 }), "");
});

test("mlLeanEnforcementNote: 1 swap → singular pick, no legs/Markdown", () => {
  const note = mlLeanEnforcementNote({ picks: [], swapped: 1, dropped: 0 });
  assert.equal(
    note,
    "Updated 1 moneyline/spread pick to match the stronger analytics lean.",
  );
  assert.equal(note.includes("_"), false);
  assert.equal(/\blegs?\b/i.test(note), false);
  assert.equal(/Aligned/i.test(note), false);
});

test("mlLeanEnforcementNote: 2 swaps → plural picks, not ticket legs", () => {
  const note = mlLeanEnforcementNote({ picks: [], swapped: 2, dropped: 0 });
  assert.equal(
    note,
    "Updated 2 moneyline/spread picks to match the stronger analytics lean.",
  );
  assert.equal(note.includes("_"), false);
  assert.equal(/\blegs?\b/i.test(note), false);
  assert.equal(/Aligned/i.test(note), false);
});

test("mlLeanEnforcementNote: 7-leg ticket with 2 swaps keeps 7 picks; note is adjustments only", () => {
  const ticket: ParsedPick[] = [
    { game: GAME, market: "Moneyline", pick: "Sox ML", odds: -105 },
    { game: GAME, market: "Spread", pick: "Sox +1.5", odds: -180 },
    { game: GAME, market: "Total", pick: "Over 8.5", odds: -110 },
    { game: "A @ B", market: "Moneyline", pick: "A ML", odds: -110 },
    { game: "C @ D", market: "Spread", pick: "C +3.5", odds: -110 },
    { game: "E @ F", market: "Total", pick: "Under 45.5", odds: -110 },
    { game: "G @ H", market: "Moneyline", pick: "G ML", odds: 120 },
  ];
  assert.equal(ticket.length, 7);
  const note = mlLeanEnforcementNote({ picks: ticket, swapped: 2, dropped: 0 });
  assert.equal(ticket.length, 7);
  assert.match(note, /Updated 2 moneyline\/spread picks/);
  assert.equal(/\b2 legs\b/i.test(note), false);
  assert.equal(note.includes("_"), false);
});

test("mlLeanEnforcementNote: dropped copy uses pick/picks without Markdown", () => {
  assert.equal(
    mlLeanEnforcementNote({ picks: [], swapped: 0, dropped: 1 }),
    "Dropped 1 moneyline/spread pick that opposed the analytics lean and had no matching real line on the favored side.",
  );
  assert.equal(
    mlLeanEnforcementNote({ picks: [], swapped: 0, dropped: 2 }),
    "Dropped 2 moneyline/spread picks that opposed the analytics lean and had no matching real line on the favored side.",
  );
});

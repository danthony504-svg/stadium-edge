import assert from "node:assert/strict";
import test from "node:test";
import type { ParsedPick } from "../components/PickCard.tsx";
import { enforceConsistentGameSides, mergeConflictingLegDropNotes, simFavoredTeamSide } from "./gameSideConsistency.ts";

const GAME = "New York Mets @ Atlanta Braves";

function leg(pick: string, market = "Spread"): ParsedPick {
  return {
    game: GAME,
    market,
    pick,
    odds: 100,
    isProp: false,
    sport: "mlb",
  };
}

test("simFavoredTeamSide picks away when Mets lead win prob", () => {
  const side = simFavoredTeamSide({
    sport: "mlb",
    simulations: 10_000,
    homeWinProbability: 0.46,
    awayWinProbability: 0.54,
    tieProbability: 0,
    homeProjectedScore: 4.5,
    awayProjectedScore: 4.5,
    mostLikelyWinner: "away",
    mostLikelyWinnerPct: 0.54,
    confidenceScore: 55,
  });
  assert.equal(side, "away");
});

test("enforceConsistentGameSides drops opposing ML and spread on same game", () => {
  const sim = new Map([
    [
      GAME,
      {
        sport: "mlb",
        simulations: 10_000,
        homeWinProbability: 0.46,
        awayWinProbability: 0.54,
        tieProbability: 0,
        homeProjectedScore: 4.5,
        awayProjectedScore: 4.5,
        mostLikelyWinner: "away" as const,
        mostLikelyWinnerPct: 0.54,
        confidenceScore: 55,
        coverHitRates: {
          [`${GAME}|moneyline|mets ml`.toLowerCase()]: 0.54,
          [`${GAME}|spread|braves -1.5`.toLowerCase()]: 0.38,
        },
      },
    ],
  ]);
  const picks = [leg("Mets ML", "Moneyline"), leg("Braves -1.5", "Spread")];
  const r = enforceConsistentGameSides(picks, { simByGame: sim });
  assert.equal(r.picks.length, 1);
  assert.match(r.picks[0]!.pick, /Mets/i);
  assert.equal(r.dropped, 1);
});

test("mergeConflictingLegDropNotes combines opposing-side drop paragraphs", () => {
  const note = [
    "_Dropped 2 legs that backed the opposing team on the same game — one side per matchup (aligned to the game simulator when available)._",
    "_Dropped 3 legs that backed the opposing team on the same game — one side per matchup (aligned to the game simulator when available)._",
    "_Some other note._",
  ].join("\n\n");
  const merged = mergeConflictingLegDropNotes(note);
  assert.match(merged, /Dropped 5 conflicting legs/);
  assert.match(merged, /Replaced with higher-rated picks/);
  assert.match(merged, /Some other note/);
  assert.doesNotMatch(merged, /Dropped 2 legs that backed/);
});

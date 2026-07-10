import assert from "node:assert/strict";
import test from "node:test";

import { mergeEspnIntoUfcOddsRows } from "../src/lib/ufcGames.js";
import type { SlateGameRow } from "../src/lib/oddsSlateGames.js";

const base = (overrides: Partial<SlateGameRow>): SlateGameRow => ({
  id: "1",
  sport: "ufc",
  name: "A vs B",
  shortName: "A vs B",
  status: "Scheduled",
  startsAt: "2026-07-11T21:00:00Z",
  homeTeam: "B",
  awayTeam: "A",
  homeScore: null,
  awayScore: null,
  homeTeamId: null,
  awayTeamId: null,
  homeLogo: null,
  awayLogo: null,
  homeAbbr: null,
  awayAbbr: null,
  venue: null,
  clock: null,
  period: null,
  periodLabel: null,
  state: "pre",
  ...overrides,
});

test("mergeEspnIntoUfcOddsRows copies venue from ESPN match", () => {
  const merged = mergeEspnIntoUfcOddsRows(
    [base({ awayTeam: "Cody Durden", homeTeam: "Alessandro Costa", venue: null })],
    [base({ awayTeam: "Cody Durden", homeTeam: "Alessandro Costa", venue: "T-Mobile Arena" })],
  );
  assert.equal(merged[0]!.venue, "T-Mobile Arena");
});

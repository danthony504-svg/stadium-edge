import assert from "node:assert/strict";
import test from "node:test";

import {
  hasUfcFightLabels,
  isUfcFightRow,
  mapEspnMmaScoreboardEvents,
  mapOddsRowsToUfcSimulatorGames,
  resolveUfcSimulatorGames,
} from "./ufcSimulatorGames.ts";

test("mapEspnMmaScoreboardEvents flattens UFC card into individual fights", () => {
  const tomorrow = new Date(Date.now() + 20 * 3600_000).toISOString();
  const rows = mapEspnMmaScoreboardEvents([
    {
      id: "600059148",
      name: "UFC 329",
      shortName: "UFC 329",
      date: tomorrow,
      status: { type: { state: "pre", description: "Scheduled" } },
      competitions: [
        {
          id: "401883599",
          date: tomorrow,
          venue: { fullName: "T-Mobile Arena" },
          competitors: [
            { order: 1, athlete: { id: "1", displayName: "Alessandro Costa", shortName: "Costa" } },
            { order: 2, athlete: { id: "2", displayName: "Cody Durden", shortName: "Durden" } },
          ],
        },
      ],
    },
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.awayTeam, "Cody Durden");
  assert.equal(rows[0]!.homeTeam, "Alessandro Costa");
});

test("mapOddsRowsToUfcSimulatorGames builds pregame fights from odds feed", () => {
  const soon = new Date(Date.now() + 6 * 3600_000).toISOString();
  const rows = mapOddsRowsToUfcSimulatorGames([
    {
      id: "o1",
      sport: "ufc",
      awayTeam: "Aaron Aby",
      homeTeam: "Zoran Milic",
      commenceTime: soon,
      markets: [],
    },
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.awayTeam, "Aaron Aby");
  assert.equal(rows[0]!.homeTeam, "Zoran Milic");
});

test("resolveUfcSimulatorGames falls back to odds when API rows lack fighters", async () => {
  const soon = new Date(Date.now() + 6 * 3600_000).toISOString();
  const rows = await resolveUfcSimulatorGames(
    [
      {
        id: "600059148",
        sport: "ufc",
        name: "UFC 329",
        shortName: "UFC 329",
        status: "Scheduled",
        startsAt: soon,
        homeTeam: null,
        awayTeam: null,
        venue: "T-Mobile Arena",
      } as any,
    ],
    async () => [
      {
        id: "o1",
        sport: "ufc",
        awayTeam: "Aaron Aby",
        homeTeam: "Zoran Milic",
        commenceTime: soon,
        markets: [],
      },
    ],
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.awayTeam, "Aaron Aby");
});

test("isUfcFightRow rejects event placeholders", () => {
  assert.equal(isUfcFightRow({ homeTeam: null, awayTeam: null } as any), false);
  assert.equal(hasUfcFightLabels([{ homeTeam: "A", awayTeam: "B" } as any]), true);
});

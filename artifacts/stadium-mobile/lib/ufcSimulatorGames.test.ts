import assert from "node:assert/strict";
import test from "node:test";

import { hasUfcFightLabels, mapEspnMmaScoreboardEvents } from "./ufcSimulatorGames.ts";

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
  assert.equal(rows[0]!.venue, "T-Mobile Arena");
});

test("hasUfcFightLabels detects event-level placeholder rows", () => {
  assert.equal(hasUfcFightLabels([{ id: "1", sport: "ufc", name: "UFC", shortName: "UFC", status: "Scheduled", startsAt: "" } as any]), false);
  assert.equal(
    hasUfcFightLabels([
      {
        id: "1",
        sport: "ufc",
        name: "A vs B",
        shortName: "A vs B",
        status: "Scheduled",
        startsAt: "",
        awayTeam: "A",
        homeTeam: "B",
      } as any,
    ]),
    true,
  );
});

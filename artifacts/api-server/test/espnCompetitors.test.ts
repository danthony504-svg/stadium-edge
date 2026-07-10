import assert from "node:assert/strict";
import test from "node:test";

import {
  espnCompetitorName,
  resolveEspnCompetitorSides,
} from "../src/lib/espnCompetitors.js";

test("resolveEspnCompetitorSides uses homeAway for team sports", () => {
  const competitors = [
    { homeAway: "away" as const, team: { displayName: "Lakers" } },
    { homeAway: "home" as const, team: { displayName: "Celtics" } },
  ];
  const { home, away } = resolveEspnCompetitorSides(competitors, false);
  assert.equal(espnCompetitorName(home), "Celtics");
  assert.equal(espnCompetitorName(away), "Lakers");
});

test("resolveEspnCompetitorSides maps MMA athletes by order", () => {
  const competitors = [
    { order: 2, athlete: { id: "2", displayName: "Max Holloway" } },
    { order: 1, athlete: { id: "1", displayName: "Conor McGregor" } },
  ];
  const { home, away } = resolveEspnCompetitorSides(competitors, true);
  assert.equal(espnCompetitorName(home), "Conor McGregor");
  assert.equal(espnCompetitorName(away), "Max Holloway");
});

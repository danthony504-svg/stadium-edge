import assert from "node:assert/strict";
import test from "node:test";

import { buildPropHolisticScore } from "./propHolisticRecommendation.ts";

test("NFL prop weather scores cold/windy outdoor games on real readings", () => {
  const cold = buildPropHolisticScore({
    sport: "nfl",
    marketKey: "player_pass_yds",
    propSide: "Over",
    rubricScores: {
      trend: 7,
      matchup: 7,
      lineValue: 7,
      injury: 7,
      lineShopping: 7,
      simulation: 7,
    },
    mlbGameEnv: {
      park: { dome: false, surface: "grass" },
      weather: { tempF: 28, windMph: 18, precipChancePct: 55 },
      climateControlled: false,
    },
  });
  const mild = buildPropHolisticScore({
    sport: "nfl",
    marketKey: "player_pass_yds",
    propSide: "Over",
    rubricScores: {
      trend: 7,
      matchup: 7,
      lineValue: 7,
      injury: 7,
      lineShopping: 7,
      simulation: 7,
    },
    mlbGameEnv: {
      park: { dome: false, surface: "grass" },
      weather: { tempF: 72, windMph: 4, precipChancePct: 5 },
      climateControlled: false,
    },
  });
  const wxCold = cold.factors.find((f) => f.key === "weather");
  const wxMild = mild.factors.find((f) => f.key === "weather");
  assert.equal(wxCold?.applicable, true);
  assert.equal(wxCold?.present, true);
  assert.ok((wxCold?.score ?? 10) < (wxMild?.score ?? 0));
});

test("dome NFL games report weather-neutral with surface", () => {
  const h = buildPropHolisticScore({
    sport: "nfl",
    marketKey: "player_pass_yds",
    propSide: "Over",
    rubricScores: {
      trend: 7,
      matchup: 7,
      lineValue: 7,
      injury: null,
      lineShopping: null,
      simulation: 7,
    },
    mlbGameEnv: {
      park: { dome: true, surface: "turf" },
      climateControlled: true,
      weather: null,
    },
  });
  const wx = h.factors.find((f) => f.key === "weather");
  assert.equal(wx?.present, true);
  assert.match(String(wx?.display ?? ""), /Dome/i);
  assert.match(String(wx?.display ?? ""), /turf/i);
});

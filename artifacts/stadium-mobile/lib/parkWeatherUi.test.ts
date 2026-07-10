import assert from "node:assert/strict";
import test from "node:test";

import {
  gameWeatherEffects,
  impactLevelLabel,
  impactLevelTone,
  windDisplay,
} from "./parkWeatherUi.ts";

test("impactLevelLabel maps favorable ratings", () => {
  assert.equal(impactLevelLabel("Very Favorable"), "HIGH IMPACT");
  assert.equal(impactLevelLabel("Neutral"), "LOW IMPACT");
});

test("windDisplay formats mph and direction", () => {
  assert.equal(windDisplay({ windMph: 10, windDir: "WSW", windDeg: 244 } as any), "10 mph WSW");
});

test("gameWeatherEffects returns four categories", () => {
  const effects = gameWeatherEffects({
    homeAbbr: "CHC",
    climateControlled: false,
    impact: { rating: "Favorable", summary: "" },
    current: { tempF: 78, precipChancePct: 10 },
  } as any);
  assert.equal(effects.length, 4);
  assert.equal(impactLevelTone("Unfavorable"), "negative");
});

import assert from "node:assert/strict";
import test from "node:test";

import {
  gameWeatherEffects,
  impactLevelLabel,
  impactLevelTone,
  shortImpactBadge,
  windCarryLabel,
  windDisplay,
} from "./parkWeatherUi.ts";

test("impactLevelLabel maps ratings to LOW/MODERATE/HIGH", () => {
  assert.equal(impactLevelLabel("Very Favorable"), "LOW IMPACT");
  assert.equal(impactLevelLabel("Favorable"), "LOW IMPACT");
  assert.equal(impactLevelLabel("Neutral"), "LOW IMPACT");
  assert.equal(impactLevelLabel("Unfavorable"), "MODERATE IMPACT");
  assert.equal(impactLevelLabel("Very Unfavorable"), "HIGH IMPACT");
});

test("shortImpactBadge uses LOW/MODERATE/HIGH labels", () => {
  assert.equal(shortImpactBadge("Favorable"), "LOW");
  assert.equal(shortImpactBadge("Unfavorable"), "MODERATE");
  assert.equal(shortImpactBadge("Neutral"), "NEUTRAL");
});

test("windDisplay formats mph, direction, and carry", () => {
  assert.equal(windDisplay({ windMph: 10, windDir: "WSW", windDeg: 247 } as any, "CHC"), "10 mph WSW\nOut to RF");
});

test("windCarryLabel returns null for light wind", () => {
  assert.equal(windCarryLabel(247, 3, "CHC"), null);
});

test("gameWeatherEffects returns four categories with optional pct", () => {
  const effects = gameWeatherEffects({
    gameId: "g1",
    homeAbbr: "CHC",
    climateControlled: false,
    impact: { rating: "Favorable", summary: "" },
    current: { tempF: 78, precipChancePct: 10, windMph: 10, windDeg: 247 },
  } as any);
  assert.equal(effects.length, 4);
  assert.ok(effects.some((e) => e.trend === "INCREASED" && e.pct != null));
  assert.equal(impactLevelTone("Unfavorable"), "negative");
});

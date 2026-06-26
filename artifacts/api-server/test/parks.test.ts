import assert from "node:assert/strict";
import { test } from "node:test";

import { computeWeatherImpact, degToCompass } from "../src/lib/parks.ts";

test("degToCompass maps cardinal and intercardinal bearings", () => {
  assert.equal(degToCompass(0), "N");
  assert.equal(degToCompass(90), "E");
  assert.equal(degToCompass(180), "S");
  assert.equal(degToCompass(270), "W");
  assert.equal(degToCompass(45), "NE");
  // Wraps around and normalizes negatives.
  assert.equal(degToCompass(360), "N");
  assert.equal(degToCompass(-90), "W");
});

test("climate-controlled parks are always Neutral", () => {
  const r = computeWeatherImpact({
    climateControlled: true,
    tempF: 95,
    precipChancePct: 100,
    windMph: 20,
    windDir: "S",
  });
  assert.equal(r.rating, "Neutral");
  assert.match(r.summary, /roof/i);
});

test("hot and dry rates Very Favorable", () => {
  const r = computeWeatherImpact({
    climateControlled: false,
    tempF: 90,
    precipChancePct: 0,
    windMph: 5,
    windDir: "S",
  });
  assert.equal(r.rating, "Very Favorable");
});

test("cold with high rain chance rates Very Unfavorable", () => {
  const r = computeWeatherImpact({
    climateControlled: false,
    tempF: 45,
    precipChancePct: 90,
    windMph: 12,
    windDir: "NW",
  });
  assert.equal(r.rating, "Very Unfavorable");
});

test("mild and dry rates Neutral", () => {
  const r = computeWeatherImpact({
    climateControlled: false,
    tempF: 68,
    precipChancePct: 10,
    windMph: 4,
    windDir: "E",
  });
  assert.equal(r.rating, "Neutral");
});

test("wind speed is described factually but never moves the rating", () => {
  const calm = computeWeatherImpact({
    climateControlled: false,
    tempF: 68,
    precipChancePct: 0,
    windMph: 2,
    windDir: "N",
  });
  const windy = computeWeatherImpact({
    climateControlled: false,
    tempF: 68,
    precipChancePct: 0,
    windMph: 25,
    windDir: "N",
  });
  assert.equal(calm.rating, windy.rating);
  assert.match(windy.summary, /25 mph/);
});

test("no usable readings → honest Neutral, never a fabricated verdict", () => {
  const r = computeWeatherImpact({
    climateControlled: false,
    tempF: null,
    precipChancePct: null,
    windMph: null,
    windDir: null,
  });
  assert.equal(r.rating, "Neutral");
  assert.match(r.summary, /limited/i);
});

test("unknown precip is omitted, not treated as zero", () => {
  // Hot temp alone should still rate Very Favorable; a null precip must neither
  // penalize the score nor appear in the summary as a fabricated 0% chance.
  const r = computeWeatherImpact({
    climateControlled: false,
    tempF: 90,
    precipChancePct: null,
    windMph: 5,
    windDir: "S",
  });
  assert.equal(r.rating, "Very Favorable");
  assert.doesNotMatch(r.summary, /rain|%/i);
});

test("missing temp still rates from a known high rain chance", () => {
  const r = computeWeatherImpact({
    climateControlled: false,
    tempF: null,
    precipChancePct: 80,
    windMph: null,
    windDir: null,
  });
  assert.equal(r.rating, "Very Unfavorable");
  assert.match(r.summary, /80%/);
});

test("missing wind direction omits the compass bearing without guessing", () => {
  const r = computeWeatherImpact({
    climateControlled: false,
    tempF: 78,
    precipChancePct: 0,
    windMph: 12,
    windDir: null,
  });
  // Speed is still reported, but no fabricated "out of the X" direction.
  assert.match(r.summary, /12 mph/);
  assert.doesNotMatch(r.summary, /out of the/i);
});

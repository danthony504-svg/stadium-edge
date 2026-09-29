import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const weatherSrc = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../src/routes/weather.ts"),
  "utf8",
);

test("weather parks route serves MLB + NFL + NCAAF", () => {
  assert.ok(weatherSrc.includes('sport !== "mlb" && sport !== "nfl" && sport !== "ncaaf"'));
  assert.ok(weatherSrc.includes("buildFootballParkReports"));
  assert.ok(weatherSrc.includes("footballStadiumsForSport"));
  assert.ok(weatherSrc.includes("wx:parks:nfl") || weatherSrc.includes("`wx:parks:${sport}"));
});

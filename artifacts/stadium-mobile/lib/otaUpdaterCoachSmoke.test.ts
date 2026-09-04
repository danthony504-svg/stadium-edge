import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));

test("otaUpdater.ts exports prefetchOtaInBackground and no stale prefetch helper", () => {
  const updaterSource = readFileSync(join(here, "otaUpdater.ts"), "utf8");
  const stale = "prefetchAndMaybe" + "ApplyOta";
  assert.equal(updaterSource.includes(stale), false);
  assert.match(updaterSource, /export async function prefetchOtaInBackground/);
});

test("coach.tsx uses prefetchOtaInBackground and not stale OTA helper", () => {
  const coachSource = readFileSync(join(here, "../app/(tabs)/coach.tsx"), "utf8");
  const stale = "prefetchAndMaybe" + "ApplyOta";
  assert.equal(coachSource.includes(stale), false);
  assert.match(coachSource, /prefetchOtaInBackground\(\)\.catch/);
  assert.match(coachSource, /!streamingRef\.current && !buildFinishingRef\.current && !waiting/);
});

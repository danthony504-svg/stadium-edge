import assert from "node:assert/strict";
import test from "node:test";

import {
  espnScoreboardDayKeys,
  espnUtcDayKey,
  mergeEspnEventsById,
} from "../src/lib/espnScoreboardWindow.ts";

test("espnUtcDayKey formats YYYYMMDD in UTC", () => {
  assert.equal(espnUtcDayKey(new Date("2026-09-17T21:57:00Z")), "20260917");
  assert.equal(espnUtcDayKey(new Date("2026-01-05T00:30:00Z")), "20260105");
});

test("espnScoreboardDayKeys spans yesterday through +7 days", () => {
  const keys = espnScoreboardDayKeys(Date.parse("2026-09-17T21:57:00Z"));
  assert.equal(keys[0], "20260916");
  assert.equal(keys[keys.length - 1], "20260924");
  assert.equal(keys.length, 9);
  assert.ok(keys.includes("20260917"));
  assert.ok(keys.includes("20260919"));
});

test("mergeEspnEventsById dedupes and keeps order", () => {
  const merged = mergeEspnEventsById([
    [{ id: "a" }, { id: "b" }],
    [{ id: "b" }, { id: "c" }],
    [{ id: undefined as unknown as string }],
  ]);
  assert.deepEqual(
    merged.map((e) => e.id),
    ["a", "b", "c"],
  );
});

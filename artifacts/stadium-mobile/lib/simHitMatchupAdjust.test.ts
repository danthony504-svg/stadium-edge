/**
 * Matchup adjust invariants:
 * - Over + Under + push stay consistent after adjustment
 * - Results in [0, 1] without flattening alternate lines
 * - UI distinguishes raw sim vs model estimate (+ n=5 uncalibrated)
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  adjustOverUnderPushForOppDefenseTilt,
  adjustSimHitForOppDefenseTilt,
  explainSimHitOppDefenseAdjust,
  formatSimHitWithMatchupAdjust,
  propOppDefenseTilt,
} from "./footballRushDefense.ts";

test("0.9705 → adjusted is matchup transfer, not a soft-cap raise", () => {
  const pack = {
    teamName: "Seattle Seahawks",
    rush: {
      rushingYardsAllowedPerGame: 100.4,
      yardsPerRushAllowed: null,
      sampleSize: 5,
      teamName: "Seattle Seahawks",
    },
    gamesPlayed: 5,
  };
  const ownPack = { ownRushYpc: 1.94, gamesPlayed: 5 };
  const tiltU = propOppDefenseTilt({
    sport: "nfl",
    market: "player_rush_yds",
    side: "Under",
    pack,
    ownPack,
  });
  assert.ok(tiltU.tilt > 0);

  const raw = 0.9705;
  const explained = explainSimHitOppDefenseAdjust(raw, tiltU.tilt)!;
  assert.equal(explained.rawHit, raw);
  assert.ok(explained.adj > 0 && explained.adj <= 0.05);
  assert.equal(explained.certaintySoftClipped, false);
  assert.ok(explained.adjustedHit > raw);
  assert.ok(explained.adjustedHit <= 1);
  assert.ok(explained.adjustedHit >= 0);

  const label = formatSimHitWithMatchupAdjust({
    rawHit: raw,
    adjustedHit: explained.adjustedHit,
    sampleSize: 5,
  });
  assert.match(String(label), /model /);
  assert.match(String(label), /sim /);
  assert.match(String(label), /matchup/);
  assert.doesNotMatch(String(label), /soft-?cap/i);
  assert.match(String(label), /n=5/);
  assert.match(String(label), /uncalibrated/);
});

test("Over + Under + push remain consistent after paired adjust", () => {
  const tiltForUnder = 0.38;
  const raw = { over: 0.0295, under: 0.9705, push: 0 };
  const pair = adjustOverUnderPushForOppDefenseTilt({
    overHit: raw.over,
    underHit: raw.under,
    pushHit: raw.push,
    tiltForUnder,
  })!;
  const a = pair.adjusted;
  assert.ok(a.over >= 0 && a.over <= 1);
  assert.ok(a.under >= 0 && a.under <= 1);
  assert.ok(a.push >= 0 && a.push <= 1);
  assert.ok(
    Math.abs(a.over + a.under + a.push - 1) < 0.0015,
    `sum=${a.over + a.under + a.push}`,
  );
  assert.equal(a.push, raw.push);
  assert.ok(a.under > raw.under);
  assert.ok(a.over < raw.over);

  // Single-side API with opposite tilts matches the pair.
  const underAdj = adjustSimHitForOppDefenseTilt(raw.under, tiltForUnder)!;
  const overAdj = adjustSimHitForOppDefenseTilt(raw.over, -tiltForUnder)!;
  assert.equal(underAdj, a.under);
  assert.equal(overAdj, a.over);
});

test("adjusted stays in [0,1]; Under alt ladder monotone (no flatten)", () => {
  const tilt = 0.38;
  const rawUnder = {
    "9.5": 0.769,
    "11.5": 0.905,
    "13.5": 0.9705,
    "15.5": 0.995,
    "17.5": 1.0,
  } as const;
  const adjUnder = Object.fromEntries(
    Object.entries(rawUnder).map(([ln, h]) => [
      ln,
      adjustSimHitForOppDefenseTilt(h, tilt)!,
    ]),
  );
  for (const v of Object.values(adjUnder)) {
    assert.ok(v >= 0 && v <= 1);
  }
  // No shared 0.98 flatten of distinct high Unders.
  assert.notEqual(adjUnder["13.5"], adjUnder["15.5"]);
  const lines = ["9.5", "11.5", "13.5", "15.5", "17.5"] as const;
  for (let i = 1; i < lines.length; i++) {
    assert.ok(
      adjUnder[lines[i]!]! >= adjUnder[lines[i - 1]!]!,
      `Under ${lines[i]} >= Under ${lines[i - 1]} after tilt`,
    );
  }
});

test("alreadyApplied skips second tilt (cache/recovery)", () => {
  const once = adjustSimHitForOppDefenseTilt(0.9705, 0.38)!;
  const twice = adjustSimHitForOppDefenseTilt(once, 0.38, { alreadyApplied: true })!;
  assert.equal(twice, once);
  const wouldDouble = adjustSimHitForOppDefenseTilt(once, 0.38)!;
  assert.ok(wouldDouble !== once || once >= 0.999);
});

/**
 * Exact raw → adjusted transform for Bo Nix Under 13.5 style hits.
 * Tilt *increases* the estimate; soft-clip applies only to invented certainty (≥1).
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  adjustSimHitForOppDefenseTilt,
  explainSimHitOppDefenseAdjust,
  formatSimHitWithMatchupAdjust,
  propOppDefenseTilt,
} from "./footballRushDefense.ts";

test("0.9705 → adjusted is matchup +adj, not a soft-cap raise", () => {
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
  // Arithmetic: raw + adj, then soft-clip only if ≥1.
  const summed = raw + explained.adj;
  assert.equal(explained.certaintySoftClipped, summed >= 1);
  assert.ok(summed < 1, "MC Under + SEA tilt stays below 1");
  assert.equal(explained.adjustedHit, Math.round(summed * 1000) / 1000);
  assert.ok(explained.adjustedHit > raw);
  assert.notEqual(
    explained.adjustedHit,
    0.98,
    "must not invent 0.98 via ceiling when summed < 1",
  );

  const label = formatSimHitWithMatchupAdjust({
    rawHit: raw,
    adjustedHit: explained.adjustedHit,
    sampleSize: 5,
  });
  assert.match(String(label), /matchup/);
  assert.doesNotMatch(String(label), /soft-?cap/i);
  assert.match(String(label), /n=5.*uncalibrated|uncalibrated.*n=5/);
});

test("Over/Under consistency and Under alt-line monotonicity after tilt", () => {
  const tilt = 0.38; // SEA soft-stingy Under lean magnitude from live audit
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
  // Additive tilt clamps to 0.999 — no shared 0.98 flatten.
  assert.equal(adjUnder["17.5"], 0.999);
  assert.equal(
    explainSimHitOppDefenseAdjust(1.0, tilt)?.certaintySoftClipped,
    false,
  );
  const lines = ["9.5", "11.5", "13.5", "15.5", "17.5"] as const;
  for (let i = 1; i < lines.length; i++) {
    assert.ok(
      adjUnder[lines[i]!]! >= adjUnder[lines[i - 1]!]!,
      `Under ${lines[i]} >= Under ${lines[i - 1]} after tilt`,
    );
  }
  // Over uses opposite tilt sign via propOppDefenseTilt; verify invert helper:
  const over135 = adjustSimHitForOppDefenseTilt(0.0295, -tilt)!;
  assert.ok(over135 < 0.0295, "Over demoted when Under is favored");
  assert.ok(adjUnder["13.5"]! + over135 < 1.05);
});

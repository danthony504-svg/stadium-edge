import assert from "node:assert/strict";
import { test } from "node:test";

import {
  FOOTBALL_NCAAF_TEAM_STRENGTH_RESEARCH_VERSION,
  NcaafOppAdjRatings,
  earlySeasonPriorWeight,
  heavyTailCdf,
  marginSigma,
  ncaafTeamStrengthResearchEnabled,
  normalCdf,
  predictTeamStrength,
  TEAM_STRENGTH_FULL,
} from "../src/lib/sportSim/ncaafTeamStrength.ts";
import { FOOTBALL_DRIVE_ENGINE_VERSION } from "../src/lib/sportSim/footballDriveMatchup.ts";

test("research stamp is distinct from live drive stamp", () => {
  assert.equal(
    FOOTBALL_NCAAF_TEAM_STRENGTH_RESEARCH_VERSION,
    "ncaaf-team-strength-v0-research",
  );
  assert.notEqual(
    FOOTBALL_NCAAF_TEAM_STRENGTH_RESEARCH_VERSION,
    FOOTBALL_DRIVE_ENGINE_VERSION,
  );
});

test("flag defaults off; env enables research path", () => {
  const prev = process.env.NCAAF_TEAM_STRENGTH_RESEARCH;
  delete process.env.NCAAF_TEAM_STRENGTH_RESEARCH;
  assert.equal(ncaafTeamStrengthResearchEnabled(), false);
  assert.equal(ncaafTeamStrengthResearchEnabled(false), false);
  assert.equal(ncaafTeamStrengthResearchEnabled(true), true);
  process.env.NCAAF_TEAM_STRENGTH_RESEARCH = "1";
  assert.equal(ncaafTeamStrengthResearchEnabled(), true);
  if (prev === undefined) delete process.env.NCAAF_TEAM_STRENGTH_RESEARCH;
  else process.env.NCAAF_TEAM_STRENGTH_RESEARCH = prev;
});

test("earlySeasonPriorWeight decays with season games", () => {
  const w0 = earlySeasonPriorWeight({
    week: 1,
    nHomeSeasonGames: 0,
    nAwaySeasonGames: 0,
  });
  const w3 = earlySeasonPriorWeight({
    week: 4,
    nHomeSeasonGames: 3,
    nAwaySeasonGames: 3,
  });
  const w8 = earlySeasonPriorWeight({
    week: 7,
    nHomeSeasonGames: 6,
    nAwaySeasonGames: 6,
  });
  assert.ok(w0 > w3 && w3 > w8);
  assert.ok(w0 > 0.5);
  assert.ok(w8 < 0.35);
});

test("marginSigma inflates early and for large mismatches", () => {
  const mid = marginSigma({
    week: 6,
    nHomeSeasonGames: 5,
    nAwaySeasonGames: 5,
    absMu: 3,
    mismatchHandling: true,
  });
  const early = marginSigma({
    week: 1,
    nHomeSeasonGames: 0,
    nAwaySeasonGames: 0,
    absMu: 3,
    mismatchHandling: true,
  });
  const blowout = marginSigma({
    week: 6,
    nHomeSeasonGames: 5,
    nAwaySeasonGames: 5,
    absMu: 28,
    mismatchHandling: true,
  });
  assert.ok(early > mid);
  assert.ok(blowout > mid);
});

test("heavyTailCdf has fatter tails than normal", () => {
  const z = 2.5;
  assert.ok(heavyTailCdf(z) < normalCdf(z)); // more mass beyond +2.5
  assert.ok(Math.abs(heavyTailCdf(0) - 0.5) < 1e-6);
});

test("predict blends seed and live; update is causal (post-predict)", () => {
  const seed = new NcaafOppAdjRatings();
  seed.seedFromPrior(
    [
      {
        homeTeamId: "A",
        awayTeamId: "B",
        homeFg: 45,
        awayFg: 10,
        season: 2024,
      },
      {
        homeTeamId: "A",
        awayTeamId: "C",
        homeFg: 38,
        awayFg: 14,
        season: 2024,
      },
      {
        homeTeamId: "B",
        awayTeamId: "C",
        homeFg: 21,
        awayFg: 24,
        season: 2024,
      },
    ],
    new Set(),
  );
  const live = seed.clone();
  const before = predictTeamStrength({
    seed,
    live,
    homeId: "A",
    awayId: "B",
    week: 1,
    components: TEAM_STRENGTH_FULL,
  });
  assert.ok(before.pHomeMl > 0.5);
  assert.ok(before.priorWeight > 0.4);
  const muBefore = before.mu;
  live.update(
    { homeTeamId: "A", awayTeamId: "B", homeFg: 50, awayFg: 0, week: 1 },
    new Set(),
  );
  const after = predictTeamStrength({
    seed,
    live,
    homeId: "A",
    awayId: "C",
    week: 2,
    components: { useEarlyBlend: false, useUncertainty: false, useMismatchHandling: false },
  });
  // Live path moved; seed frozen. Cover fn is deterministic.
  assert.ok(Number.isFinite(after.pHomeCover(-14)));
  assert.notEqual(after.components.liveMu, muBefore);
});

/**
 * E4 behavioral tests (synthetic).
 *
 * These prove policy: known QB/player absences, stale reports, unavailable data,
 * and null→false coercion ban. They do NOT satisfy historical predictive
 * validation (segment conservatism on real pre-kick holdout joins).
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  CleanOppAdjStrength,
  E4_POLICY,
  classifyAvailabilitySnapshot,
  coerceInjuryKnownForbidden,
  e4ConservativeAdjust,
  evaluateE4SegmentConservatism,
  joinE4Labels,
  predictScoreMargin,
  buildPregameFromFixtureRow,
  type AvailabilityInput,
} from "../src/lib/sportSim/ncaafClean/index.ts";

const KICK = "2025-09-06T16:00:00Z";

function strengthFixture() {
  const strength = new CleanOppAdjStrength({ season: 2025 });
  strength.off.set("2306", 28);
  strength.def.set("2306", 20);
  strength.off.set("66", 24);
  strength.def.set("66", 22);
  return strength;
}

function pregameHome() {
  return buildPregameFromFixtureRow({
    eventId: "e4-syn",
    season: 2025,
    week: 2,
    kickoffIso: KICK,
    homeTeamId: "2306",
    awayTeamId: "66",
    venueKind: "home",
  });
}

function usableAv(partial: Partial<AvailabilityInput> & {
  home: AvailabilityInput["home"];
  away: AvailabilityInput["away"];
}): AvailabilityInput {
  return {
    eventId: "e4-syn",
    captureTimestamp: "2025-09-06T12:00:00Z", // 4h pre-kick
    ...partial,
  };
}

test("E4 classify: missing / stale / usable", () => {
  assert.equal(
    classifyAvailabilitySnapshot({ kickoffIso: KICK }),
    "unavailable_missing",
  );
  assert.equal(
    classifyAvailabilitySnapshot({
      kickoffIso: KICK,
      availability: usableAv({
        captureTimestamp: "2025-09-07T00:00:00Z",
        home: { qbStatus: "out", keyOffenseOut: true, keyDefenseOut: false },
        away: { qbStatus: "active", keyOffenseOut: false, keyDefenseOut: false },
      }),
    }),
    "stale_or_post_kick",
  );
  assert.equal(
    classifyAvailabilitySnapshot({
      kickoffIso: KICK,
      availability: usableAv({
        home: { qbStatus: "active", keyOffenseOut: false, keyDefenseOut: false },
        away: { qbStatus: "active", keyOffenseOut: false, keyDefenseOut: false },
      }),
    }),
    "usable_pre_kick",
  );
});

test("E4 join: never coerce null/false missing → injuryKnown false", () => {
  assert.equal(coerceInjuryKnownForbidden(null), null);
  assert.equal(coerceInjuryKnownForbidden(undefined), null);
  assert.equal(coerceInjuryKnownForbidden(false), null);
  assert.equal(coerceInjuryKnownForbidden(true), true);

  const missing = joinE4Labels({ eventId: "x", kickoffIso: KICK });
  assert.equal(missing.injuryKnown, null);
  assert.equal(missing.qbOut, null);
  assert.ok(missing.missing.includes("injury_unavailable"));

  const stale = joinE4Labels({
    eventId: "x",
    kickoffIso: KICK,
    availability: usableAv({
      captureTimestamp: "2025-09-06T17:00:00Z", // after kick
      home: { qbStatus: "out", keyOffenseOut: true, keyDefenseOut: null },
      away: { qbStatus: "active", keyOffenseOut: false, keyDefenseOut: false },
    }),
  });
  assert.equal(stale.snapshotClass, "stale_or_post_kick");
  assert.equal(stale.injuryKnown, null);
  assert.equal(stale.qbOut, null);

  const known = joinE4Labels({
    eventId: "x",
    kickoffIso: KICK,
    availability: usableAv({
      home: { qbStatus: "out", keyOffenseOut: null, keyDefenseOut: null },
      away: { qbStatus: "active", keyOffenseOut: false, keyDefenseOut: false },
    }),
  });
  assert.equal(known.injuryKnown, true);
  assert.equal(known.qbOut, true);
  assert.equal(known.keyPlayerOut, null); // null key flags not coerced
});

test("E4 known QB out: conservative margin tilt + σ widen (behavioral)", () => {
  const strength = strengthFixture();
  const pre = pregameHome();
  const base = predictScoreMargin({ pregame: pre, strength });
  const withQb = predictScoreMargin({
    pregame: pre,
    strength,
    availability: usableAv({
      home: { qbStatus: "out", keyOffenseOut: false, keyDefenseOut: false },
      away: { qbStatus: "active", keyOffenseOut: false, keyDefenseOut: false },
    }),
  });
  assert.equal(base.ok && withQb.ok, true);
  if (!base.ok || !withQb.ok) return;
  assert.ok(withQb.marginMean < base.marginMean - 2.5);
  assert.ok(withQb.marginSd > base.marginSd);
  assert.ok(withQb.featuresUsed.includes("e4_home_qb_out"));
  assert.ok(!withQb.missingOptional.includes("injury_unavailable"));
});

test("E4 known key offense out (no QB): smaller tilt", () => {
  const adj = e4ConservativeAdjust({
    kickoffIso: KICK,
    availability: usableAv({
      home: { qbStatus: "active", keyOffenseOut: true, keyDefenseOut: false },
      away: { qbStatus: "active", keyOffenseOut: false, keyDefenseOut: false },
    }),
  });
  assert.equal(adj.marginTiltPoints, -E4_POLICY.keyOffenseOutMarginTiltPoints);
  assert.equal(adj.uncertaintyScale, E4_POLICY.uncertaintyScaleKnownAbsence);
});

test("E4 stale report: no invented adjustment (means identical to unavailable)", () => {
  const strength = strengthFixture();
  const pre = pregameHome();
  const without = predictScoreMargin({ pregame: pre, strength });
  const stale = predictScoreMargin({
    pregame: pre,
    strength,
    availability: usableAv({
      captureTimestamp: "2025-09-07T00:00:00Z",
      home: { qbStatus: "out", keyOffenseOut: true, keyDefenseOut: false },
      away: { qbStatus: "active", keyOffenseOut: false, keyDefenseOut: false },
    }),
  });
  assert.equal(without.ok && stale.ok, true);
  if (!without.ok || !stale.ok) return;
  assert.equal(without.marginMean, stale.marginMean);
  assert.equal(without.marginSd, stale.marginSd);
  assert.ok(stale.missingOptional.includes("injury_unavailable"));
  assert.ok(!stale.featuresUsed.includes("e4_home_qb_out"));
});

test("E4 unavailable: injuryKnown null; no health invent", () => {
  const labels = joinE4Labels({ eventId: "x", kickoffIso: KICK, availability: null });
  assert.equal(labels.injuryKnown, null);
  const adj = e4ConservativeAdjust({ kickoffIso: KICK });
  assert.equal(adj.marginTiltPoints, 0);
  assert.equal(adj.uncertaintyScale, 1);
});

test("E4 segment conservatism: INSUFFICIENT_DATA when historical n too small", () => {
  const r = evaluateE4SegmentConservatism([
    { eventId: "a", injuryKnown: true, edge: 0.05 },
    { eventId: "b", injuryKnown: null, edge: 0.04 },
  ]);
  assert.equal(r.status, "INSUFFICIENT_DATA");
  assert.equal(r.evidenceClass, "historical_predictive");
});

test("E4 segment conservatism: behavioral synthetic pass/fail shape", () => {
  const known = Array.from({ length: 25 }, (_, i) => ({
    eventId: `k${i}`,
    injuryKnown: true as const,
    edge: 0.08,
  }));
  const nulPass = Array.from({ length: 25 }, (_, i) => ({
    eventId: `n${i}`,
    injuryKnown: null,
    edge: 0.05,
  }));
  const pass = evaluateE4SegmentConservatism([...known, ...nulPass]);
  assert.equal(pass.status, "PASS");

  const nulFail = Array.from({ length: 25 }, (_, i) => ({
    eventId: `f${i}`,
    injuryKnown: null,
    edge: 0.12,
  }));
  const fail = evaluateE4SegmentConservatism([...known, ...nulFail]);
  assert.equal(fail.status, "FAIL");
});

test("E4 behavioral ≠ historical predictive validation", () => {
  // Empty historical join set cannot be rescued by synthetic segment tests.
  const hist = evaluateE4SegmentConservatism([]);
  assert.equal(hist.status, "INSUFFICIENT_DATA");
  assert.equal(hist.evidenceClass, "missing");
});

import test from "node:test";
import assert from "node:assert/strict";
import {
  mlbPreparedWeatherImpact,
  resolvePropSimWeatherImpact,
} from "../src/lib/mlbPreparedWeatherImpact.js";
import {
  PROPS_RESEARCH_PRIORITIES,
  buildPropsResearchRuntimeSnapshot,
} from "../src/lib/propsResearchConnectivity.js";
import {
  archiveRecordsFromPropSimRows,
  clearPropPregameArchiveBuffer,
  enqueuePropPregameArchive,
  peekPropPregameArchiveBuffer,
  propSelectionFingerprint,
  setPropPregameArchivePersistHandler,
} from "../src/lib/propPregameArchive.js";
import {
  minutesTrendWouldAffectMean,
  toPropSimHistoryShapeWithMinutesHoldout,
} from "../src/lib/propMinutesHoldout.js";
import {
  toPropSimHistoryShape,
  type AuthoritativePlayerHistory,
} from "../src/lib/authoritativePlayerHistory.js";
import { buildProjectionMean } from "../src/lib/monteCarlo.js";
import type { PreparedGameContext } from "../src/lib/preparedGameContext.js";

function mlbPrepared(overrides?: {
  exposure?: PreparedGameContext["environment"]["exposure"];
  weather?: PreparedGameContext["environment"]["weather"];
}): PreparedGameContext {
  return {
    version: 1,
    sport: "mlb",
    eventId: "ev1",
    startsAt: "2026-10-26T23:00:00Z",
    observedAtMs: Date.now(),
    expiresAtMs: Date.now() + 60_000,
    homeTeamId: "1",
    awayTeamId: "2",
    lineups: [],
    environment: {
      venue: "Test Park",
      exposure: overrides?.exposure ?? "outdoor",
      weather:
        overrides?.weather === undefined
          ? {
              source: "openweather_forecast",
              locationScope: "venue",
              forecastAtMs: Date.now(),
              tempF: 80,
              windMph: 12,
              gustMph: null,
              windDeg: 180,
              humidity: 40,
              precipChancePct: 10,
              condition: "clear sky",
            }
          : overrides.weather,
    },
  };
}

test("props research priorities cover all ten audit items with path evidence", () => {
  assert.equal(PROPS_RESEARCH_PRIORITIES.length, 10);
  assert.deepEqual(
    PROPS_RESEARCH_PRIORITIES.map((p) => p.id),
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
  );
  for (const item of PROPS_RESEARCH_PRIORITIES) {
    assert.ok(item.path.includes("→") || item.path.includes("NOT"), item.name);
    assert.ok(
      ["connected", "partial", "missing", "unavailable", "shadow_only"].includes(
        item.status,
      ),
    );
  }
});

test("MLB prepared weather is shadow-only by default (subscriber-safe)", () => {
  const prepared = mlbPrepared();
  const shadow = mlbPreparedWeatherImpact(prepared, { applyToSimulation: false });
  assert.equal(shadow.derived, true);
  assert.ok(shadow.impact != null && shadow.impact > 0);
  assert.equal(shadow.appliedToSimulation, false);
  assert.match(shadow.reason, /provisional_temp_only_unvalidated/);

  const resolved = resolvePropSimWeatherImpact({
    sport: "mlb",
    bodyWeatherImpact: null,
    prepared,
    applyPreparedWeatherImpact: false,
  });
  assert.equal(resolved.weatherImpact, null);
  assert.equal(resolved.weatherResearch.appliedToSimulation, false);
});

test("MLB prepared weather applies only when holdout flag is set", () => {
  const prepared = mlbPrepared({ exposure: "outdoor" });
  const resolved = resolvePropSimWeatherImpact({
    sport: "mlb",
    bodyWeatherImpact: null,
    prepared,
    applyPreparedWeatherImpact: true,
  });
  assert.ok(resolved.weatherImpact != null);
  assert.equal(resolved.weatherResearch.appliedToSimulation, true);

  const indoors = resolvePropSimWeatherImpact({
    sport: "mlb",
    bodyWeatherImpact: null,
    prepared: mlbPrepared({ exposure: "indoors", weather: null }),
    applyPreparedWeatherImpact: true,
  });
  assert.equal(indoors.weatherImpact, 0);

  const missingTemp = mlbPreparedWeatherImpact(
    mlbPrepared({
      weather: {
        source: "openweather_forecast",
        locationScope: "venue",
        forecastAtMs: Date.now(),
        tempF: null,
        windMph: 20,
        gustMph: null,
        windDeg: 90,
        humidity: null,
        precipChancePct: null,
        condition: "windy",
      },
    }),
  );
  assert.equal(missingTemp.impact, null);
  assert.match(missingTemp.reason, /temp_missing/);
});

test("request-body weatherImpact still wins; wind alone never invents impact", () => {
  const resolved = resolvePropSimWeatherImpact({
    sport: "mlb",
    bodyWeatherImpact: -0.4,
    prepared: mlbPrepared(),
  });
  assert.equal(resolved.weatherImpact, -0.4);
  assert.equal(resolved.weatherResearch.appliedToSimulation, true);

  const nfl = resolvePropSimWeatherImpact({
    sport: "nfl",
    bodyWeatherImpact: null,
    prepared: { ...mlbPrepared(), sport: "nfl" },
    applyPreparedWeatherImpact: true,
  });
  assert.equal(nfl.weatherImpact, null);
});

test("pregame archive stores exact selection fingerprint without mutating probs", () => {
  clearPropPregameArchiveBuffer();
  setPropPregameArchivePersistHandler(null);
  const records = archiveRecordsFromPropSimRows({
    sport: "nba",
    eventId: "401",
    simulations: 10000,
    rows: [
      {
        player: "A Player",
        athleteId: "99",
        market: "player_points",
        side: "over",
        line: 22.5,
        hitProbability: 0.58,
        overBook: "draftkings",
        overOdds: -110,
        overSourceUpdatedAt: "2026-10-25T12:00:00Z",
        meanProjection: 24.1,
        confidenceScore: 61,
        grade: "B",
      },
      {
        player: "Missing",
        market: "player_points",
        side: "over",
        line: 10,
        hitProbability: null,
      },
    ],
  });
  assert.equal(records.length, 1);
  assert.equal(records[0]!.selection.datasetRole, "pregame_research");
  assert.equal(records[0]!.selection.sportsbook, "draftkings");
  assert.equal(
    records[0]!.selectionFingerprint,
    propSelectionFingerprint(records[0]!.selection),
  );
  enqueuePropPregameArchive(records);
  assert.equal(peekPropPregameArchiveBuffer().length, 1);
  clearPropPregameArchiveBuffer();
});

test("minutesTrend holdout overlay does not change production propsim shape", () => {
  const auth: AuthoritativePlayerHistory = {
    sport: "nba",
    athleteId: "1",
    loadedAtMs: Date.now(),
    labels: ["MIN", "PTS"],
    flat: [
      ...[36, 35, 34, 33, 32].map((min, i) => ({
        eventId: `recent-${i}`,
        date: `2026-10-${20 - i}T00:00:00Z`,
        opponentId: String(i + 2),
        opponentName: `Opp${i}`,
        isHome: i % 2 === 0,
        periodTag: "full",
        stats: { MIN: String(min), PTS: String(20 + i) },
      })),
      ...[22, 21, 20, 19, 18].map((min, i) => ({
        eventId: `early-${i}`,
        date: `2026-10-${10 - i}T00:00:00Z`,
        opponentId: String(i + 20),
        opponentName: `Old${i}`,
        isHome: true,
        periodTag: "full",
        stats: { MIN: String(min), PTS: String(12 + i) },
      })),
    ],
  };
  const prod = toPropSimHistoryShape(auth);
  assert.equal(prod.minutesTrend, undefined);
  const holdout = toPropSimHistoryShapeWithMinutesHoldout(auth);
  assert.ok(holdout.minutesTrend);
  assert.equal(holdout.minutesTrend!.direction, "up");
  assert.equal(minutesTrendWouldAffectMean(holdout.minutesTrend), true);

  const baseMean = buildProjectionMean({
    sport: "nba",
    market: "player_points",
    line: 20,
    side: "Over",
    recentValues: [24, 20, 18, 16, 15],
    vsOpponentValues: [],
    homeValues: [],
    awayValues: [],
    isHome: true,
    discrete: true,
  });
  const withMinutes = buildProjectionMean({
    sport: "nba",
    market: "player_points",
    line: 20,
    side: "Over",
    recentValues: [24, 20, 18, 16, 15],
    vsOpponentValues: [],
    homeValues: [],
    awayValues: [],
    isHome: true,
    discrete: true,
    minutesL5: holdout.minutesTrend!.l5,
    minutesSeason: holdout.minutesTrend!.season,
    minutesDirection: holdout.minutesTrend!.direction,
  });
  assert.ok(baseMean != null && withMinutes != null);
  assert.notEqual(baseMean, withMinutes);
});

test("research runtime snapshot marks defense seating shadow and weather off by default", () => {
  const snap = buildPropsResearchRuntimeSnapshot({
    sport: "nfl",
    weatherImpactApplied: null,
    weatherResearchReason: "not_mlb",
    defenseIndexByFamily: { receiving_yards: 1.02 },
    preparedWeatherPresent: false,
    preparedDepthCharts: 2,
    preparedLineupsComplete: 0,
    opportunityShiftPresent: true,
  });
  assert.equal(snap.researchOnlyFlags.applyPreparedWeatherImpactDefault, false);
  assert.equal(snap.researchOnlyFlags.minutesTrendInPropSimShape, false);
  assert.equal(snap.researchOnlyFlags.defenseIndexSeating, "shadow_only");
  assert.equal(snap.researchOnlyFlags.ncaafReleaseGatesUnchanged, true);
  assert.equal(snap.runtime.defenseIndexByFamilyKeys, 1);
});

test("research inventory + archive helpers add negligible CPU vs Coach target window", () => {
  const prepared = mlbPrepared();
  const t0 = performance.now();
  for (let i = 0; i < 2000; i++) {
    resolvePropSimWeatherImpact({
      sport: "mlb",
      bodyWeatherImpact: null,
      prepared,
      applyPreparedWeatherImpact: false,
    });
    buildPropsResearchRuntimeSnapshot({
      sport: "mlb",
      weatherImpactApplied: null,
      preparedWeatherPresent: true,
      opportunityShiftPresent: true,
    });
  }
  const elapsedMs = performance.now() - t0;
  // 2000 iterations of pure helpers should stay far below 1s; live Coach target is 15–30s.
  assert.ok(elapsedMs < 250, `research helpers too slow: ${elapsedMs}ms`);
});

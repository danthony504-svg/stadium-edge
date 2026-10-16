import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import test from "node:test";

import type { FootballOppDefenseSlice } from "./footballRushDefense.ts";
import {
  auditPropContextFactors,
  buildPropProjectionTrace,
  defenseIndexByFamilyFromPack,
  shouldApplyPostSimOppDefenseTilt,
  weatherImpactFromGameEnv,
} from "./propContextPipeline.ts";

const nflWeakRush: FootballOppDefenseSlice = {
  rush: {
    rushingYardsAllowedPerGame: 145,
    yardsPerRushAllowed: 4.8,
    sampleSize: 8,
    stuffs: null,
    teamName: "Weak D",
  },
  pass: {
    passingYardsAllowedPerGame: 180,
    yardsPerPassAllowed: 6.2,
    sampleSize: 8,
    teamName: "Weak D",
  },
  teamName: "Weak D",
  pointsAgainst: 28,
};

const nflStingyRush: FootballOppDefenseSlice = {
  rush: {
    rushingYardsAllowedPerGame: 85,
    yardsPerRushAllowed: 3.5,
    sampleSize: 10,
    stuffs: null,
    teamName: "Stingy D",
  },
  pass: null,
  teamName: "Stingy D",
  pointsAgainst: 16,
};

test("defenseIndex: weak rush D raises rush_yds index; stingy lowers it", () => {
  const weak = defenseIndexByFamilyFromPack("nfl", nflWeakRush);
  const stingy = defenseIndexByFamilyFromPack("nfl", nflStingyRush);
  assert.ok(weak);
  assert.ok(stingy);
  assert.ok(weak!.rush_yds! > 1);
  assert.ok(stingy!.rush_yds! < 1);
  // Directional: weak > stingy
  assert.ok(weak!.rush_yds! > stingy!.rush_yds!);
});

test("defenseIndex: thin sample stays unknown (null)", () => {
  const thin: FootballOppDefenseSlice = {
    rush: {
      rushingYardsAllowedPerGame: 200,
      yardsPerRushAllowed: 5,
      sampleSize: 1,
      stuffs: null,
      teamName: "Tiny",
    },
    pass: null,
    teamName: "Tiny",
  };
  assert.equal(defenseIndexByFamilyFromPack("nfl", thin), null);
});

test("defenseIndex: missing pack → null (never invent)", () => {
  assert.equal(defenseIndexByFamilyFromPack("nfl", null), null);
  assert.equal(defenseIndexByFamilyFromPack("nba", undefined), null);
});

test("NBA pointsAgainst maps to points family index", () => {
  const pack: FootballOppDefenseSlice = {
    rush: null,
    pass: null,
    teamName: "Lakers",
    pointsAgainst: 125,
  };
  const idx = defenseIndexByFamilyFromPack("nba", pack);
  assert.ok(idx?.points != null && idx.points > 1);
});

test("weatherImpact: dome → null; cold outdoor → negative; warm → positive", () => {
  assert.equal(
    weatherImpactFromGameEnv("mlb", { climateControlled: true, weather: { tempF: 90 } }),
    null,
  );
  assert.equal(
    weatherImpactFromGameEnv("mlb", { park: { dome: true }, weather: { tempF: 90 } }),
    null,
  );
  const cold = weatherImpactFromGameEnv("mlb", {
    weather: { tempF: 42, precipChancePct: 10 },
  });
  const warm = weatherImpactFromGameEnv("mlb", {
    weather: { tempF: 88, precipChancePct: 5 },
  });
  assert.ok(cold != null && cold < 0);
  assert.ok(warm != null && warm > 0);
  // NFL env does not feed prop MC weatherImpact (sport-specific).
  assert.equal(
    weatherImpactFromGameEnv("nfl", {
      weather: { tempF: 20, windMph: 25, precipChancePct: 80 },
      impactRating: "Very Unfavorable",
    }),
    null,
  );
});

test("weatherImpact: missing readings → null (unknown, not invented)", () => {
  assert.equal(weatherImpactFromGameEnv("mlb", { weather: {} }), null);
  assert.equal(weatherImpactFromGameEnv("mlb", null), null);
});

test("projection trace: adjustments move mean up and down; missing baseline stays null", () => {
  const up = buildPropProjectionTrace({
    sport: "nfl",
    market: "player_rush_yds",
    side: "Over",
    line: 64.5,
    baselineMean: 70,
    adjustments: [
      { name: "opp_defense", source: "defenseIndexByFamily.rush_yds", factor: 1.08 },
      { name: "venue", source: "preSim.venue", factor: 1.02 },
      { name: "opportunity", source: "injury_vacancy", factor: 1.0 },
    ],
  });
  assert.ok(up.finalMean != null && up.finalMean > 70);
  assert.ok(up.combinedFactor > 1);

  const down = buildPropProjectionTrace({
    sport: "nfl",
    market: "player_rush_yds",
    side: "Over",
    line: 64.5,
    baselineMean: 70,
    adjustments: [
      { name: "opp_defense", source: "defenseIndexByFamily.rush_yds", factor: 0.92 },
    ],
  });
  assert.ok(down.finalMean != null && down.finalMean < 70);

  const unknown = buildPropProjectionTrace({
    sport: "mlb",
    market: "batter_home_runs",
    side: "Over",
    line: 0.5,
    baselineMean: null,
    adjustments: [
      { name: "weather", source: "weatherImpact", factor: 1.05 },
    ],
  });
  assert.equal(unknown.finalMean, null);
  assert.match(unknown.notes.join(" "), /baseline_unknown/);
});

test("double-count guard: skip post-sim tilt when projection used defenseIndex", () => {
  assert.equal(
    shouldApplyPostSimOppDefenseTilt({ projectionUsedDefenseIndex: true }),
    false,
  );
  assert.equal(
    shouldApplyPostSimOppDefenseTilt({ projectionUsedDefenseIndex: false }),
    true,
  );
});

test("injury audit: missing/ambiguous never reported as healthy", () => {
  const missing = auditPropContextFactors({
    sport: "nfl",
    weatherStatus: "missing_unknown",
    defenseStatus: "missing_unknown",
    venueShiftApplied: false,
    venueDataPresent: false,
    injuryVacancyApplied: false,
    injuryFeedPresent: false,
    playerInjuryStatus: "unknown",
  });
  const inj = missing.find((f) => f.factor === "injuries_lineups")!;
  assert.equal(inj.status, "missing_unknown");
  assert.match(inj.detail, /unknown/i);
  assert.doesNotMatch(inj.detail, /\bhealthy\b/i);

  const ambiguous = auditPropContextFactors({
    sport: "nba",
    weatherStatus: "fetched_unused",
    defenseStatus: "fetched_used_in_projection",
    venueShiftApplied: true,
    venueDataPresent: true,
    injuryVacancyApplied: false,
    injuryFeedPresent: true,
    playerInjuryStatus: "ambiguous",
  });
  const amb = ambiguous.find((f) => f.factor === "injuries_lineups")!;
  assert.equal(amb.status, "missing_unknown");
  assert.match(amb.detail, /Ambiguous/);
  assert.doesNotMatch(amb.detail, /\bhealthy\b/i);
});

test("representative NFL rush Over vs weak D and MLB HR warm park traces", () => {
  const rushIdx = defenseIndexByFamilyFromPack("nfl", nflWeakRush)!;
  const nflTrace = buildPropProjectionTrace({
    sport: "nfl",
    market: "player_rush_yds",
    side: "Over",
    line: 72.5,
    baselineMean: 68,
    adjustments: [
      {
        name: "opp_defense",
        source: "team-defense box-score → defenseIndexByFamily",
        factor: rushIdx.rush_yds!,
      },
      {
        name: "opportunity",
        source: "ESPN injuries vacancy (OUT only)",
        factor: 1.04,
      },
      {
        name: "venue",
        source: "home/away series preSim",
        factor: 1.0,
      },
    ],
  });
  assert.ok(nflTrace.finalMean! > 68);

  const wx = weatherImpactFromGameEnv("mlb", {
    weather: { tempF: 86, precipChancePct: 5 },
    park: { hrIndex: 112, altitudeFt: 5200 },
  });
  assert.ok(wx != null && wx > 0);
  // MC applies ~1 + w*0.1 for HR markets
  const weatherFactor = 1 + wx! * 0.1;
  const mlbTrace = buildPropProjectionTrace({
    sport: "mlb",
    market: "batter_home_runs",
    side: "Over",
    line: 0.5,
    baselineMean: 0.42,
    adjustments: [
      {
        name: "weather_park",
        source: "OpenWeather + park hrIndex → weatherImpact",
        factor: weatherFactor,
      },
      {
        name: "opp_pitching",
        source: "team ERA → defenseIndexByFamily.home_runs",
        factor: 1.06,
      },
    ],
  });
  assert.ok(mlbTrace.finalMean! > 0.42);
});

test("cold/warm timing: defense+weather resolve is sync and sub-ms (no network)", () => {
  const coldStart = performance.now();
  for (let i = 0; i < 500; i++) {
    defenseIndexByFamilyFromPack("nfl", nflWeakRush);
    weatherImpactFromGameEnv("mlb", {
      weather: { tempF: 70, precipChancePct: 20 },
      park: { hrIndex: 100 },
    });
  }
  const coldMs = performance.now() - coldStart;

  const warmStart = performance.now();
  for (let i = 0; i < 500; i++) {
    defenseIndexByFamilyFromPack("nfl", nflWeakRush);
    weatherImpactFromGameEnv("mlb", {
      weather: { tempF: 70, precipChancePct: 20 },
      park: { hrIndex: 100 },
    });
  }
  const warmMs = performance.now() - warmStart;

  // Pure local math — both passes should be well under 50ms for 500 iters.
  assert.ok(coldMs < 50, `cold ${coldMs}ms`);
  assert.ok(warmMs < 50, `warm ${warmMs}ms`);
});

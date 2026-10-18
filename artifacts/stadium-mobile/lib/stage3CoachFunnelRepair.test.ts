/**
 * Stage 3 Coach funnel repair — explicit anytime TD lock + confidence floors.
 * Pure control-flow / lock tests; no deploy / OTA / production mutation.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  parseCoachAskMarketConstraint,
  propMarketKeyAllowed,
  filterPropPoolByAskMarkets,
} from "./coachAskMarketFilter.ts";
import {
  matchExplicitMarketLocks,
  askHasExplicitMarketLock,
} from "./explicitMarketLock.ts";
import {
  COACH_SIM_MIN_CONFIDENCE,
  COACH_SIM_MIN_GRADE,
  meetsCoachSimQualityFloor,
} from "./gameSimQualityGates.ts";
import {
  qualifyCoachCandidate,
  withCoachQualification,
} from "./coach/qualifyCoachCandidate.ts";
import {
  withExactMarket10kProvenance,
  historicalModelProvenance,
  exactMarket10kProvenance,
  propProvenanceAllowsSeating,
} from "./coachPropProbabilityProvenance.ts";
import { footballPropsOnlyMaxCandidates } from "./coachFootballPropsOnly.ts";
import { askAllowsNcaafPlayerProps } from "./boardScanPropDelivery.ts";

const BLOCKED_FOR_ANYTIME = [
  "player_first_td",
  "player_pass_tds",
  "player_rush_tds",
  "player_reception_tds",
  "player_pass_yds",
  "player_rush_yds",
] as const;

function assertAnytimeOnly(ask: string) {
  const m = matchExplicitMarketLocks(ask);
  assert.ok(m, ask);
  assert.ok(m!.ids.includes("fb_anytime_td"), `${ask} → ${m!.ids.join(",")}`);
  assert.deepEqual(m!.allowedMarketKeys, ["player_anytime_td"]);
  const c = parseCoachAskMarketConstraint(ask);
  assert.equal(c.propsOnly, true, ask);
  assert.deepEqual(c.allowedMarketKeys, ["player_anytime_td"]);
  for (const bad of BLOCKED_FOR_ANYTIME) {
    assert.equal(propMarketKeyAllowed(bad, c.allowedMarketKeys), false, `${ask} allows ${bad}`);
  }
}

test("PART A: NFL explicit anytime TD locks only player_anytime_td", () => {
  assertAnytimeOnly("5 leg NFL anytime touchdown picks");
  assertAnytimeOnly("5 leg anytime TD");
  assertAnytimeOnly("6 leg ATD props");
  assertAnytimeOnly("anytime touchdown parlay");
});

test("PART A: NCAAF explicit anytime TD locks only player_anytime_td", () => {
  assertAnytimeOnly("5 leg college football anytime touchdown picks");
  assertAnytimeOnly("5 leg NCAAF anytime TD");
  assertAnytimeOnly("college football ATD props");
  assert.equal(
    askAllowsNcaafPlayerProps("5 leg college football anytime touchdown picks"),
    true,
  );
});

test("PART A: bare touchdown / td keeps broader TD family", () => {
  for (const ask of ["5 leg touchdown", "5 leg td", "7 leg touchdowns tonight"]) {
    const m = matchExplicitMarketLocks(ask);
    assert.ok(m?.ids.includes("fb_touchdowns"), ask);
    assert.equal(m!.ids.includes("fb_anytime_td"), false, ask);
    const keys = m!.allowedMarketKeys;
    assert.ok(keys.includes("player_anytime_td"), ask);
    assert.ok(keys.includes("player_first_td"), ask);
    assert.ok(keys.includes("player_pass_tds"), ask);
  }
});

test("PART A: first TD stays first-only; pass TD phrasing still reaches pass_tds via broad lock", () => {
  const first = parseCoachAskMarketConstraint("4 leg first touchdown");
  assert.deepEqual(first.allowedMarketKeys, ["player_first_td"]);

  const passPhrase = parseCoachAskMarketConstraint("5 leg passing TDs");
  assert.ok(passPhrase.allowedMarketKeys?.includes("player_pass_tds"));
  // Not an explicit anytime ask — must not collapse to ATD-only.
  assert.notDeepEqual(passPhrase.allowedMarketKeys, ["player_anytime_td"]);
});

test("PART A: pool filter for anytime excludes First TD / pass TD rows", () => {
  const c = parseCoachAskMarketConstraint("5 leg NFL anytime touchdown picks");
  const pool = [
    { marketKey: "player_anytime_td", sport: "nfl" },
    { marketKey: "player_first_td", sport: "nfl" },
    { marketKey: "player_pass_tds", sport: "nfl" },
    { marketKey: "player_rush_yds", sport: "nfl" },
    { marketKey: "player_anytime_td", sport: "ncaaf" },
  ];
  const kept = filterPropPoolByAskMarkets(pool, c.allowedMarketKeys);
  assert.deepEqual(
    kept.map((r) => r.marketKey),
    ["player_anytime_td", "player_anytime_td"],
  );
});

test("PART A: scan candidate budget unchanged (no budget increase)", () => {
  // Cap is min(mixCap, max(target×6, 40)) — never raise above prior ceilings.
  const large = footballPropsOnlyMaxCandidates(5, 10_000);
  const mid = footballPropsOnlyMaxCandidates(5, 357);
  const small = footballPropsOnlyMaxCandidates(5, 20);
  assert.ok(large <= 40, `large pool cap ${large} must not exceed 40`);
  assert.ok(mid <= 40, `mid pool cap ${mid} must not exceed 40`);
  assert.ok(small <= 40, `small pool cap ${small} must not exceed 40`);
  assert.equal(large, mid);
  // Small pools may be mixCap-limited below 40; must not grow vs prior formula.
  assert.ok(small <= large);
});

test("PART B/C: confidence floor 52 and grade C+ unchanged", () => {
  assert.equal(COACH_SIM_MIN_CONFIDENCE, 52);
  assert.equal(COACH_SIM_MIN_GRADE, "C+");
  assert.equal(meetsCoachSimQualityFloor({ grade: "C+", confidencePct: 52 }), true);
  assert.equal(meetsCoachSimQualityFloor({ grade: "C+", confidencePct: 51 }), false);
  assert.equal(meetsCoachSimQualityFloor({ grade: "C", confidencePct: 60 }), false);
});

test("PART C: exact_market_10k required; historical-only cannot qualify", () => {
  const histOnly = historicalModelProvenance({
    hitProbability: 0.55,
    sport: "nfl",
    marketKey: "player_anytime_td",
    athleteId: "4429059",
    eventId: "57418b2cf5aca558b3c98eafac1e264a",
    side: "Over",
    line: 0.5,
  });
  // Option C empty allowlist → historical ATD is insufficient, not seating-grade.
  assert.notEqual(histOnly.source, "validated_historical_model");
  assert.equal(
    propProvenanceAllowsSeating(histOnly, {
      athleteId: "4429059",
      eventId: "57418b2cf5aca558b3c98eafac1e264a",
      propMarketKey: "player_anytime_td",
      propSide: "Over",
      propLine: 0.5,
    }),
    false,
  );

  const histPick = {
    isProp: true as const,
    sport: "nfl",
    market: "Anytime TD",
    propMarketKey: "player_anytime_td",
    propSide: "Over" as const,
    propLine: 0.5,
    odds: 150,
    player: "Woody Marks",
    athleteId: "4429059",
    eventId: "57418b2cf5aca558b3c98eafac1e264a",
    game: "Houston Texans @ Jacksonville Jaguars",
    pick: "Woody Marks Anytime TD",
    propsOnlyTicket: true,
    finalAiScore: {
      grade: "B",
      confidencePct: 70,
      simHit: 0.55,
      edgePct: 8,
      propProbabilityProvenance: histOnly,
    },
    propProbabilityProvenance: histOnly,
  };
  const histQ = qualifyCoachCandidate(histPick, { requestStyle: "props_only", isProp: true });
  assert.equal(histQ.status, "rejected");
  assert.equal(histQ.reason, "insufficient_sim_provenance");

  const exactProv = exactMarket10kProvenance({
    hitProbability: 0.55,
    simulations: 10_000,
    sport: "nfl",
    marketKey: "player_anytime_td",
    athleteId: "4429059",
    eventId: "57418b2cf5aca558b3c98eafac1e264a",
    side: "Over",
    line: 0.5,
  });
  assert.equal(exactProv.source, "exact_market_10k");

  const exact = withExactMarket10kProvenance({
    isProp: true as const,
    sport: "nfl",
    market: "Anytime TD",
    propMarketKey: "player_anytime_td",
    propSide: "Over" as const,
    propLine: 0.5,
    odds: 150,
    player: "Woody Marks",
    athleteId: "4429059",
    eventId: "57418b2cf5aca558b3c98eafac1e264a",
    game: "Houston Texans @ Jacksonville Jaguars",
    pick: "Woody Marks Anytime TD",
    propsOnlyTicket: true,
    finalAiScore: {
      grade: "B",
      confidencePct: 70,
      simHit: 0.55,
      edgePct: 8,
    },
  });
  const exactQ = qualifyCoachCandidate(exact, { requestStyle: "props_only", isProp: true });
  assert.equal(exactQ.status, "qualified");
  assert.equal(exactQ.reason, "ok");
});

test("PART C: confidence_floor rejects when holistic confidencePct < 52 (no hit→confidence conversion)", () => {
  // Server confidenceScore (monteCarlo confidenceFromHit) is a different metric.
  // Coach seating uses holistic confidencePct — do not convert hit→confidence.
  const pick = withExactMarket10kProvenance({
    isProp: true as const,
    sport: "nfl",
    market: "Anytime TD",
    propMarketKey: "player_anytime_td",
    propSide: "Over" as const,
    propLine: 0.5,
    odds: 165,
    player: "Parker Washington",
    athleteId: "4432620",
    eventId: "evt-1",
    game: "HOU @ JAX",
    pick: "Parker Washington Anytime TD",
    propsOnlyTicket: true,
    finalAiScore: {
      grade: "C+",
      confidencePct: 48, // holistic below floor
      simHit: 0.416,
      edgePct: 3.8,
    },
  });
  const q = qualifyCoachCandidate(pick, { requestStyle: "props_only", isProp: true });
  assert.equal(q.status, "rejected");
  assert.equal(q.reason, "confidence_floor");

  const tagged = withCoachQualification(pick, { requestStyle: "props_only", isProp: true });
  assert.equal(tagged.qualificationStatus, "rejected");
  assert.equal(tagged.qualificationReason, "confidence_floor");
});

test("PART C: askHasExplicitMarketLock true for anytime / ATD / bare TD", () => {
  assert.equal(askHasExplicitMarketLock("anytime touchdown"), true);
  assert.equal(askHasExplicitMarketLock("ATD"), true);
  assert.equal(askHasExplicitMarketLock("touchdowns"), true);
});

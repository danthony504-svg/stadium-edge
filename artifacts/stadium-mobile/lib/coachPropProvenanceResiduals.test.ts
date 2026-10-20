/**
 * Adversarial probes for the four Option C residuals — each must fail closed.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  altLadderSimulationCaption,
  clearTrustedExactEvidenceForTests,
  exactMarket10kProvenance,
  getExactMarketCoverageImpact,
  hasTrustedExactMarketEvidence,
  historicalModelProvenance,
  insufficientPropProvenance,
  propProvenanceAllowsSeating,
  resetExactMarketCoverageImpactForTests,
  withExactMarket10kProvenance,
  SIM_FACTOR_LABEL_EXACT_10K,
} from "./coachPropProbabilityProvenance.ts";
import {
  coachCandidateIsQualified,
  evaluateCoachQualification,
  withCoachQualification,
} from "./coach/qualifyCoachCandidate.ts";
import { boardLegPoolRole } from "./ticketStaging.ts";
import { fillReservedPropSlots } from "./boardScanPropDelivery.ts";
import {
  filterTicketPicksPreservingTicket,
  qualifiesAltPick,
  propSimEdgeStagingQualifies,
} from "./pickRecommendation.ts";
import { scoredLegFromQualifiedCandidate } from "./postLeanFinalFill.ts";
import { COACH_SIM_MIN_CONFIDENCE, COACH_SIM_MIN_GRADE } from "./gameSimQualityGates.ts";

test.beforeEach(() => {
  clearTrustedExactEvidenceForTests();
  resetExactMarketCoverageImpactForTests();
});

const base = {
  isProp: true as const,
  sport: "ncaaf",
  market: "Anytime TD",
  propMarketKey: "player_anytime_td",
  propSide: "Over" as const,
  propLine: 0.5,
  odds: -120,
  player: "Sedrick Alexander",
  athleteId: "5030333",
  eventId: "evt-ark-van",
  game: "Arkansas @ Vanderbilt",
  pick: "Sedrick Alexander Over 0.5 Anytime TD",
};

test("floors unchanged", () => {
  assert.equal(COACH_SIM_MIN_CONFIDENCE, 52);
  assert.equal(COACH_SIM_MIN_GRADE, "C+");
});

test("evidenceId cannot authorize a different athlete/event/market/side/line", () => {
  const trusted = exactMarket10kProvenance({
    hitProbability: 0.61,
    simulations: 10_000,
    sport: "nfl",
    marketKey: "player_pass_yds",
    athleteId: "ath-a",
    eventId: "evt-a",
    side: "Over",
    line: 249.5,
  });
  assert.equal(trusted.source, "exact_market_10k");
  assert.ok(trusted.evidenceId);

  // Same evidenceId + mutated provenance identity fields → fail closed.
  const mutate = (
    patch: Partial<typeof trusted>,
    candidate: Omit<typeof base, "propSide"> & { propSide: "Over" | "Under" },
  ) => {
    const forged = { ...trusted, ...patch };
    assert.equal(propProvenanceAllowsSeating(forged, candidate), false);
  };
  mutate({ athleteId: "ath-b" }, { ...base, athleteId: "ath-b", eventId: "evt-a", propMarketKey: "player_pass_yds", propLine: 249.5, sport: "nfl" });
  mutate({ eventId: "evt-b" }, { ...base, athleteId: "ath-a", eventId: "evt-b", propMarketKey: "player_pass_yds", propLine: 249.5, sport: "nfl" });
  mutate({ marketKey: "player_rush_yds" }, { ...base, athleteId: "ath-a", eventId: "evt-a", propMarketKey: "player_rush_yds", propLine: 249.5, sport: "nfl" });
  mutate({ side: "Under" }, { ...base, athleteId: "ath-a", eventId: "evt-a", propMarketKey: "player_pass_yds", propSide: "Under", propLine: 249.5, sport: "nfl" });
  mutate({ line: 275.5 }, { ...base, athleteId: "ath-a", eventId: "evt-a", propMarketKey: "player_pass_yds", propLine: 275.5, sport: "nfl" });

  // Reuse evidenceId on a completely different candidate → fail closed.
  assert.equal(
    propProvenanceAllowsSeating(trusted, {
      athleteId: "ath-other",
      eventId: "evt-other",
      propMarketKey: "player_pass_yds",
      propSide: "Over",
      propLine: 249.5,
    }),
    false,
  );
});

test("cleared registry: stale evidenceId cannot authorize a later scan", () => {
  const first = exactMarket10kProvenance({
    hitProbability: 0.55,
    simulations: 10_000,
    sport: "nba",
    marketKey: "player_points",
    athleteId: "nba-1",
    eventId: "evt-nba",
    side: "Over",
    line: 24.5,
  });
  assert.equal(propProvenanceAllowsSeating(first, {
    athleteId: "nba-1",
    eventId: "evt-nba",
    propMarketKey: "player_points",
    propSide: "Over",
    propLine: 24.5,
  }), true);

  // Simulate process/test boundary between scans.
  clearTrustedExactEvidenceForTests();

  assert.equal(
    propProvenanceAllowsSeating(first, {
      athleteId: "nba-1",
      eventId: "evt-nba",
      propMarketKey: "player_points",
      propSide: "Over",
      propLine: 24.5,
    }),
    false,
    "stale evidenceId after registry clear must not seat",
  );
  // Unrelated later identity also fails (no live registration).
  assert.equal(
    propProvenanceAllowsSeating(
      {
        ...first,
        athleteId: "mlb-9",
        eventId: "evt-mlb",
        marketKey: "batter_hits",
        line: 1.5,
      },
      {
        athleteId: "mlb-9",
        eventId: "evt-mlb",
        propMarketKey: "batter_hits",
        propSide: "Over",
        propLine: 1.5,
      },
    ),
    false,
  );
});

test("residual 1: wrong athlete/event simulation cannot authorize seating", () => {
  const trusted = exactMarket10kProvenance({
    hitProbability: 0.62,
    simulations: 10_000,
    sport: "ncaaf",
    marketKey: "player_anytime_td",
    athleteId: "5030333",
    eventId: "evt-ark-van",
    side: "Over",
    line: 0.5,
  });
  assert.equal(trusted.source, "exact_market_10k");

  // Wrong athlete
  assert.equal(
    propProvenanceAllowsSeating(trusted, {
      ...base,
      athleteId: "9999999",
    }),
    false,
  );
  // Wrong event
  assert.equal(
    propProvenanceAllowsSeating(trusted, {
      ...base,
      eventId: "evt-other-game",
    }),
    false,
  );
  // Wrong line
  assert.equal(
    propProvenanceAllowsSeating(trusted, {
      ...base,
      propLine: 1.5,
    }),
    false,
  );
  // Matching identity
  assert.equal(propProvenanceAllowsSeating(trusted, base), true);

  // Missing identity fail-closed
  const missing = exactMarket10kProvenance({
    hitProbability: 0.7,
    simulations: 10_000,
    sport: "nfl",
    marketKey: "player_pass_yds",
    athleteId: null,
    eventId: "evt-1",
    side: "Over",
    line: 250.5,
  });
  assert.equal(missing.source, "insufficient_evidence");
  assert.equal(missing.nullReason, "missing_exact_identity");
  const impact = getExactMarketCoverageImpact();
  assert.ok(impact.rejectedMissingIdentity >= 1);
  assert.ok(impact.missingAthleteId >= 1);
});

test("residual 2: forged exact-market stamp does not authorize seating", () => {
  const forged = {
    source: "exact_market_10k" as const,
    hitProbability: 0.7,
    simulations: 10_000,
    nullReason: null,
    hitReliability: null,
    sport: "nfl",
    marketKey: "player_pass_yds",
    athleteId: "111",
    eventId: "evt-x",
    side: "Over" as const,
    line: 250.5,
    evidenceId: "tev_fake_not_registered",
  };
  assert.equal(propProvenanceAllowsSeating(forged, forged), false);
  assert.equal(propProvenanceAllowsSeating(forged), false);

  const forgedNoToken = {
    source: "exact_market_10k" as const,
    hitProbability: 0.7,
    simulations: 10_000,
    nullReason: null,
    hitReliability: null,
    sport: "nfl",
    marketKey: "player_pass_yds",
    athleteId: "111",
    eventId: "evt-x",
    side: "Over" as const,
    line: 250.5,
  };
  assert.equal(propProvenanceAllowsSeating(forgedNoToken as never), false);

  const q = evaluateCoachQualification(
    {
      ...base,
      grade: "A",
      confidencePct: 70,
      edgePct: 5,
      simHit: 0.7,
      propProbabilityProvenance: forged,
    },
    { isProp: true },
  );
  assert.equal(q.status, "rejected");
  assert.equal(q.reason, "insufficient_sim_provenance");
});

test("residual 3: stale qualificationStatus=qualified cannot bypass provenance", () => {
  const pick = {
    ...base,
    grade: "B",
    confidencePct: 58,
    edgePct: 4,
    simHit: 0.55,
    qualificationStatus: "qualified" as const,
    propProbabilityProvenance: insufficientPropProvenance({
      sport: "ncaaf",
      marketKey: "player_anytime_td",
      nullReason: "stat_mapping_failed",
    }),
    finalAiScore: {
      grade: "B",
      confidencePct: 58,
      edgePct: 4,
      simHit: 0.55,
      propProbabilityProvenance: insufficientPropProvenance({
        sport: "ncaaf",
        marketKey: "player_anytime_td",
      }),
    },
  };
  assert.equal(
    coachCandidateIsQualified(pick as never, { requestStyle: "props_only", isProp: true }),
    false,
  );
  const tagged = withCoachQualification(pick, {
    requestStyle: "props_only",
    isProp: true,
  });
  assert.equal(tagged.qualificationStatus, "rejected");
  assert.equal(tagged.qualificationReason, "insufficient_sim_provenance");
});

test("residual 4: ALT caption does not claim 10K without verified exact evidence", () => {
  const unsupported = altLadderSimulationCaption({
    parent: {
      ...base,
      propProbabilityProvenance: historicalModelProvenance({
        hitProbability: 0.6,
        sport: "ncaaf",
        marketKey: "player_anytime_td",
      }),
    },
    alts: [
      { line: 0.5, side: "Over" },
      { line: 1.5, side: "Over" },
    ],
  });
  assert.equal(
    unsupported,
    "Alternate lines · Safest → Best → Value → High Risk",
  );
  assert.ok(!unsupported.toLowerCase().includes("10k"));

  // Verified per-line evidence → 10K caption
  exactMarket10kProvenance({
    hitProbability: 0.55,
    simulations: 10_000,
    sport: "ncaaf",
    marketKey: "player_anytime_td",
    athleteId: "5030333",
    eventId: "evt-ark-van",
    side: "Over",
    line: 0.5,
  });
  exactMarket10kProvenance({
    hitProbability: 0.4,
    simulations: 10_000,
    sport: "ncaaf",
    marketKey: "player_anytime_td",
    athleteId: "5030333",
    eventId: "evt-ark-van",
    side: "Over",
    line: 1.5,
  });
  assert.equal(
    hasTrustedExactMarketEvidence({
      athleteId: "5030333",
      eventId: "evt-ark-van",
      propMarketKey: "player_anytime_td",
      propSide: "Over",
      propLine: 0.5,
    }),
    true,
  );
  const verified = altLadderSimulationCaption({
    parent: base,
    alts: [
      { line: 0.5, side: "Over" },
      { line: 1.5, side: "Over" },
    ],
  });
  assert.ok(verified.includes("10K Simulation"));

  // Missing one line → no 10K claim
  const partial = altLadderSimulationCaption({
    parent: base,
    alts: [
      { line: 0.5, side: "Over" },
      { line: 2.5, side: "Over" },
    ],
  });
  assert.ok(!partial.toLowerCase().includes("10k"));
});

test("provenance preservation: seating paths reject unapproved / accept trusted", () => {
  const bad = {
    ...base,
    propProbabilityProvenance: historicalModelProvenance({
      hitProbability: 0.6,
      sport: "ncaaf",
      marketKey: "player_anytime_td",
    }),
    finalAiScore: {
      grade: "B+",
      confidencePct: 60,
      edgePct: 5,
      simHit: 0.6,
      simAligned: true,
      recommends: true,
      composite: 7,
      propProbabilityProvenance: historicalModelProvenance({
        hitProbability: 0.6,
        sport: "ncaaf",
        marketKey: "player_anytime_td",
      }),
      propHolistic: {
        grade: "B+",
        confidencePct: 60,
        composite: 7,
        missingCount: 2,
        factors: [
          { key: "simulation", label: "x", score: 7, applicable: true, present: false },
          { key: "sportsbookValue", label: "EV", score: 7, applicable: true, present: true },
        ],
      },
    },
  };
  assert.equal(boardLegPoolRole(bad as never, bad.finalAiScore as never), null);
  assert.equal(qualifiesAltPick(bad as never, bad.finalAiScore as never), false);
  assert.equal(propSimEdgeStagingQualifies(bad as never, bad.finalAiScore as never), false);
  assert.equal(scoredLegFromQualifiedCandidate(bad as never), null);
  assert.equal(
    fillReservedPropSlots([], [{ pick: bad as never, simHit: 0.6, rankScore: 99 }], 8).length,
    0,
  );
  const rejected = withCoachQualification(bad as never, {
    requestStyle: "props_only",
    isProp: true,
  });
  assert.equal(filterTicketPicksPreservingTicket([rejected as never]).length, 0);

  const good = withExactMarket10kProvenance({
    ...base,
    propProbabilityProvenance: null as import("./coachPropProbabilityProvenance.ts").PropProbabilityProvenance | null,
    simHit: 0.58,
    finalAiScore: {
      grade: "B+",
      confidencePct: 60,
      edgePct: 5,
      simHit: 0.58,
      simAligned: true,
      recommends: true,
      composite: 7.2,
      highRiskValuePlay: false,
      factors: [],
    },
  });
  const tagged = withCoachQualification(good, {
    requestStyle: "props_only",
    isProp: true,
  });
  assert.equal(tagged.qualificationStatus, "qualified");
  assert.ok(boardLegPoolRole(tagged as never, tagged.finalAiScore as never) != null);
  assert.ok(
    !SIM_FACTOR_LABEL_EXACT_10K ||
      propProvenanceAllowsSeating(tagged.propProbabilityProvenance, base),
  );
});

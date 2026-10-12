/**
 * Shared Coach quality invariants A–G — every sport/path must satisfy these.
 * Pure control-flow tests; no I/O / MC.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  COACH_PIPELINE_VERSION,
  coachCandidateIsQualified,
  qualifyCoachCandidate,
  withCoachQualification,
} from "./qualifyCoachCandidate.ts";
import {
  filterTicketPicksPreservingTicket,
  propSimEdgeStagingQualifies,
  propsOnlyTicketCleared,
} from "../pickRecommendation.ts";
import { boardLegPoolRole } from "../ticketStaging.ts";
import { fillReservedPropSlots } from "../boardScanPropDelivery.ts";
import { stageFootballPropsOnlyLegs } from "../coachFootballPropsOnly.ts";
import type { BoardScoredLeg } from "../ticketStaging.ts";
import { SLIP_UI_ENABLED } from "../slipUi.ts";

const SPORTS = [
  "nfl",
  "ncaaf",
  "nba",
  "wnba",
  "ncaab",
  "mlb",
  "nhl",
  "soccer",
] as const;

function makeProp(opts: {
  sport: string;
  grade: string;
  confidencePct: number;
  simHit: number;
  odds: number;
  edgePct?: number;
  propsOnlyTicket?: boolean;
  qualificationStatus?: "qualified" | "rejected";
  market?: string;
}) {
  const edgePct =
    opts.edgePct ??
    Math.round((opts.simHit - 1 / (1 + Math.abs(opts.odds) / 100)) * 1000) / 10;
  return {
    isProp: true as const,
    sport: opts.sport,
    market: opts.market ?? "Home Runs",
    propMarketKey: opts.market ?? "batter_home_runs",
    propSide: "Over" as const,
    propLine: 1.5,
    odds: opts.odds,
    player: "Test Player",
    game: "AWAY @ HOME",
    pick: "Over 1.5",
    propsOnlyTicket: opts.propsOnlyTicket,
    qualificationStatus: opts.qualificationStatus,
    finalAiScore: {
      grade: opts.grade,
      confidencePct: opts.confidencePct,
      simHit: opts.simHit,
      edgePct,
      simAligned: opts.simHit > 0.01,
      recommends: opts.grade === "A" || opts.grade === "B",
      composite: 50,
    },
  };
}

function scoredLegFromPick(pick: ReturnType<typeof makeProp>): BoardScoredLeg {
  return {
    pick: pick as never,
    evPct: 10,
    edgePct: pick.finalAiScore.edgePct,
    confidencePct: pick.finalAiScore.confidencePct,
    impliedProbPct: 1,
    lineShoppingScore: 5,
    grade: pick.finalAiScore.grade,
    simHit: pick.finalAiScore.simHit,
    composite: 50,
    rankScore: 50,
    hitReliability: 0.2,
  };
}

test("COACH_PIPELINE_VERSION is set for device diagnostics", () => {
  assert.equal(COACH_PIPELINE_VERSION, "unified-quality-v1");
});

for (const sport of SPORTS) {
  test(`Invariant A (${sport}): below grade floor never qualifies for normal ticket`, () => {
    for (const grade of ["F", "D", "C-", "C"] as const) {
      const pick = makeProp({
        sport,
        grade,
        confidencePct: 80,
        simHit: 0.08,
        odds: 80000,
        propsOnlyTicket: true,
      });
      assert.equal(
        coachCandidateIsQualified(pick, { requestStyle: "normal", isProp: true }),
        false,
        `${sport} ${grade}`,
      );
      assert.equal(propsOnlyTicketCleared(pick, pick.finalAiScore), false);
      assert.equal(boardLegPoolRole(pick as never, pick.finalAiScore), null);
    }
  });

  test(`Invariant B (${sport}): rawConfidence below min cannot be lifted to pass`, () => {
    // simHit far from 0.5 would lift effectivePropConfidence to ~68 historically.
    const pick = makeProp({
      sport,
      grade: "B",
      confidencePct: 20,
      simHit: 0.05,
      odds: 25000,
      edgePct: 4,
    });
    const r = qualifyCoachCandidate(pick, { requestStyle: "normal", isProp: true });
    assert.equal(r.status, "rejected");
    assert.equal(r.reason, "confidence_floor");
    assert.equal(propSimEdgeStagingQualifies(pick, pick.finalAiScore), false);
  });

  test(`Invariant D (${sport}): positive EV alone cannot qualify`, () => {
    const pick = makeProp({
      sport,
      grade: "F",
      confidencePct: 8,
      simHit: 0.03,
      odds: 40000,
      edgePct: 2.5,
      propsOnlyTicket: true,
    });
    assert.equal(
      qualifyCoachCandidate(pick, { requestStyle: "props_only", isProp: true }).status,
      "rejected",
    );
    const staged = stageFootballPropsOnlyLegs([scoredLegFromPick(pick)], 8);
    assert.equal(staged.length, 0, `${sport} staging must not seat EV-only F`);
  });

  test(`Invariant E (${sport}): rejected cannot be resurrected by top-up/fallback`, () => {
    const rejected = withCoachQualification(
      makeProp({
        sport,
        grade: "F",
        confidencePct: 10,
        simHit: 0.04,
        odds: 25000,
        qualificationStatus: "rejected",
      }),
      { isProp: true },
    );
    assert.equal(rejected.qualificationStatus, "rejected");
    assert.equal(
      filterTicketPicksPreservingTicket([rejected as never]).length,
      0,
    );
    const filled = fillReservedPropSlots(
      [],
      [{ pick: rejected as never, simHit: 0.04, rankScore: 99 }],
      8,
    );
    assert.equal(filled.length, 0, `${sport} fillReservedPropSlots must skip rejected`);
  });
}

test("Invariant C: missing confidence fails closed (not treated as zero pass)", () => {
  const r = qualifyCoachCandidate(
    {
      isProp: true,
      market: "Home Runs",
      odds: 200,
      finalAiScore: {
        grade: "B",
        confidencePct: null,
        simHit: 0.55,
        edgePct: 3,
      },
    },
    { isProp: true },
  );
  assert.equal(r.status, "rejected");
  assert.equal(r.reason, "confidence_floor");
});

test("Invariant F: normal N-leg either N qualified or honest shortfall (staging)", () => {
  const weak = SPORTS.flatMap((sport, i) =>
    [0, 1].map((j) =>
      scoredLegFromPick(
        makeProp({
          sport,
          grade: "F",
          confidencePct: 5 + j,
          simHit: 0.02 + j * 0.01,
          odds: 25000 + i * 1000,
          propsOnlyTicket: true,
        }),
      ),
    ),
  );
  const staged = stageFootballPropsOnlyLegs(weak, 8);
  // Must not invent 8 weak legs — shortfall (0 here) is honest.
  assert.ok(staged.length < 8);
  assert.equal(staged.length, 0);
});

test("Invariant G: finished N-leg path does not paint Add to slip (global + structural)", () => {
  assert.equal(SLIP_UI_ENABLED, false);
  // Structural: nleg_ticket → allowSlipActions false is enforced in coach.tsx
  // + PickCard; slip CTA requires both SLIP_UI_ENABLED and allowSlipActions.
});

test("qualified B+/52+ clears shared authority", () => {
  const pick = makeProp({
    sport: "mlb",
    grade: "B+",
    confidencePct: 58,
    simHit: 0.56,
    odds: -110,
    edgePct: 4,
  });
  assert.equal(
    qualifyCoachCandidate(pick, { requestStyle: "normal", isProp: true }).status,
    "qualified",
  );
});

test("longshot requestStyle reaches shared qualifier without weakening floor", () => {
  const weak = makeProp({
    sport: "mlb",
    grade: "F",
    confidencePct: 90,
    simHit: 0.05,
    odds: 80000,
    edgePct: 4,
  });
  assert.equal(
    qualifyCoachCandidate(weak, { requestStyle: "longshot", isProp: true }).status,
    "rejected",
  );
  const tagged = withCoachQualification(weak, { requestStyle: "longshot", isProp: true });
  assert.equal(tagged.coachRequestStyle, "longshot");
  assert.equal(tagged.qualificationStatus, "rejected");
  assert.equal(boardLegPoolRole(tagged as never, tagged.finalAiScore, { requestStyle: "longshot" }), null);
});

test("withCoachQualification never preserves a forged qualified stamp", () => {
  const forged = makeProp({
    sport: "mlb",
    grade: "F",
    confidencePct: 10,
    simHit: 0.04,
    odds: 25000,
    edgePct: 3,
    qualificationStatus: "qualified",
  });
  const tagged = withCoachQualification(forged, { requestStyle: "props_only", isProp: true });
  assert.equal(tagged.qualificationStatus, "rejected");
});

test("tiered backfill cannot seat shared confidence_floor rejects", async () => {
  const { tieredBackfillStagedTicket } = await import("../coachTicketCombinations.ts");
  const { buildStagedTicketFromScan } = await import("../ticketStaging.ts");
  const gl = {
    isProp: false as const,
    sport: "nba",
    market: "Moneyline",
    odds: 120,
    game: "A @ B",
    pick: "A ML",
    finalAiScore: {
      grade: "A",
      confidencePct: 40,
      edgePct: 8,
      simHit: 0.6,
      simAligned: true,
      recommends: true,
      composite: 8,
    },
  };
  const scored = [
    {
      pick: gl as never,
      evPct: 20,
      edgePct: 8,
      confidencePct: 40,
      impliedProbPct: 40,
      lineShoppingScore: 5,
      grade: "A",
      simHit: 0.6,
      composite: 8,
      rankScore: 99,
      hitReliability: 1,
    },
  ];
  const staged = buildStagedTicketFromScan(scored as never, 8, "inv-backfill", {
    ticketStyle: "balanced",
  });
  assert.equal(staged.picks.length, 0);
  const backfilled = tieredBackfillStagedTicket([], 8, scored as never, "balanced", "inv-bf");
  // Raw scored without attach still blocked by legQualifiesAtMinGrade → shared qualify.
  assert.equal(backfilled.length, 0);
});

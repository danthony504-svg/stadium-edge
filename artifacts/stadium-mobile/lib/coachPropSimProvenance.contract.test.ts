/**
 * Issue B — props sim provenance characterization + proposed contract todos.
 *
 * Active tests lock CURRENT behavior (history-model seating + misleading 10k label).
 * test.todo entries are the approved-contract regressions — enable after review
 * of docs/coach/props-sim-provenance-contract.md (no eligibility-policy change yet).
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { gradeFootballPropFromHistory } from "./coachFootballPropsOnlyGrade.ts";
import { evaluateCoachQualification } from "./coach/qualifyCoachCandidate.ts";
import { buildFinalAiScore } from "./finalAiScore.ts";
import { simEdgeFromHit, COACH_SIM_MIN_CONFIDENCE, COACH_SIM_MIN_GRADE } from "./gameSimQualityGates.ts";
import { scoreLineValue, scoreSimulation, scoreLineShopping } from "./pickScore.ts";

const ROOT = dirname(fileURLToPath(import.meta.url));

function sedrickHistory() {
  // Minimal 6-game log matching audit-hist-ncaaf-5030333 binary TD pattern (5/6).
  const games = [
    { rushingTouchdowns: "0", receivingTouchdowns: "0", passingTouchdowns: "0" },
    { rushingTouchdowns: "1", receivingTouchdowns: "0", passingTouchdowns: "0" },
    { rushingTouchdowns: "1", receivingTouchdowns: "0", passingTouchdowns: "0" },
    { rushingTouchdowns: "0", receivingTouchdowns: "1", passingTouchdowns: "0" },
    { rushingTouchdowns: "1", receivingTouchdowns: "0", passingTouchdowns: "0" },
    { rushingTouchdowns: "1", receivingTouchdowns: "0", passingTouchdowns: "0" },
  ];
  return {
    sport: "ncaaf",
    athleteId: "5030333",
    labels: ["CAR", "YDS", "TD", "REC", "YDS", "TD"],
    recent: games.map((stats, i) => ({
      eventId: `e${i}`,
      date: `2026-09-${String(5 + i).padStart(2, "0")}T12:00:00.000Z`,
      stats,
    })),
  };
}

const sedrickPick = {
  player: "Sedrick Alexander",
  propMarketKey: "player_anytime_td",
  market: "Anytime TD",
  propSide: "Over" as const,
  propLine: 0.5,
  odds: -120,
  sport: "ncaaf",
  isProp: true,
  athleteId: "5030333",
  game: "Arkansas @ Vanderbilt",
  pick: "Sedrick Alexander Over 0.5 Anytime TD",
};

test("floors unchanged (#711)", () => {
  assert.equal(COACH_SIM_MIN_CONFIDENCE, 52);
  assert.equal(COACH_SIM_MIN_GRADE, "C+");
});

test("CURRENT: history-model ATD hit is intentionally #711-eligible (no deep required)", () => {
  const graded = gradeFootballPropFromHistory(sedrickPick as never, sedrickHistory() as never);
  assert.equal(graded.nullReason, null);
  assert.ok(graded.hitProbability != null && graded.hitProbability > 0.5);
  assert.ok((graded.hitReliability ?? 0) >= 0.5);

  const hit = graded.hitProbability!;
  const edgePct = simEdgeFromHit(hit, -120)!;
  const score = buildFinalAiScore({
    pick: sedrickPick as never,
    rubricScores: {
      matchup: null,
      trend: null,
      lineValue: scoreLineValue(edgePct),
      injury: null,
      lineShopping: scoreLineShopping(8.1),
      simulation: scoreSimulation(hit),
    } as never,
    edgePct,
    odds: -120,
    propSimHit: hit,
    propHolisticContext: {
      sport: "ncaaf",
      marketKey: "player_anytime_td",
      propSide: "Over",
      minutesTrend: null,
      vsOpponentGames: 0,
      rushDefense: null,
      footballOppDefense: null,
      footballOwnPack: null,
      mlbPlatoon: null,
      mlbGameEnv: null,
    },
  });

  // Stamp at the confidence floor with positive edge (Sedrick-class).
  const q = evaluateCoachQualification(
    {
      market: "Anytime TD",
      sport: "ncaaf",
      isProp: true,
      odds: -120,
      propsOnlyTicket: true,
      grade: "B",
      confidencePct: 52,
      edgePct: 0.6,
      simHit: 0.5515,
    },
    { requestStyle: "props_only", isProp: true },
  );
  assert.equal(q.status, "qualified");
  assert.equal(q.reason, "ok");

  // Holistic currently mislabels any simHit as 10k — characterization of the bug.
  const simFactor = score.propHolistic?.factors.find((f) => f.key === "simulation");
  assert.equal(simFactor?.label, "10k Simulation");
  assert.ok(edgePct > 0);
});

test("CURRENT: rejected stamps stay rejected; conf 51 fails floor", () => {
  const low = evaluateCoachQualification(
    {
      market: "Anytime TD",
      sport: "ncaaf",
      isProp: true,
      odds: -120,
      propsOnlyTicket: true,
      grade: "B",
      confidencePct: 51,
      edgePct: 0.6,
      simHit: 0.5515,
    },
    { requestStyle: "props_only", isProp: true },
  );
  assert.equal(low.status, "rejected");
  assert.equal(low.reason, "confidence_floor");

  const terminal = evaluateCoachQualification(
    {
      market: "Anytime TD",
      sport: "ncaaf",
      isProp: true,
      odds: -120,
      propsOnlyTicket: true,
      grade: "B",
      confidencePct: 80,
      edgePct: 5,
      simHit: 0.7,
      qualificationStatus: "rejected",
      qualificationReason: "sim_invalid",
    },
    { requestStyle: "props_only", isProp: true },
  );
  assert.equal(terminal.status, "rejected");
  assert.equal(terminal.reason, "sim_invalid");
});

test("CURRENT: props-only path never overwrites history grades with deep", () => {
  const src = readFileSync(join(ROOT, "coachFootballPropsOnlyTicket.ts"), "utf8");
  assert.match(src, /never overwrite local grades/i);
  assert.match(src, /gradeFootballPropsOnlyFromHistory/);
  assert.match(src, /stillNull/);
});

test("CURRENT: server propStatValue lacks ATD composite (deep stat_mapping_failed root)", () => {
  const server = readFileSync(
    join(ROOT, "../../api-server/src/lib/propStatValue.ts"),
    "utf8",
  );
  assert.doesNotMatch(
    server,
    /market === \"player_anytime_td\"/,
    "server mapping gap: no player_anytime_td composite",
  );
  const mobile = readFileSync(join(ROOT, "propStats.ts"), "utf8");
  assert.match(mobile, /player_anytime_td/);
});

// --- Proposed contract regressions (enable after Option A/B/C review) ---

test.todo(
  "PROPOSED: successful exact-market 10k stamps source deep_mc_10k and label 10k Simulation",
);
test.todo(
  "PROPOSED: failed 10k with valid history stamps source history_model (not deep_mc_10k)",
);
test.todo(
  "PROPOSED: failed 10k with no authoritative fallback stays ungraded / rejected",
);
test.todo(
  "PROPOSED: missing stat mapping preserves nullReason stat_mapping_failed on provenance",
);
test.todo(
  "PROPOSED: history_model uses Historical model label — never 10k Simulation",
);
test.todo(
  "PROPOSED: rejected candidates cannot be promoted to qualified by fallback",
);

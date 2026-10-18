/**
 * Props sim provenance contract — Option C + Stage 3 TD mapping locks.
 *
 * #711 floors (52 / C+) and empty historical allowlist are preserved.
 * Anytime TD seats only via authenticated exact_market_10k after mapping repair.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { gradeFootballPropFromHistory } from "./coachFootballPropsOnlyGrade.ts";
import { evaluateCoachQualification } from "./coach/qualifyCoachCandidate.ts";
import {
  COACH_SIM_MIN_CONFIDENCE,
  COACH_SIM_MIN_GRADE,
} from "./gameSimQualityGates.ts";
import {
  VALIDATED_HISTORICAL_MODEL_ALLOWLIST,
  exactMarket10kProvenance,
  propProvenanceAllowsSeating,
} from "./coachPropProbabilityProvenance.ts";

const ROOT = dirname(fileURLToPath(import.meta.url));

function sedrickHistory() {
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
  eventId: "evt-sedrick",
  game: "Arkansas @ Vanderbilt",
  pick: "Sedrick Alexander Over 0.5 Anytime TD",
};

test("floors unchanged (#711)", () => {
  assert.equal(COACH_SIM_MIN_CONFIDENCE, 52);
  assert.equal(COACH_SIM_MIN_GRADE, "C+");
});

test("Option C: historical ATD alone cannot seat (empty allowlist)", () => {
  assert.equal(VALIDATED_HISTORICAL_MODEL_ALLOWLIST.length, 0);
  const graded = gradeFootballPropFromHistory(sedrickPick as never, sedrickHistory() as never);
  assert.equal(graded.nullReason, "unapproved_historical_model");
  assert.equal(graded.hitProbability, null);
  assert.equal(propProvenanceAllowsSeating(graded.probabilityProvenance ?? null), false);

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
      athleteId: "5030333",
      eventId: "evt-sedrick",
      propMarketKey: "player_anytime_td",
      propSide: "Over",
      propLine: 0.5,
    },
    { requestStyle: "props_only", isProp: true },
  );
  assert.equal(q.status, "rejected");
  assert.equal(q.reason, "insufficient_sim_provenance");
});

test("Option C: authenticated exact_market_10k ATD can pass provenance + floors", () => {
  const prov = exactMarket10kProvenance({
    hitProbability: 0.58,
    simulations: 10_000,
    sport: "ncaaf",
    marketKey: "player_anytime_td",
    athleteId: "5030333",
    eventId: "evt-sedrick",
    side: "Over",
    line: 0.5,
  });
  assert.equal(prov.source, "exact_market_10k");
  assert.equal(
    propProvenanceAllowsSeating(prov, {
      athleteId: "5030333",
      eventId: "evt-sedrick",
      propMarketKey: "player_anytime_td",
      propSide: "Over",
      propLine: 0.5,
    }),
    true,
  );

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
      simHit: 0.58,
      athleteId: "5030333",
      eventId: "evt-sedrick",
      propMarketKey: "player_anytime_td",
      propSide: "Over",
      propLine: 0.5,
      propProbabilityProvenance: prov,
    },
    { requestStyle: "props_only", isProp: true },
  );
  assert.equal(q.status, "qualified");
  assert.equal(q.reason, "ok");
});

test("rejected stamps stay rejected; conf 51 fails floor when provenance present", () => {
  const prov = exactMarket10kProvenance({
    hitProbability: 0.58,
    simulations: 10_000,
    sport: "ncaaf",
    marketKey: "player_anytime_td",
    athleteId: "5030333",
    eventId: "evt-sedrick",
    side: "Over",
    line: 0.5,
  });
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
      simHit: 0.58,
      athleteId: "5030333",
      eventId: "evt-sedrick",
      propMarketKey: "player_anytime_td",
      propSide: "Over",
      propLine: 0.5,
      propProbabilityProvenance: prov,
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

test("props-only path requests deep when history provenance cannot seat", () => {
  const src = readFileSync(join(ROOT, "coachFootballPropsOnlyTicket.ts"), "utf8");
  assert.match(src, /History-only/);
  assert.match(src, /gradeFootballPropsOnlyFromHistory/);
  assert.match(src, /needsDeep/);
  assert.match(src, /exact-market deep sim/);
});

test("Stage 3: server + mobile Anytime TD scorer composites (no pass TD / First TD unmapped)", () => {
  const server = readFileSync(
    join(ROOT, "../../api-server/src/lib/propStatValue.ts"),
    "utf8",
  );
  assert.match(server, /market === \"player_anytime_td\"/);
  assert.match(server, /scoringTouchdownsForGame/);
  assert.match(server, /isFirstTdMarket/);
  const build = readFileSync(
    join(ROOT, "../../api-server/src/lib/monteCarloBuild.ts"),
    "utf8",
  );
  assert.match(build, /missing_scoring_order/);
  const mobile = readFileSync(join(ROOT, "propStats.ts"), "utf8");
  assert.match(mobile, /player_anytime_td/);
  assert.match(mobile, /Passing TDs thrown are NOT/);
  assert.match(mobile, /market === \"player_first_td\"/);
});

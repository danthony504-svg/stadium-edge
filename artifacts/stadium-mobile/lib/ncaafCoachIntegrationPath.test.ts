import assert from "node:assert/strict";
import { test } from "node:test";

import {
  NCAAF_COACH_INTEGRATION_STAGES,
  ncaafAnyMarketProductOpen,
  ncaafCoachIntegrationStatus,
  nonNcaafSportsPreservedGuard,
} from "./ncaafCoachIntegrationPath.ts";
import { NCAAF_GAME_LINE_SIM_VALIDATED } from "./coachP0UnvalidatedTotals.ts";

test("Coach integration stages cover full delivery path", () => {
  assert.deepEqual([...NCAAF_COACH_INTEGRATION_STAGES], [
    "real_odds",
    "matchup_context",
    "simulation",
    "qualification",
    "correlation",
    "alt_refill",
    "rendered_ticket",
  ]);
});

test("ML candidate wired but product closed; other markets not ready", () => {
  const s = ncaafCoachIntegrationStatus();
  assert.equal(s.moneyline.candidateReadyForCoachWiring, true);
  assert.equal(s.moneyline.productValidated, false);
  assert.match(String(s.moneyline.blockedReason), /E4/);
  assert.equal(s.spreads.candidateReadyForCoachWiring, false);
  assert.equal(s.totals.candidateReadyForCoachWiring, false);
  assert.equal(s.alts.candidateReadyForCoachWiring, false);
  assert.equal(s.moneyline.honestShortfallRequired, true);
  assert.equal(s.moneyline.traceableGradesRequired, true);
});

test("no NCAAF market product-open; legacy master false", () => {
  assert.equal(NCAAF_GAME_LINE_SIM_VALIDATED, false);
  assert.equal(ncaafAnyMarketProductOpen(), false);
  assert.equal(nonNcaafSportsPreservedGuard().ok, true);
});

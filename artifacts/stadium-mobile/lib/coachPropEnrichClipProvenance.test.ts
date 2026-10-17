/**
 * Bugbot High regressions — enrich wipe + clipped-hit integrity.
 */
import assert from "node:assert/strict";
import test from "node:test";

import type { ParsedPick } from "../components/PickCard.tsx";
import type { PropPoolEntry } from "./api.ts";
import {
  alignProvenanceToHit,
  clearTrustedExactEvidenceForTests,
  exactMarket10kProvenance,
  propProvenanceAllowsSeating,
  resetExactMarketCoverageImpactForTests,
  seatingHitFromProvenance,
} from "./coachPropProbabilityProvenance.ts";
import {
  normalizePropsOnlyPick,
  propsOnlyPoolRowForPick,
  propsOnlySimLookupKey,
  softClipPropsOnlyHits,
} from "./coachFootballPropsOnlyGrade.ts";
import { enrichCoachPropSimHits } from "./coachPropSimFallback.ts";
import { COACH_SIM_MIN_CONFIDENCE, COACH_SIM_MIN_GRADE } from "./gameSimQualityGates.ts";
import { propSimLookupKey } from "./propSelection.ts";

test.beforeEach(() => {
  clearTrustedExactEvidenceForTests();
  resetExactMarketCoverageImpactForTests();
});

test("floors unchanged", () => {
  assert.equal(COACH_SIM_MIN_CONFIDENCE, 52);
  assert.equal(COACH_SIM_MIN_GRADE, "C+");
});

function poolFor(pick: ParsedPick): PropPoolEntry[] {
  return [
    {
      player: pick.player!,
      side: pick.propSide === "Under" ? "Under" : "Over",
      line: pick.propLine ?? 0.5,
      game: pick.game,
      marketKey: pick.propMarketKey ?? pick.market,
      sport: pick.sport,
      athleteId: pick.athleteId,
      eventId: pick.eventId,
      odds: pick.odds ?? 100,
    } as PropPoolEntry,
  ];
}

test("enrich: trusted exact 10k on rare multi-count survives history overwrite", async () => {
  const pick = {
    player: "Aaron Judge",
    sport: "mlb",
    game: "NYY @ BOS",
    market: "Home Runs",
    propMarketKey: "batter_home_runs",
    propSide: "Over",
    propLine: 1.5,
    odds: 220,
    isProp: true,
    athleteId: "33192",
    eventId: "evt-nyy-bos",
    pick: "Aaron Judge Over 1.5 Home Runs",
  } as ParsedPick;
  const pool = poolFor(pick);
  const resolvedKey = propSimLookupKey(pick, pool[0]!);
  assert.ok(resolvedKey);

  const trusted = exactMarket10kProvenance({
    hitProbability: 0.18,
    simulations: 10_000,
    sport: "mlb",
    marketKey: "batter_home_runs",
    athleteId: "33192",
    eventId: "evt-nyy-bos",
    side: "Over",
    line: 1.5,
  });
  const hits = new Map([
    [
      resolvedKey!,
      {
        hitProbability: 0.18,
        simulations: 10_000,
        probabilityProvenance: trusted,
      },
    ],
  ]);

  // Shared history satisfies holistic enrich without HTTP (no new network).
  const shared = {
    "33192": {
      sport: "mlb",
      athleteId: "33192",
      labels: [] as string[],
      recent: [{ stats: { homeRuns: "0" } }],
    },
  };
  const enriched = await enrichCoachPropSimHits(
    [pick],
    pool,
    hits,
    undefined,
    shared,
  );
  const row = enriched.hits.get(resolvedKey!);
  assert.ok(row);
  assert.equal(row!.probabilityProvenance?.source, "exact_market_10k");
  assert.equal(row!.hitProbability, 0.18);
  assert.equal(
    propProvenanceAllowsSeating(row!.probabilityProvenance, {
      athleteId: "33192",
      eventId: "evt-nyy-bos",
      propMarketKey: "batter_home_runs",
      propSide: "Over",
      propLine: 1.5,
    }),
    true,
  );
  assert.equal(enriched.historyFetched, 0);
});

test("enrich: clipped anytime TD remints evidence (no in-place mutate)", async () => {
  const pick = {
    player: "Travis Kelce",
    sport: "nfl",
    game: "KC @ BUF",
    market: "Anytime TD",
    propMarketKey: "player_anytime_td",
    propSide: "Over",
    propLine: 0.5,
    odds: 150,
    isProp: true,
    athleteId: "15847",
    eventId: "evt-kc-buf",
    pick: "Travis Kelce Anytime TD",
  } as ParsedPick;
  const pool = poolFor(pick);
  const resolvedKey = propSimLookupKey(pick, pool[0]!);
  assert.ok(resolvedKey);

  const trusted = exactMarket10kProvenance({
    hitProbability: 1,
    simulations: 10_000,
    sport: "nfl",
    marketKey: "player_anytime_td",
    athleteId: "15847",
    eventId: "evt-kc-buf",
    side: "Over",
    line: 0.5,
  });
  const oldEvidenceId = trusted.evidenceId;
  const hits = new Map([
    [
      resolvedKey!,
      {
        hitProbability: 1,
        simulations: 10_000,
        probabilityProvenance: trusted,
      },
    ],
  ]);

  const shared = {
    "15847": {
      sport: "nfl",
      athleteId: "15847",
      labels: [] as string[],
      recent: [{ stats: { receivingTouchdowns: "1" } }],
    },
  };
  const enriched = await enrichCoachPropSimHits(
    [pick],
    pool,
    hits,
    undefined,
    shared,
  );
  const row = enriched.hits.get(resolvedKey!);
  assert.ok(row);
  assert.equal(row!.hitProbability, 0.95);
  assert.equal(row!.probabilityProvenance?.hitProbability, 0.95);
  assert.notEqual(row!.probabilityProvenance?.evidenceId, oldEvidenceId);
  assert.equal(
    propProvenanceAllowsSeating(row!.probabilityProvenance, {
      athleteId: "15847",
      eventId: "evt-kc-buf",
      propMarketKey: "player_anytime_td",
      propSide: "Over",
      propLine: 0.5,
    }),
    true,
  );
  // Old stamp with mutated hit (no remint) fails integrity.
  assert.equal(
    propProvenanceAllowsSeating(
      { ...trusted, hitProbability: 0.95 },
      {
        athleteId: "15847",
        eventId: "evt-kc-buf",
        propMarketKey: "player_anytime_td",
        propSide: "Over",
        propLine: 0.5,
      },
    ),
    false,
  );
});

test("alignProvenanceToHit: remints trusted exact; rejects forged adjustment", () => {
  const trusted = exactMarket10kProvenance({
    hitProbability: 1,
    simulations: 10_000,
    sport: "nfl",
    marketKey: "player_anytime_td",
    athleteId: "2976212",
    eventId: "evt-hou-ind",
    side: "Over",
    line: 0.5,
  });
  const oldId = trusted.evidenceId;
  const aligned = alignProvenanceToHit(trusted, 0.95);
  assert.equal(aligned.source, "exact_market_10k");
  assert.equal(aligned.hitProbability, 0.95);
  assert.notEqual(aligned.evidenceId, oldId);
  assert.equal(seatingHitFromProvenance(aligned), 0.95);

  const forgedAligned = alignProvenanceToHit(
    {
      source: "exact_market_10k",
      hitProbability: 1,
      simulations: 10_000,
      nullReason: null,
      hitReliability: null,
      sport: "nfl",
      marketKey: "player_anytime_td",
      athleteId: "2976212",
      eventId: "evt-hou-ind",
      side: "Over",
      line: 0.5,
      evidenceId: "tev_forged",
    },
    0.95,
  );
  assert.equal(forgedAligned.source, "insufficient_evidence");
  assert.equal(propProvenanceAllowsSeating(forgedAligned), false);
});

test("softClipPropsOnlyHits remints exact 10k clipped hits", () => {
  const pick = {
    player: "Stefon Diggs",
    sport: "nfl",
    game: "HOU @ IND",
    market: "Anytime TD",
    propMarketKey: "player_anytime_td",
    propSide: "Over",
    propLine: 0.5,
    odds: 140,
    isProp: true,
    athleteId: "2976212",
    eventId: "evt-hou-ind",
  } as ParsedPick;
  const pool = poolFor(pick);
  const norm = normalizePropsOnlyPick(pick);
  const row = propsOnlyPoolRowForPick(norm, pool);
  const key = propsOnlySimLookupKey(norm, row);
  assert.ok(key);

  const trusted = exactMarket10kProvenance({
    hitProbability: 1,
    simulations: 10_000,
    sport: "nfl",
    marketKey: "player_anytime_td",
    athleteId: "2976212",
    eventId: "evt-hou-ind",
    side: "Over",
    line: 0.5,
  });
  const oldId = trusted.evidenceId;
  const hits = new Map([
    [
      key!,
      {
        hitProbability: 1 as number | null,
        simulations: 10_000,
        probabilityProvenance: trusted,
      },
    ],
  ]);

  softClipPropsOnlyHits([pick], hits, pool);
  const after = hits.get(key!);
  assert.ok(after);
  assert.equal(after!.hitProbability, 0.95);
  assert.equal(after!.probabilityProvenance?.hitProbability, 0.95);
  assert.notEqual(after!.probabilityProvenance?.evidenceId, oldId);
  assert.equal(
    propProvenanceAllowsSeating(after!.probabilityProvenance, {
      athleteId: "2976212",
      eventId: "evt-hou-ind",
      propMarketKey: "player_anytime_td",
      propSide: "Over",
      propLine: 0.5,
    }),
    true,
  );
});

test("NFL vs NCAAF identity isolation still fail-closed after align", () => {
  const nfl = exactMarket10kProvenance({
    hitProbability: 0.55,
    simulations: 10_000,
    sport: "nfl",
    marketKey: "player_pass_yds",
    athleteId: "nfl-1",
    eventId: "evt-nfl",
    side: "Over",
    line: 249.5,
  });
  const aligned = alignProvenanceToHit(nfl, 0.55);
  assert.equal(
    propProvenanceAllowsSeating(aligned, {
      athleteId: "nfl-1",
      eventId: "evt-nfl",
      propMarketKey: "player_pass_yds",
      propSide: "Over",
      propLine: 249.5,
    }),
    true,
  );
  assert.equal(
    propProvenanceAllowsSeating(aligned, {
      athleteId: "ncaaf-9",
      eventId: "evt-ncaaf",
      propMarketKey: "player_pass_yds",
      propSide: "Over",
      propLine: 249.5,
    }),
    false,
  );
});

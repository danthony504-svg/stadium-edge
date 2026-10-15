import assert from "node:assert/strict";
import test from "node:test";
import type { ParsedPick } from "../components/PickCard.tsx";
import { parseCoachAskMarketConstraint } from "./coachAskMarketFilter.ts";
import {
  acceptReplacementIfStillQualified,
  deliveryCandidateStillQualified,
  enforceTicketCorrelationAtSelection,
  legIdentityKey,
  recoverQualifiedDeliveryPicks,
  revalidateDeliveryPicks,
} from "./coachDeliveryQualification.ts";
import { dedupeCoachGameLinePicks, finalizeCoachDeliveryPicks } from "./ticketDiversity.ts";
import { marketLadderScoreKey, marketLadderKey } from "./marketLadderKey.ts";
import { NCAAF_GAME_LINE_SIM_VALIDATED } from "./coachP0UnvalidatedTotals.ts";
import { joinCoachNoteParts } from "./sanitizeCoachUserNote.ts";
import {
  coachAskTeamScope,
  filterOddsGamesForAskTeam,
  filterPicksForAskTeam,
} from "./coachAskTeamScope.ts";

function scored(
  pick: string,
  opts: {
    market?: string;
    odds?: number;
    composite: number;
    edgePct: number;
    simHit: number | null;
    game?: string;
    sport?: string;
    recommends?: boolean;
  },
): ParsedPick {
  const game = opts.game ?? "Away Team @ Home Team";
  const simHit = opts.simHit;
  return {
    game,
    market: opts.market ?? "Spread",
    pick,
    odds: opts.odds ?? -110,
    isProp: false,
    sport: opts.sport ?? "nfl",
    finalAiScore:
      simHit == null
        ? {
            composite: opts.composite,
            grade: "B+",
            confidencePct: 60,
            edgePct: opts.edgePct,
            simHit: null,
            simAligned: false,
            highRiskValuePlay: false,
            recommends: false,
            factors: [],
            rubric: {
              scores: {},
              composite: opts.composite,
              grade: "B+",
              confidencePct: 60,
              edgePct: opts.edgePct,
            },
          }
        : {
            composite: opts.composite,
            grade: "B+",
            confidencePct: 60,
            edgePct: opts.edgePct,
            simHit,
            simAligned: simHit >= 0.52,
            highRiskValuePlay: false,
            recommends: opts.recommends ?? (simHit >= 0.52 && opts.edgePct > 0),
            factors: [],
            rubric: {
              scores: {},
              composite: opts.composite,
              grade: "B+",
              confidencePct: 60,
              edgePct: opts.edgePct,
            },
          },
  };
}

test("live path: missing Final AI simHit rejects — no sim-map-only delivery", () => {
  const missing = scored("Home Team -3", {
    composite: 8,
    edgePct: 3,
    simHit: null,
  });
  assert.equal(deliveryCandidateStillQualified(missing), false);

  const ok = scored("Home Team -3", {
    composite: 8,
    edgePct: 3,
    simHit: 0.56,
  });
  assert.equal(deliveryCandidateStillQualified(ok), true);
});

test("regression: qualified→unqualified replacement cannot reach the ticket", () => {
  const game = "Lions @ Chiefs";
  const qualified = scored("Lions +6.5", {
    game,
    composite: 7.0,
    edgePct: 2.0,
    simHit: 0.55,
  });
  // Higher composite but stripped simHit → would fail delivery qualification.
  const unqualifiedReplacement = scored("Lions +3.5", {
    game,
    market: "Alt Spread",
    composite: 9.0,
    edgePct: 4.0,
    simHit: null,
  });

  assert.equal(deliveryCandidateStillQualified(qualified), true);
  assert.equal(deliveryCandidateStillQualified(unqualifiedReplacement), false);

  const accepted = acceptReplacementIfStillQualified(qualified, unqualifiedReplacement);
  assert.ok(accepted);
  assert.equal(legIdentityKey(accepted!), legIdentityKey(qualified));

  const result = dedupeCoachGameLinePicks([qualified, unqualifiedReplacement]);
  assert.equal(result.picks.length, 1);
  assert.match(result.picks[0]!.pick, /\+6\.5/);
  assert.ok(result.mutations.some((m) => m.action === "keep" && /revalidation/i.test(m.reason)));
  assert.ok(result.picks.every(deliveryCandidateStillQualified));
});

test("finalizeCoachDeliveryPicks mutations: every survivor still qualified", () => {
  const game = "Away @ Home";
  const picks = [
    scored("Home -6.5", { game, composite: 6.2, edgePct: 0.5, simHit: 0.53 }),
    scored("Away +6.5", { game, composite: 8.0, edgePct: 3.5, simHit: 0.57 }),
    scored("Home ML", {
      game,
      market: "Moneyline",
      odds: -180,
      composite: 5.5,
      edgePct: 0.2,
      simHit: 0.6,
    }),
    // Unqualified noise — missing simHit
    scored("Away +3.5", {
      game,
      market: "Alt Spread",
      composite: 9.5,
      edgePct: 5,
      simHit: null,
    }),
  ];
  const traced = dedupeCoachGameLinePicks(picks);
  assert.ok(traced.mutations.length > 0);
  assert.ok(traced.mutations.some((m) => m.stage === "same_team_dedupe"));
  assert.ok(traced.mutations.some((m) => m.stage === "side_consistency"));
  for (const p of traced.picks) {
    assert.equal(deliveryCandidateStillQualified(p), true, legIdentityKey(p));
  }
  // Opposite team gone; unqualified alt never seated.
  assert.ok(traced.picks.every((p) => !/Home/.test(p.pick) || /Away/.test(traced.picks[0]!.pick)));
  assert.ok(!traced.picks.some((p) => /\+3\.5/.test(p.pick) && p.finalAiScore?.simHit == null));
});

test("distinct alt lines preserved in score keys; correlation collapses at selection", () => {
  const a = scored("Colts +4.5", {
    game: "Colts @ Texans",
    market: "Spread",
    composite: 7,
    edgePct: 2,
    simHit: 0.55,
  });
  const b = scored("Colts +3.5", {
    game: "Colts @ Texans",
    market: "Alt Spread",
    composite: 7.5,
    edgePct: 2.5,
    simHit: 0.54,
  });
  // Evaluation: distinct score keys.
  assert.notEqual(marketLadderScoreKey(a), marketLadderScoreKey(b));
  // Selection: same correlation ladder.
  assert.equal(marketLadderKey(a), marketLadderKey(b));
  const seated = enforceTicketCorrelationAtSelection([a, b]);
  assert.equal(seated.length, 1);
});

test("NCAAF P0 still blocks delivery qualification", () => {
  assert.equal(NCAAF_GAME_LINE_SIM_VALIDATED, false);
  const ncaaf = scored("Michigan +3.5", {
    game: "Michigan @ Ohio State",
    sport: "ncaaf",
    composite: 8,
    edgePct: 3,
    simHit: 0.58,
  });
  assert.equal(deliveryCandidateStillQualified(ncaaf), false);
  assert.deepEqual(finalizeCoachDeliveryPicks([ncaaf]), []);
});

test("revalidateDeliveryPicks strips unqualified survivors", () => {
  const ok = scored("Away +2.5", { composite: 7, edgePct: 2, simHit: 0.55 });
  const bad = scored("Home -2.5", { composite: 8, edgePct: 3, simHit: null });
  const r = revalidateDeliveryPicks([ok, bad]);
  assert.equal(r.picks.length, 1);
  assert.equal(r.dropped, 1);
  assert.match(r.picks[0]!.pick, /Away/);
});

test("exception recovery keeps only qualified full-game sides", () => {
  const ask = parseCoachAskMarketConstraint(
    "4 leg NFL spreads and moneylines for upcoming games.",
  );
  const sea = "Seattle Seahawks @ Denver Broncos";
  const kc = "Buffalo Bills @ Kansas City Chiefs";
  const seaSpread = scored("Seahawks +3.5", {
    game: sea,
    market: "Spread",
    composite: 8,
    edgePct: 2,
    simHit: 0.56,
  });
  const seaAlt = scored("Seahawks +7.5", {
    game: sea,
    market: "Alt Spread",
    composite: 6,
    edgePct: 1,
    simHit: 0.54,
  });
  const seaMl = scored("Seahawks ML", {
    game: sea,
    market: "Moneyline",
    odds: -150,
    composite: 7,
    edgePct: 1.5,
    simHit: 0.6,
  });
  const q3 = scored("Seahawks +1.5", {
    game: sea,
    market: "Q3 Spread",
    odds: -230,
    composite: 9,
    edgePct: 4,
    simHit: 0.969,
  });
  const prop = {
    ...scored("Jaxon Smith-Njigba Over 92.5", {
      game: sea,
      market: "Rec Yds",
      composite: 8,
      edgePct: 3,
      simHit: 0.58,
    }),
    isProp: true,
  };
  const missing = scored("Broncos -3.5", {
    game: sea,
    market: "Spread",
    composite: 9,
    edgePct: 4,
    simHit: null,
  });
  const ncaaf = scored("Michigan +3.5", {
    game: "Michigan @ Ohio State",
    sport: "ncaaf",
    composite: 8,
    edgePct: 3,
    simHit: 0.58,
  });
  const total = scored("Over 45.5", {
    game: sea,
    market: "Total",
    composite: 7,
    edgePct: 2,
    simHit: 0.55,
  });
  const kcSpread = scored("Chiefs -3", {
    game: kc,
    market: "Spread",
    composite: 7.2,
    edgePct: 1.8,
    simHit: 0.57,
  });
  const recovered = recoverQualifiedDeliveryPicks(
    [q3, prop, missing, ncaaf, total, seaSpread, seaAlt, seaMl, kcSpread],
    ask,
    { requestedLegs: 4, legsPerGameCap: 1 },
  );
  assert.deepEqual(
    recovered.map((p) => `${p.market}|${p.pick}`),
    ["Spread|Seahawks +3.5", "Spread|Chiefs -3"],
  );
  assert.ok(recovered.every(deliveryCandidateStillQualified));
  assert.ok(recovered.every((p) => p.market === "Spread"));
});

test("device: 8 leg broncos — null-note safe; Q3 cannot survive partial/recovery/final; matchup scope", () => {
  const askText = "8 leg broncos";
  const ask = parseCoachAskMarketConstraint(askText);
  // Bare team N-leg is a mix ask (not fullGameOnly); period still fail-closed.
  assert.equal(ask.propsOnly, false);

  // Documented meaning: Broncos = entire matchup (both sides), not Broncos-only legs.
  const scope = coachAskTeamScope(askText);
  assert.ok(scope);
  assert.equal(scope!.sport, "nfl");
  assert.ok(scope!.matchTokens.includes("broncos"));
  const sea = "Seattle Seahawks @ Denver Broncos";
  const other = "Buffalo Bills @ Kansas City Chiefs";
  assert.deepEqual(
    filterOddsGamesForAskTeam(
      [
        { sport: "nfl", awayTeam: "Seattle Seahawks", homeTeam: "Denver Broncos" },
        { sport: "nfl", awayTeam: "Buffalo Bills", homeTeam: "Kansas City Chiefs" },
      ],
      scope,
    ).map((g) => g.homeTeam),
    ["Denver Broncos"],
  );
  const scopedPicks = filterPicksForAskTeam(
    [
      { sport: "nfl", game: sea, market: "Spread", pick: "Seahawks +3.5" },
      { sport: "nfl", game: sea, market: "Q3 Spread", pick: "Seahawks +1.5" },
      { sport: "nfl", game: sea, market: "Moneyline", pick: "Broncos" },
      { sport: "nfl", game: other, market: "Spread", pick: "Chiefs -3" },
    ],
    scope,
  );
  assert.equal(scopedPicks.length, 3);
  assert.ok(scopedPicks.every((p) => /broncos|seahawks/i.test(String(p.game))));
  assert.ok(
    scopedPicks.some((p) => /seahawks/i.test(String(p.pick))),
    "matchup scope allows opponent (Seahawks) full-game sides",
  );

  const q3 = scored("Seahawks +1.5", {
    game: sea,
    market: "Q3 Spread",
    odds: -230,
    composite: 9,
    edgePct: 27.6,
    simHit: 0.77,
  });
  const fgSea = scored("Seahawks +3.5", {
    game: sea,
    market: "Spread",
    composite: 8,
    edgePct: 2,
    simHit: 0.56,
  });
  const fgBroncos = scored("Broncos -3.5", {
    game: sea,
    market: "Spread",
    composite: 7.5,
    edgePct: 1.8,
    simHit: 0.55,
  });
  const foreign = scored("Chiefs -3", {
    game: other,
    market: "Spread",
    composite: 7.2,
    edgePct: 1.8,
    simHit: 0.57,
  });

  // Qualification belt (partial revalidate + exception recovery + final).
  assert.equal(deliveryCandidateStillQualified(q3), false);
  assert.equal(revalidateDeliveryPicks([q3, fgSea]).picks.length, 1);
  const recovered = recoverQualifiedDeliveryPicks(
    filterPicksForAskTeam([q3, fgSea, fgBroncos, foreign], scope),
    ask,
    { requestedLegs: 8, legsPerGameCap: 8 },
  );
  assert.ok(recovered.every((p) => p.market !== "Q3 Spread"));
  assert.ok(recovered.every((p) => deliveryCandidateStillQualified(p)));
  assert.ok(recovered.every((p) => /broncos|seahawks/i.test(p.game)));
  assert.deepEqual(
    recovered.map((p) => `${p.market}|${p.pick}`).sort(),
    ["Spread|Broncos -3.5", "Spread|Seahawks +3.5"].sort(),
  );

  // Null-note must not throw (device: Cannot read property 'trim' of null).
  assert.equal(joinCoachNoteParts([null, undefined, ""]), "");
  assert.doesNotThrow(() => joinCoachNoteParts([null, "ok"]));
});

test("explicit Q3 ask still drops the quarter leg at delivery qualification", () => {
  const ask = parseCoachAskMarketConstraint("4 leg Q3 spreads and moneylines");
  assert.equal(ask.fullGameOnly, false);
  assert.equal(ask.gameLinesOnly, true);
  const sea = "Seattle Seahawks @ Denver Broncos";
  const q3Extreme = scored("Seahawks +1.5", {
    game: sea,
    market: "Q3 Spread",
    odds: -230,
    composite: 9,
    edgePct: 4,
    simHit: 0.969,
  });
  const q3Ordinary = scored("Broncos -1.5", {
    game: sea,
    market: "Q3 Spread",
    odds: -110,
    composite: 7,
    edgePct: 2,
    simHit: 0.62,
  });
  const fg = scored("Seahawks +3.5", {
    game: sea,
    market: "Spread",
    composite: 8,
    edgePct: 2,
    simHit: 0.56,
  });
  assert.equal(deliveryCandidateStillQualified(q3Extreme), false);
  assert.equal(deliveryCandidateStillQualified(q3Ordinary), false);
  const recovered = recoverQualifiedDeliveryPicks([q3Extreme, q3Ordinary, fg], ask, {
    requestedLegs: 4,
    legsPerGameCap: 1,
  });
  assert.deepEqual(
    recovered.map((p) => `${p.market}|${p.pick}`),
    ["Spread|Seahawks +3.5"],
  );
});

test("coverProbs-only sim map cannot seat — Final AI simHit still required", () => {
  // Even when server-shaped coverProbs exist on a sim entry, delivery
  // qualification ignores the map and requires pick.finalAiScore.simHit.
  const missingSimHit = scored("Home Team -3", {
    composite: 8,
    edgePct: 3,
    simHit: null,
  });
  assert.equal(deliveryCandidateStillQualified(missingSimHit), false);
  assert.deepEqual(finalizeCoachDeliveryPicks([missingSimHit]), []);
});

test("client simCoverRateMap accepts coverProbs alias (parity with server)", async () => {
  const { simCoverRateMap, gameSimHitForPick } = await import("./gameSimScoring.ts");
  const game = "Away Team @ Home Team";
  const pick = scored("Home Team -3", {
    game,
    composite: 8,
    edgePct: 3,
    simHit: 0.56,
  });
  const sim = {
    sport: "nfl",
    simulations: 10_000,
    homeWinProbability: 0.55,
    awayWinProbability: 0.45,
    tieProbability: 0,
    mostLikelyWinner: "home" as const,
    mostLikelyWinnerPct: 0.55,
    confidenceScore: 55,
    // Server-shaped only — no coverHitRates.
    coverProbs: {
      [`${game}|Spread|Home Team -3`.toLowerCase()]: 0.56,
    },
  };
  assert.ok(simCoverRateMap(sim));
  assert.equal(simCoverRateMap(sim)?.[`${game}|Spread|Home Team -3`.toLowerCase()], 0.56);
  // Lookup path accepts coverProbs; delivery still gated by Final AI above.
  const hit = gameSimHitForPick(pick, sim);
  assert.equal(hit, 0.56);
});

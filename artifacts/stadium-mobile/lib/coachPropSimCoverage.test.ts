import assert from "node:assert/strict";
import test from "node:test";
import { distinctPropSimSeeds, postedPropCoverageForBatch } from "./coachPropSimCoverage.ts";
import { buildFootballPropsOnlyTicket } from "./coachFootballPropsOnlyTicket.ts";
import { propsOnlySimLookupKey } from "./coachFootballPropsOnlyGrade.ts";
import { propProvenanceAllowsSeating } from "./coachPropProbabilityProvenance.ts";
import { selectFootballPropsOnlyFromPicks } from "./coachFootballPropsOnly.ts";

function pick(patch: Record<string, unknown> = {}) {
  return { isProp: true, sport: "nfl", eventId: "event", athleteId: "id", player: "Receiver",
    propMarketKey: "player_reception_yds", propLine: 20.5, propSide: "Over", odds: -110,
    game: "Washington Commanders @ San Francisco 49ers", market: "Rec Yds", pick: "Receiver Over 20.5", ...patch } as never;
}

test("one seed covers posted sides/alts while sport, event, athlete, stat and period stay separate", () => {
  const seed = pick();
  const alt = pick({ propLine: 40.5, propSide: "Under" });
  const foreign = [pick({ eventId: "other" }), pick({ athleteId: "other" }),
    pick({ sport: "ncaaf" }), pick({ propMarketKey: "player_rush_yds" }),
    pick({ propMarketKey: "player_reception_yds_h1" })];
  assert.equal(distinctPropSimSeeds([seed, alt, ...foreign]).length, 6);
  const covered = postedPropCoverageForBatch([seed, alt, ...foreign], [seed]);
  assert.ok(covered.has(propsOnlySimLookupKey(alt)!));
  // Same legacy response key across different event/athlete/sport is ambiguous.
  assert.equal(covered.has(propsOnlySimLookupKey(seed)!), false);
  assert.equal(postedPropCoverageForBatch([pick({ eventId: undefined })], [seed]).size, 0);
});

test("the unchanged seed cap covers more distinct players instead of repeated thresholds", () => {
  const rows = Array.from({ length: 20 }, (_, athlete) =>
    Array.from({ length: 12 }, (_, rung) => pick({ player: `P${athlete}`, athleteId: `id${athlete}`, propLine: rung + 0.5 }))
  ).flat();
  const seeds = selectFootballPropsOnlyFromPicks(rows, 5, rows);
  assert.equal(new Set(seeds.map(p => p.athleteId)).size, 20);
  assert.equal(seeds.length, 20);
});

test("shared-draw coverage qualifies every posted rung before ladder seating without extra requests", async () => {
  const oldFetch = globalThis.fetch;
  let calls = 0;
  const game = "Washington Commanders @ San Francisco 49ers";
  const pool = Array.from({ length: 12 }, (_, i) => [20.5, 80.5].flatMap(line =>
    (["Over", "Under"] as const).map(side => ({ sport: "nfl", eventId: "event", athleteId: `id${i}`,
      playerTeamId: "28", teamAbbr: "WSH", game, marketLabel: "Rec Yds", marketKey: "player_reception_yds",
      player: `Receiver ${i}`, line, side, odds: line === 80.5 ? 500 : -110, alt: line === 80.5 }))
  )).flat();
  const playerHistory = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`Receiver ${i}#id${i}`, {
    labels: ["receivingYards"], recent: Array.from({ length: 10 }, (_, j) => ({
      date: new Date(Date.now() - (j + 1) * 86400000).toISOString(), stats: { receivingYards: String(60 + j) },
    })),
  }]));
  globalThis.fetch = async (_input, init) => {
    calls++;
    const body = JSON.parse(String(init?.body));
    assert.ok(body.props.length <= 8);
    return new Response(JSON.stringify({ props: body.props.map((p: Record<string, unknown>) => ({
      player: p.player, market: p.market, key: `${p.player}|${p.market}|${p.line}|${p.side}`,
      line: p.line, side: p.side, simulations: 10000, sampleGames: 10, hitProbability: 0.9,
      lineHitRatesBySide: { Over: { "20.5": 0.9, "80.5": 0.65, "999.5": 0.99 }, Under: { "20.5": 0.1, "80.5": 0.35 } },
    })) }), { headers: { "content-type": "application/json" } });
  };
  try {
    const result = await buildFootballPropsOnlyTicket({ target: 5, pool, realOdds: [], teamIdMap: new Map(),
      playerHistory: playerHistory as never,
      espnGames: [{ sport: "nfl", homeTeam: "San Francisco 49ers", awayTeam: "Washington Commanders", homeTeamId: "25", awayTeamId: "28", homeAbbr: "SF", awayAbbr: "WSH" }] as never,
      oppRushDefense: { "nfl#25": { opponentMarkets: [{ market: "player_reception_yds", perGame: 220, sampleSize: 8, firstGame: new Date(Date.now() - 8 * 86400000).toISOString(), lastGame: new Date(Date.now() - 86400000).toISOString(), scope: "team_allowed", source: "test observed completed boxes" }] } } as never,
      allowedSports: ["nfl"], askText: "5 leg receiving yards", signal: AbortSignal.timeout(5000) });
    assert.equal(result.perf?.candidatesSelected, 12);
    assert.equal(result.propSimEvaluated, 48);
    assert.equal(calls, 2); // old 40-side sample required five 8-side batches
    assert.equal(result.picks.length, 5);
    const callsBeforeMissingEvidence = calls;
    const missingEvidence = await buildFootballPropsOnlyTicket({ target: 5, pool, realOdds: [], teamIdMap: new Map(),
      playerHistory: playerHistory as never, allowedSports: ["nfl"], askText: "5 leg receiving yards", signal: AbortSignal.timeout(5000) });
    assert.equal(missingEvidence.picks.length, 0, "shared draws must not bypass missing opponent evidence");
    assert.equal(calls, callsBeforeMissingEvidence, "missing evidence must skip history and simulation requests");
    assert.match(missingEvidence.note, /required opponent evidence is unavailable/);
    for (const p of result.picks) {
      assert.equal(p.propLine, 20.5); // higher-EV 80.5 fails genuine confidence
      assert.ok((p.finalAiScore?.confidencePct ?? 0) >= 52);
      assert.ok(propProvenanceAllowsSeating(p.finalAiScore?.propProbabilityProvenance, p));
    }
  } finally { globalThis.fetch = oldFetch; }
});

test("direct/recovery scorer builder rejects passing TD and No sides before any network work", async () => {
  const oldFetch=globalThis.fetch;
  globalThis.fetch=async () => { throw new Error("out-of-scope picks must never fetch"); };
  try {
    const base={sport:"nfl",eventId:"event",athleteId:"id",playerTeamId:"25",teamAbbr:"SF",game:"Washington Commanders @ San Francisco 49ers",player:"QB",line:0.5,odds:-110,alt:false};
    const pool=[{...base,marketLabel:"Pass TDs",marketKey:"player_pass_tds",side:"Over" as const},{...base,marketLabel:"Anytime TD",marketKey:"player_anytime_td",side:"Under" as const}];
    const result=await buildFootballPropsOnlyTicket({target:5,pool,realOdds:[],teamIdMap:new Map(),allowedSports:["nfl"],askText:"5 leg touchdown",recoveryFill:true,signal:AbortSignal.timeout(1000)});
    assert.equal(result.picks.length,0);
    assert.equal(result.perf?.candidatesSelected,0);
  } finally { globalThis.fetch=oldFetch; }
});

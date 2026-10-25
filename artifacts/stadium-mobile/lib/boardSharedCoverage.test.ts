import test from "node:test";
import assert from "node:assert/strict";
import { simPropBatch } from "./boardMarketScanner.ts";
import { propProvenanceAllowsSeating } from "./coachPropProbabilityProvenance.ts";
import type { ParsedPick } from "../components/PickCard.tsx";

test("general board binds both posted sides and alternate thresholds from one 10k draw", async () => {
  const original = globalThis.fetch;
  let simulations = 0;
  const game = "Washington Commanders @ San Francisco 49ers";
  const pool = [20.5, 30.5, 40.5].flatMap(line => (["Over", "Under"] as const).map(side => ({
    sport: "nfl", eventId: "event", athleteId: "id", player: "Receiver", playerTeamId: "28", teamAbbr: "WSH",
    marketKey: "player_reception_yds", marketLabel: "Rec Yds", game, line, side, odds: -110,
  })));
  const picks = pool.map(p => ({ isProp: true, sport: p.sport, eventId: p.eventId, athleteId: p.athleteId,
    player: p.player, game, propMarketKey: p.marketKey, market: p.marketLabel, propLine: p.line, propSide: p.side,
    pick: `Receiver ${p.side} ${p.line}`, odds: p.odds }) as ParsedPick);
  globalThis.fetch = async (input, init) => {
    if (!String(input).includes("simulate/props")) return Response.json({});
    simulations++;
    const body = JSON.parse(String(init?.body));
    assert.equal(body.props.length, 1);
    assert.deepEqual(body.props[0].additionalLines, [30.5, 40.5]);
    return Response.json({props: [{player: "Receiver", market: "player_reception_yds", line: 20.5, side: "Over",
      key: "Receiver|player_reception_yds|20.5|Over", simulations: 10000, hitProbability: 0.9,
      lineHitRatesBySide: {Over: {"20.5": .9, "30.5": .7, "40.5": .6, "999.5": .99}, Under: {"20.5": .1, "30.5": .3, "40.5": .4}}
    }], playerHistories: {id: {player: "Receiver", labels: ["receivingYards"], recent: Array.from({length: 6}, () => ({stats:{receivingYards:"35"}}))}}});
  };
  try {
    const result = await simPropBatch([picks[0]!], pool, new Map([[game, {sport:"nfl",homeTeam:"San Francisco 49ers",awayTeam:"Washington Commanders",homeTeamId:"25",awayTeamId:"28"}]]), undefined, {coverage:picks,enrichTimeoutMs:100});
    for (const p of picks) {
      const key = `Receiver|player_reception_yds|${p.propLine}|${p.propSide}`;
      const hit = result.hits.get(key) as any;
      assert.ok(hit, key);
      assert.ok(propProvenanceAllowsSeating(hit.probabilityProvenance, p), key);
    }
    assert.equal(result.hits.has("Receiver|player_reception_yds|999.5|Over"), false);
    assert.equal(simulations, 1);
  } finally {globalThis.fetch = original;}
});

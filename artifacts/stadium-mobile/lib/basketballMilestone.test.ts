import assert from "node:assert/strict";
import test from "node:test";
import { parseCoachAskMarketConstraint, propMarketKeyAllowed } from "./coachAskMarketFilter.ts";
import { resolveCoachFollowupAsk } from "./coachFollowupScope.ts";
import { gameValueForMarket } from "./propStats.ts";
import { isBinaryNullLineMarket } from "./binaryPropMarket.ts";
import { propMarketLabel } from "./propMarketLabel.ts";
import { buildSimulatorPropPool, normalizeSimulatorPropLines } from "./simulatorPickPool.ts";
import { fetchFullBoardPropPool } from "./api.ts";
import { resolveMarketFamilyId, isFamilySeatable, getSportSeatingAdapter } from "./sportSeatingAdapters.ts";

test("explicit milestone asks lock exact markets and keep the lock on new-ticket followups", () => {
  for (const [ask, keys] of [
    ["NBA double-doubles only", ["player_double_double"]],
    ["NBA triple doubles", ["player_triple_double"]],
    ["NBA double doubles and triple doubles", ["player_double_double","player_triple_double"]],
  ] as const) {
    const c = parseCoachAskMarketConstraint(ask);
    assert.equal(c.propsOnly,true);
    assert.deepEqual(c.allowedMarketKeys,keys);
    assert.equal(propMarketKeyAllowed("player_points_rebounds_assists",c.allowedMarketKeys),false);
    const next = parseCoachAskMarketConstraint(resolveCoachFollowupAsk("3 leg new no ATL",[ask]));
    assert.deepEqual(next.allowedMarketKeys,keys);
  }
  assert.deepEqual(parseCoachAskMarketConstraint(resolveCoachFollowupAsk("new NBA triple doubles",["NBA double doubles"])).allowedMarketKeys,["player_triple_double"]);
});

test("mobile milestone stats and seating retain the distinct binary market", () => {
  const stats = { PTS:"20", REB:"10", AST:"10", STL:"0", BLK:"0" };
  for (const market of ["player_double_double","player_triple_double"]) {
    assert.equal(gameValueForMarket(market,stats,new Set()),1);
    assert.equal(gameValueForMarket(market,stats,new Set(["REB"])),null);
    assert.equal(gameValueForMarket(market,{PTS:"20",REB:"10",AST:"10"},new Set()),null);
    assert.equal(isBinaryNullLineMarket(market),true);
    const family = resolveMarketFamilyId(getSportSeatingAdapter("nba"),market,{isProp:true});
    assert.equal(family,market.replace("player_",""));
    assert.equal(isFamilySeatable(getSportSeatingAdapter("nba"),family),true);
  }
  assert.equal(gameValueForMarket("player_triple_double",{...stats,AST:"9"},new Set()),0);
  assert.equal(propMarketLabel("player_triple_double"),"Triple-Double");
});

test("simulator exposes posted Yes/No at settlement 0.5 without changing ordinary missing lines", () => {
  const props = [
    {player:"Player",market:"player_triple_double",line:null,overPrice:900,underPrice:-1800},
    {player:"Other",market:"player_points",line:null,overPrice:-110},
  ];
  assert.equal(normalizeSimulatorPropLines(props as never)[0]!.line,0.5);
  assert.equal(normalizeSimulatorPropLines(props as never)[1]!.line,null);
  const pool = buildSimulatorPropPool(props as never,"Away @ Home","nba");
  assert.deepEqual(pool.map(p=>[p.marketLabel,p.side,p.line,p.odds]),[["Triple-Double","Over",0.5,900],["Triple-Double","Under",0.5,-1800]]);
  assert.equal(props[0]!.line,null,"provider payload is not mutated");
});

test("Coach loads both milestone markets through ONE existing event request and preserves No prices", async () => {
  const previous = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return new Response(JSON.stringify({props:[
      {player:"Player",market:"player_double_double",line:null,overPrice:150,underPrice:-180,athleteId:"p",playerTeamId:"28"},
      {player:"Player",market:"player_triple_double",line:null,overPrice:900,underPrice:-1800,athleteId:"p",playerTeamId:"28"},
    ]}),{headers:{"content-type":"application/json"}});
  };
  try {
    const game={id:"milestone-test",sport:"nba",homeTeam:"Home",awayTeam:"Away",homeTeamId:"25",awayTeamId:"28",homeAbbr:"H",awayAbbr:"A"};
    const pool = await fetchFullBoardPropPool([game] as never,[game] as never,[]);
    assert.equal(calls,1);
    assert.deepEqual(pool.map(p=>[p.marketKey,p.side,p.odds]),[["player_double_double","Over",150],["player_double_double","Under",-180],["player_triple_double","Over",900],["player_triple_double","Under",-1800]]);
  } finally {globalThis.fetch=previous;}
});

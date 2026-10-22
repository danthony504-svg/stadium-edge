import assert from "node:assert/strict";
import test from "node:test";
import { URL } from "node:url";
import { readFileSync } from "node:fs";
import type { PropSimulationResult } from "./api.ts";
import { simulatorModelEdge, formatPropProjectedStat, propSimulationCount, propSimulationEvidence, propSimulationSummaryLabel } from "./simulatorPropMetrics.ts";
import { gradeSimulatorProps } from "./simulatorPickPool.ts";
import { enrichPropSimResults, localPropSimulation, mergePropSimWithLocal } from "./simulatorLocalSim.ts";

const row = (overrides: Partial<PropSimulationResult> = {}): PropSimulationResult => ({
  key:"Player|player_double_double|0.5|Over",player:"Player",market:"player_double_double",line:0.5,side:"Over",
  simulations:10000,hitProbability:0.32,mostLikelyLine:0,medianProjection:0,meanProjection:0.32,
  confidenceScore:74,sampleGames:10,stdDev:0.46,percentiles:null,tier:"deep",...overrides,
});

test("screenshot edge uses model chance and selected price, including negative edges", () => {
  assert.equal(simulatorModelEdge(0.32,140),-9.7);
  assert.equal(simulatorModelEdge(0.60,-110),7.6);
  assert.equal(simulatorModelEdge(0,100),-50);
  for (const p of [null,NaN,Infinity,-0.1,1.1]) assert.equal(simulatorModelEdge(p,140),null);
  for (const price of [null,0,NaN,Infinity]) assert.equal(simulatorModelEdge(0.32,price),null);
});

test("grading never borrows a same-player market, line, side or athlete", () => {
  for (const sport of ["nba","wnba","ncaab","nfl","ncaaf","mlb","nhl","soccer"]) {
    const market=sport==="nba"||sport==="wnba"||sport==="ncaab" ? "player_double_double" : sport==="mlb" ? "batter_hits" : sport==="nhl" ? "player_shots_on_goal" : sport==="soccer" ? "player_shots" : "player_reception_yds";
    const selected={player:"Player",market,line:0.5,side:"Over" as const,odds:140,athleteId:"p"};
    const key=`Player|${market}|0.5|Over`;
    const exact={game:"Away @ Home",sport,player:"Player",marketKey:market,marketLabel:"Prop",line:0.5,side:"Over",athleteId:"p",odds:140,edge:99};
    const grade=(pool: unknown[])=>gradeSimulatorProps([selected],"Away @ Home",sport,pool as never,{propSimulations:new Map([[key,{hitProbability:0.32}]])});
    assert.equal(grade([{...exact,marketKey:"unrelated_market"},exact]).get(key)?.rubric.edgePct,-9.7);
    for (const wrong of [{marketKey:"unrelated_market"},{line:1.5},{side:"Under"},{athleteId:"wrong"},{sport:"other"}]) {
      assert.equal(grade([{...exact,...wrong}]).size,0);
    }
  }
});

test("binary outcomes display Yes/No; count stats retain their units", () => {
  for (const market of ["player_double_double","player_triple_double","player_anytime_td","player_goal_scorer_anytime"]) {
    assert.equal(formatPropProjectedStat(row({market,medianProjection:0})),"No");
    assert.equal(formatPropProjectedStat(row({market,medianProjection:1})),"Yes");
    assert.equal(formatPropProjectedStat(row({market,medianProjection:null,meanProjection:0.32})),"—");
  }
  assert.equal(formatPropProjectedStat(row({market:"player_points",medianProjection:20.5})),"20.5");
});

test("per-prop evidence distinguishes quick, deep, unavailable and empirical sources", () => {
  assert.equal(propSimulationEvidence(row()),"10,000 simulations · 10 history games");
  assert.equal(propSimulationEvidence(row({simulations:1000,tier:"quick"})),"1,000 simulations · 10 history games");
  assert.equal(propSimulationCount(row({hitProbability:null})),0);
  assert.equal(propSimulationEvidence(row({simulations:0})),"History estimate · 10 games · 0 simulations");
  assert.equal(propSimulationSummaryLabel([row()]),"10,000 sims/prop");
  assert.equal(propSimulationSummaryLabel([row(),row({simulations:0})]),"Mixed result sources");
  assert.equal(propSimulationSummaryLabel([row({hitProbability:null})]),"No prop MC draws");
});

test("shared empirical fallbacks cannot retain a failed server's 10k count or deep/cache status", () => {
  const history={recent:[{stats:{PTS:"20",REB:"10",AST:"0",STL:"0",BLK:"0"}},{stats:{PTS:"20",REB:"9",AST:"0",STL:"0",BLK:"0"}}]};
  const failed=row({hitProbability:null,simulations:10000,cached:true});
  const local=localPropSimulation(history,{player:"Player",market:failed.market,line:0.5,side:"Over"});
  for(const fallback of [mergePropSimWithLocal(failed,local)!,enrichPropSimResults([failed],{Player:history})[0]!]) {
    assert.equal(fallback.hitProbability,0.5);
    assert.equal(fallback.simulations,0);
    assert.equal(fallback.tier,"quick");
    assert.equal(fallback.cached,false);
    assert.equal(fallback.stdDev,null);
    assert.match(propSimulationEvidence(fallback),/^History estimate/);
  }
  assert.deepEqual(enrichPropSimResults([row()],{Player:history})[0],row());
});

test("screen labels scores separately and binds draw count to each prop result", () => {
  const source=readFileSync(new URL("../app/(tabs)/simulator.tsx",import.meta.url),"utf8");
  assert.match(source,/label="Quality score"/);
  assert.match(source,/label="Model score"/);
  assert.match(source,/propSimulationEvidence\(r\)/);
  assert.match(source,/propSimulationSummaryLabel\(propResults\)/);
  assert.ok(!source.includes('label="Sim Conf"'));
});

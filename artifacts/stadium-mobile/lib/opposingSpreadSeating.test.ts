import test from "node:test";
import assert from "node:assert/strict";
import {wouldRepeatMarketLadder, marketLadderScoreKey, dedupePicksByMarketLadder} from "./marketLadderKey.ts";
import {selectCorrelationAwareBoardLegs} from "./parlayCorrelationScore.ts";
import type {ParsedPick} from "../components/PickCard.tsx";
const pick=(team:string,line:number,sport="nfl",market="Spread",game="Tampa Bay Buccaneers @ Carolina Panthers"):ParsedPick=>({game,market,pick:`${team} +${line}`,sport,isProp:false,odds:-110});
for(const sport of ["nfl","ncaaf","nba","wnba","ncaab","nhl","mlb","soccer"]){
 test(`${sport}: opposing sides cannot fill one handicap market; candidates remain distinct`,()=>{
  const a=pick("Buccaneers",10,sport), b=pick("Panthers",10,sport);
  assert.notEqual(marketLadderScoreKey(a),marketLadderScoreKey(b));
  assert.equal(wouldRepeatMarketLadder(b,[a]),true);
  assert.equal(dedupePicksByMarketLadder([a,b]).length,1);
 });
}
test("different games and settlement periods remain independent",()=>{
 const a=pick("Buccaneers",10);
 assert.equal(wouldRepeatMarketLadder(pick("Panthers",10,"nfl","1H Spread"),[a]),false);
 assert.equal(wouldRepeatMarketLadder(pick("Panthers",10,"nfl","Spread","Other @ Game"),[a]),false);
});
test("selector replaces opposing spread with another candidate and keeps requested count",()=>{
 const a=pick("Buccaneers",10), b=pick("Panthers",10), c=pick("Broncos",7,"nfl","Spread","Denver Broncos @ Arizona Cardinals");
 const out=selectCorrelationAwareBoardLegs([{pick:a,rankScore:100},{pick:b,rankScore:99},{pick:c,rankScore:90}],2);
 assert.equal(out.length,2);assert.ok(out.includes(a));assert.ok(out.includes(c));
});

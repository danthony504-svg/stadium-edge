import test from 'node:test';
import assert from 'node:assert/strict';
import { confirmedSingleGameAsk } from './coachConfirmedSingleGame.ts';
const now = Date.parse('2026-10-29T18:00Z');
const input = (sport = 'nfl') => ({ askText: `8 leg ${sport}`, sports: [sport], now,
 oddsGames: [{sport,awayTeam:'Away',homeTeam:'Home',commenceTime:'2026-10-30T00:00Z'}],
 scheduleGames: [{sport,awayTeam:'Away',homeTeam:'Home',startsAt:'2026-10-30T00:00Z'}] });
test('corroborated one-game slates use existing single-event seating across sports', () => {
 for (const sport of ['nfl','nba','wnba','mlb','nhl','soccer','ncaaf','ncaab','tennis','ufc']) {
  const opts = input(sport); assert.equal(confirmedSingleGameAsk(opts), `${opts.askText} — same game: Away @ Home`);
 }
});
test('incomplete, ambiguous, started and multi-game boards keep existing scope', () => {
 for (const change of [(o:any)=>o.scheduleGames=[], (o:any)=>o.oddsGames=[], (o:any)=>o.oddsGames.push({...o.oddsGames[0],homeTeam:'Other'}),(o:any)=>o.scheduleGames.push({...o.scheduleGames[0],homeTeam:'Other'}),(o:any)=>o.scheduleGames[0].awayTeam='Other',(o:any)=>o.scheduleGames[0].sport='nba',(o:any)=>o.scheduleGames[0].startsAt='2026-10-31T00:00Z',(o:any)=>o.oddsGames[0].commenceTime='invalid',(o:any)=>o.now=Date.parse('2026-10-31T00:00Z'),(o:any)=>o.sports=['nfl','nba'],(o:any)=>o.maxGames=2,(o:any)=>o.askText='8 leg NFL across different games']) {
  const opts:any=input();change(opts);assert.equal(confirmedSingleGameAsk(opts),opts.askText);
 }
});

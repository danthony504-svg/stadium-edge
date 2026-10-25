import test from 'node:test';
import assert from 'node:assert/strict';
import { filterGameLinesForCoachSimulation, parseCoachAskMarketConstraint } from './coachAskMarketFilter.ts';
test('raw soccer game rows survive prop-key allowlists before simulation', () => {
  const lines = [{ sport: 'soccer', market: 'Both Teams To Score', pick: 'Yes' }];
  assert.deepEqual(filterGameLinesForCoachSimulation(lines, { ...parseCoachAskMarketConstraint('soccer BTTS'), propsOnly: false, allowedMarketKeys: ['btts'] }), lines);
});
test('pre-simulation filtering retains request exclusions and football period ban', () => {
  const lines = [{sport:'nfl',market:'Q1 Spread'}, {sport:'nfl',market:'Moneyline'}, {sport:'nfl',market:'Total'}];
  assert.deepEqual(filterGameLinesForCoachSimulation(lines, parseCoachAskMarketConstraint('NFL moneylines no totals')), [lines[1]]);
  assert.deepEqual(filterGameLinesForCoachSimulation(lines, parseCoachAskMarketConstraint('NFL player props only')), []);
});

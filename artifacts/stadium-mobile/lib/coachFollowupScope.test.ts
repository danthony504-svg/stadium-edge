import assert from 'node:assert/strict';import test from 'node:test';
import {resolveCoachFollowupAsk} from './coachFollowupScope.ts';
import {resolveImmutableAskSportScope} from './coachAskSportScope.ts';
import {excludedTeamScopesFromText,filterOddsGamesExcludingTeams} from './coachAskTeamScope.ts';
test('NBA follow-up stays NBA and excludes ATL before loading odds',()=>{
 const ask=resolveCoachFollowupAsk('8 leg new no ATL',['9 leg nba no ATL','8 leg new no ATL']);
 assert.deepEqual(resolveImmutableAskSportScope({askText:ask,boardSports:['nba','nfl','nhl']}),['nba']);
 const ex=excludedTeamScopesFromText(ask);assert.equal(ex.length,1);assert.equal(ex[0].sport,'nba');
 assert.deepEqual(filterOddsGamesExcludingTeams([{sport:'nba',homeTeam:'Orlando Magic',awayTeam:'Atlanta Hawks'},{sport:'nba',homeTeam:'Chicago Bulls',awayTeam:'Toronto Raptors'}],ex).map(g=>g.homeTeam),['Chicago Bulls']);
});
test('new props inherit explicit league and props intent across supported sports',()=>{
 for(const sport of ['nba','wnba','nfl','nhl','mlb','ncaaf','ncaab','soccer','tennis','ufc']){
  const ask=resolveCoachFollowupAsk('8 leg new',[`9 leg ${sport} player props`]);
  assert.match(ask,/player props/);assert.deepEqual(resolveImmutableAskSportScope({askText:ask,boardSports:[]}),[sport]);
 }
});
test('explicit switches, mixed requests, unrelated topics and fresh requests do not inherit',()=>{
 for(const ask of ['8 leg nfl','8 leg all sports','start over','8 leg tonight'])assert.equal(resolveCoachFollowupAsk(ask,['9 leg nba player props']),ask);
 assert.equal(resolveCoachFollowupAsk('8 leg new',['9 leg nba','explain my subscription']),'8 leg new');
 assert.equal(resolveCoachFollowupAsk('8 leg new',['9 leg nba','9 leg mixed sports']),'8 leg new');
 assert.equal(resolveCoachFollowupAsk('8 leg new spreads',['9 leg nba props']),'nba 8 leg new spreads');
});
test('city abbreviation exclusions respect league and coordinate lists',()=>{
 for(const sport of ['nba','wnba','nfl','mlb']){
  const ex=excludedTeamScopesFromText(`9 leg ${sport} no ATL or BOS`);assert.equal(ex.length,2);assert.ok(ex.every(x=>x.sport===sport));
 }
 assert.equal(excludedTeamScopesFromText('9 leg nba ATL').length,0);
});

test('follow-ups retain prior team exclusions without treating abbreviations as substrings',()=>{
 const ask=resolveCoachFollowupAsk('8 leg new',['9 leg nba no ATL']);
 assert.ok(excludedTeamScopesFromText(ask).some(x=>x.sport==='nba'&&x.matchTokens.includes('atlanta')));
 assert.deepEqual(resolveImmutableAskSportScope({askText:ask,boardSports:[]}),['nba']);
 const ex=excludedTeamScopesFromText('9 leg ncaaf no CHI');
 assert.equal(filterOddsGamesExcludingTeams([{sport:'ncaaf',homeTeam:'Michigan Wolverines',awayTeam:'Ohio State Buckeyes'}],ex).length,1);
});

test('same-league exclusion follow-up keeps props; an explicit different market overrides props',()=>{
 assert.equal(resolveCoachFollowupAsk('9 leg nba no ATL',['9 leg nba all new props']),'9 leg nba no ATL player props');
 assert.equal(resolveCoachFollowupAsk('9 leg nba spreads no ATL',['9 leg nba props']),'9 leg nba spreads no ATL');
});

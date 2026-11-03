import assert from 'node:assert/strict';
import test from 'node:test';
import { fullGameTotalHitRate } from './gameSimTotalHitReuse.ts';
import { deriveCoverHitRatesFromOutcomes, type GameCoverQuery } from './gameSimScoring.ts';
function reference(o:{homeScores:number[];awayScores:number[]},q:GameCoverQuery){let hits=0;for(let i=0;i<o.homeScores.length;i++){const h=o.homeScores[i]!,a=o.awayScores[i]!;if(!Number.isFinite(h)||!Number.isFinite(a))continue;const v=q.kind==='total'?h+a:q.teamSide==='home'?h:a;if(q.totalSide==='over'?v>(q.line??0):v<(q.line??0))hits++;}return Math.round(hits/o.homeScores.length*1000)/1000;}
test('exact alternate totals and pushes, including invalid pairs and floating thresholds',()=>{
 const o={homeScores:[0,10,20,20.5,0.1,NaN,Infinity,14],awayScores:[0,7,10,20.5,0.2,3,0,14]};
 for(const kind of ['total','teamTotal'] as const)for(const teamSide of ['home','away'] as const)for(const totalSide of ['over','under'] as const)for(const line of [-Infinity,-1,0,0.3,7,10,20,20.5,28,41,Infinity,NaN]){const q={id:'q',kind,teamSide,totalSide,line};assert.equal(fullGameTotalHitRate(o,q),reference(o,q),JSON.stringify(q));}
});
test('10k-draw complete ladder equals original comparisons across sports',()=>{
 const o={homeScores:Array.from({length:10000},(_,i)=>(i*17)%67),awayScores:Array.from({length:10000},(_,i)=>(i*13)%61)};
 for(const sport of ['nfl','ncaaf','nba','ncaab','wnba','nhl','mlb','soccer'])for(let line=0;line<100;line+=0.5){const q:GameCoverQuery={id:'q',kind:line%2?'teamTotal':'total',teamSide:'home',totalSide:line%3?'over':'under',line};assert.equal(deriveCoverHitRatesFromOutcomes(o,[q],sport).q,reference(o,q));}
});
test('non-FG/race/spread bypass; replaced outcomes stay isolated',()=>{
 const q:GameCoverQuery={id:'q',kind:'teamTotal',teamSide:'home',totalSide:'over',line:10};const o={homeScores:[20],awayScores:[0]};assert.equal(fullGameTotalHitRate(o,q),1);assert.equal(fullGameTotalHitRate({...o,homeScores:[0]},q),0);o.homeScores=[0];assert.equal(fullGameTotalHitRate(o,q),0);
 for(const query of [{...q,period:'h1' as const},{...q,kind:'raceTo' as const},{...q,kind:'spread' as const}])assert.equal(fullGameTotalHitRate(o,query),undefined);
});

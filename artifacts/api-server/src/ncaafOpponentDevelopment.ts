import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {readBacktestGames} from './lib/ncaafBacktest.js';
import {readBaselineQuotes} from './lib/ncaafMarketBaseline.js';
import {runOpponentDevelopment} from './lib/ncaafOpponentResearch.js';
try{
 const file=process.argv[2];if(!file)throw Error('backtest_input_required');
 const input=await readFile(file,'utf8');if(input.length>12000000)throw Error('backtest_input_too_large');
 const snapshots=input.split(/\r?\n/).filter(s=>s.trim()).map(s=>JSON.parse(s) as {year?:number}).filter(s=>s?.year===2024);
 const games=readBacktestGames(snapshots);if(!games.length)throw Error('backtest_2024_required');
 const researchInput=JSON.stringify(snapshots);
 console.log(JSON.stringify({...runOpponentDevelopment(games,readBaselineQuotes(snapshots)),developmentInputSha256:createHash('sha256').update(researchInput).digest('hex')},null,2));
}catch(e){const message=e instanceof Error?e.message:'';console.error(/^backtest_[a-z_]+$/.test(message)?message:'backtest_input_or_run_error');process.exitCode=1;}

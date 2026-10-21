import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {readBaselineQuotes} from './lib/ncaafMarketBaseline.js';
import {readBacktestGames,runNcaafBacktest} from './lib/ncaafBacktest.js';
try{
 const file=process.argv[2];if(!file)throw Error('backtest_input_required');
 const input=await readFile(file,'utf8');if(input.length>12000000)throw Error('backtest_input_too_large');
 const snapshots=input.split(/\r?\n/).filter(s=>s.trim()).map(s=>JSON.parse(s) as unknown);
 const games=readBacktestGames(snapshots),quotes=readBaselineQuotes(snapshots);
 if(![2024,2025].every(y=>games.some(g=>g.season===y)))throw Error('backtest_both_seasons_required');
 console.log(JSON.stringify({...runNcaafBacktest(games,quotes),inputSha256:createHash('sha256').update(input).digest('hex')},null,2));
}catch(e){const message=e instanceof Error?e.message:'';console.error(/^backtest_[a-z_]+$/.test(message)?message:'backtest_input_or_run_error');process.exitCode=1;}

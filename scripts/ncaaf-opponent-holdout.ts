/** Frozen ridge=4 / 100-iteration model from main. No tuning in this command. */
import {readFileSync} from "node:fs";
import {createHash} from "node:crypto";
import {readBacktestGames,priorTeamSample} from "../artifacts/api-server/src/lib/ncaafBacktest.ts";
import {readBaselineQuotes,compareMarketLines,type ScorePrediction} from "../artifacts/api-server/src/lib/ncaafMarketBaseline.ts";
import {opponentScoreMeans} from "../artifacts/api-server/src/lib/ncaafOpponentResearch.ts";
const input=readFileSync(process.argv[2]!,"utf8"),snapshots=input.split(/\r?\n/).filter(s=>s.trim()).map(s=>JSON.parse(s));
const games=readBacktestGames(snapshots).filter(g=>g.season===2025),quotes=readBaselineQuotes(snapshots);
const baseline:ScorePrediction[]=[],adjusted:ScorePrediction[]=[];
for(const g of games){if(g.overtime!==false)continue;const h=priorTeamSample(games,g,g.homeId),a=priorTeamSample(games,g,g.awayId),p=opponentScoreMeans(games,g);if(!h||!a||!p)continue;
 const hm=(h.ptsFor+a.ptsAgainst)/2,am=(a.ptsFor+h.ptsAgainst)/2;
 baseline.push({game:g,total:hm+am,margin:hm-am});adjusted.push({game:g,total:p.home+p.away,margin:p.home-p.away});}
const metric=(rows:ScorePrediction[])=>({totalMAE:rows.reduce((n,p)=>n+Math.abs(p.total-p.game.homePoints-p.game.awayPoints),0)/rows.length,marginMAE:rows.reduce((n,p)=>n+Math.abs(p.margin-p.game.homePoints+p.game.awayPoints),0)/rows.length,bookmakerComparison:compareMarketLines(rows,quotes,2025)});
console.log(JSON.stringify({season:2025,pairedGames:adjusted.length,frozenParameters:{ridge:4,iterations:100},baseline:metric(baseline),opponentAdjusted:metric(adjusted),productionReady:false,validationReady:false,inputSha256:createHash("sha256").update(input).digest("hex"),limitations:["retrospective_scores_not_probability_calibration","24h_completion_proxy","non_ot_subset","quote_timestamps_and_injuries_unverified","holdout_results_must_not_be_used_for_retuning"]},null,2));

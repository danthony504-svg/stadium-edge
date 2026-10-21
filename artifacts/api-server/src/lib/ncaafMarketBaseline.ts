/** Retrospective line-error comparison only; timestamps/closing status unverified. */
import type {CfbdGame} from './cfbdHistory.js';
export type BaselineQuote={season:number;eventId:string;provider:string;homeSpread:number|null;total:number|null};
export type ScorePrediction={game:CfbdGame;total:number;margin:number};
export function readBaselineQuotes(snapshots:unknown[]):BaselineQuote[]{
 const unique=new Map<string,BaselineQuote>();
 for(const raw of snapshots){
  const s=raw as {year:number;games:CfbdGame[];quotes:BaselineQuote[]};
  if(!s||!Array.isArray(s.quotes)||!Array.isArray(s.games))throw Error('backtest_invalid_quotes');
  const ids=new Set(s.games.map(g=>g.eventId));
  for(const q of s.quotes){
   if(!q||!ids.has(q.eventId)||typeof q.provider!=='string'||!q.provider.trim()||![q.homeSpread,q.total].every(v=>v===null||(typeof v==='number'&&Number.isFinite(v))))throw Error('backtest_invalid_quote');
   const quote={season:s.year,eventId:q.eventId,provider:q.provider,homeSpread:q.homeSpread,total:q.total};
   const key=JSON.stringify([s.year,q.eventId,q.provider]),prior=unique.get(key);
   // No observation times exist to select one of several differing quotes safely.
   if(prior&&(prior.homeSpread!==q.homeSpread||prior.total!==q.total))throw Error('backtest_ambiguous_book_line');
   unique.set(key,quote);
  }
 }
 return [...unique.values()];
}
export function compareMarketLines(predictions:ScorePrediction[],quotes:BaselineQuote[],season:number){
 const byGame=new Map(predictions.filter(p=>p.game.season===season).map(p=>[p.game.eventId,p]));
 type S={games:number;model:number;book:number};
 const books=new Map<string,{total:S;margin:S}>();
 const empty=():S=>({games:0,model:0,book:0});
 for(const q of quotes.filter(q=>q.season===season)){
  const p=byGame.get(q.eventId);if(!p)continue;
  let b=books.get(q.provider);if(!b){b={total:empty(),margin:empty()};books.set(q.provider,b);}
  if(q.total!==null){b.total.games++;b.total.model+=Math.abs(p.total-p.game.homePoints-p.game.awayPoints);b.total.book+=Math.abs(q.total-p.game.homePoints-p.game.awayPoints);}
  // Home -7 spread implies expected home-minus-away margin +7.
  if(q.homeSpread!==null){b.margin.games++;b.margin.model+=Math.abs(p.margin-p.game.homePoints+p.game.awayPoints);b.margin.book+=Math.abs(-q.homeSpread-p.game.homePoints+p.game.awayPoints);}
 }
 const finish=(s:S)=>({pairedGames:s.games,modelMAE:s.games?Number((s.model/s.games).toFixed(4)):null,bookMAE:s.games?Number((s.book/s.games).toFixed(4)):null,modelMinusBookMAE:s.games?Number(((s.model-s.book)/s.games).toFixed(4)):null});
 return [...books].sort(([a],[b])=>a.localeCompare(b)).map(([provider,b])=>({provider,total:finish(b.total),margin:finish(b.margin)}));
}

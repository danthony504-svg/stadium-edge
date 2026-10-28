/** Manual live-data replay. Run from stadium-mobile with:
 * EXPO_PUBLIC_DOMAIN=stadium-edge.onrender.com node --import ./test/register-hooks.mjs scripts/audit-coach-prop-delivery.mjs '7 leg' audit
 * Uses production selection and terminal checks; only native UI/network adapters
 * are replaced by the existing test resolver. Reliability/learning POSTs are
 * suppressed. Does not publish or measure native iPhone rendering speed.
 */
import {writeFileSync} from 'node:fs';
import {buildCoachParlay} from '../lib/coach/buildParlay.ts';
import {resolveCoachTerminalPicks,coachTerminalTicketIsComplete} from '../lib/coachTicketHold.ts';
import {latestCoachPropAudit} from '../lib/coachPropAudit.ts';
const ask=process.argv[2]||'7 leg',label=(process.argv[3]||'audit').replace(/[^a-zA-Z0-9_-]/g,'_'),target=7;
const realFetch=globalThis.fetch, requests=[],stages=[];let live=0,high=0;
globalThis.fetch=async(input,init)=>{
 const u=new URL(String(input));
 if(/reliability|learning\/recommendations|crash/.test(u.pathname))return new Response('{}',{status:202,headers:{'content-type':'application/json'}});
 const start=performance.now();live++;high=Math.max(high,live);
 try{const r=await realFetch(input,init);let summary;
 if(r.ok && /simulate\/props|team-defense/.test(u.pathname)){try{const d=await r.clone().json();summary=u.pathname.includes('simulate/props')?{rows:d.props?.length,valid:d.props?.filter(x=>x.hitProbability!=null).length,sims:[...new Set(d.props?.map(x=>x.simulations))],nulls:d.props?.reduce((o,x)=>(o[x.nullReason??'none']=(o[x.nullReason??'none']??0)+1,o),{})}:{sport:d.sport,markets:d.opponentMarkets?.length,keys:Object.keys(d)};}catch{}}
 requests.push({path:u.pathname,sport:u.searchParams.get('sport'),teamId:u.searchParams.get('teamId'),ms:Math.round(performance.now()-start),status:r.status,summary});return r;}catch(e){requests.push({path:u.pathname,ms:Math.round(performance.now()-start),error:e.name});throw e;}finally{live--;}
};
const ac=new AbortController(),start=performance.now();let delivered=null;
const kill=setTimeout(()=>ac.abort(),100000);
const mark=(phase,extra={})=>{stages.push({ms:Math.round(performance.now()-start),phase,...extra});console.log(JSON.stringify(stages.at(-1)));};
let result,error;
try{result=await buildCoachParlay({requestedLegs:target,askText:ask,signal:ac.signal,onStatus:s=>mark(s),onReadyToScan:i=>mark('ready',{pool:i.propPoolSize}),onPartialPicks:p=>{
 mark('partial',{legs:p.length,props:p.filter(x=>x.isProp).length});
 if(p.length>=target){const validated=resolveCoachTerminalPicks({bufferedPicks:p,messagePicks:null,askText:ask,requestedLegs:target,propPhaseIncomplete:!p.some(x=>x.isProp)});if(coachTerminalTicketIsComplete({picks:validated,requestedLegs:target})){delivered=validated;mark('phone_early_terminal',{props:validated.filter(x=>x.isProp).length});ac.abort();}}
}});}catch(e){error=String(e);}finally{clearTimeout(kill);}
await new Promise(r=>setTimeout(r,800));
const audit=latestCoachPropAudit(),picks=delivered??result?.picks??[];
const summary={label,ask,durationMs:Math.round(performance.now()-start),deliveredLegs:picks.length,deliveredProps:picks.filter(x=>x.isProp).length,pool:result?.propPoolSize,timedOut:result?.timedOut,error:delivered?null:error,phoneEarlySuccess:!!delivered,note:result?.note,perf:result?.perf,timing:result?.timing,delivered:picks.map(p=>({sport:p.sport,isProp:p.isProp,market:p.propMarketKey??p.market,grade:p.finalAiScore?.grade??p.aiGrade,confidence:p.finalAiScore?.confidencePct,edge:p.finalAiScore?.edgePct,source:(p.propProbabilityProvenance??p.finalAiScore?.propProbabilityProvenance)?.source,simulations:(p.propProbabilityProvenance??p.finalAiScore?.propProbabilityProvenance)?.simulations})),highConcurrent:high,auditCounts:audit?.counts,auditRows:audit?.rows.map(({sport,market,stage,reason,nullReason,issues,historyGames})=>({sport,market,stage,reason,nullReason,issues,historyGames})),requests,stages};
writeFileSync(`/tmp/coach-${label}.json`,JSON.stringify(summary,null,2));console.log('SUMMARY',JSON.stringify({...summary,requests:undefined,stages:undefined,auditRows:undefined}));
process.exit(0);

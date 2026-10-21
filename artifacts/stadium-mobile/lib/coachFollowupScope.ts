import {focalSportsFromText,isSoftSportPreferenceAsk} from './chatContextPriority.ts';
import {coachAskTeamScope,excludedTeamScopesFromText} from './coachAskTeamScope.ts';

const reset = /\b(?:all|any|mixed|different)\s+sports?\b|\bstart\s+over\b/i;
const continuation = /\b(?:new|again|another|same|instead|no|without|exclude|excluding|skip|avoid)\b/i;
const market = /\b(?:props?|spreads?|money\s*lines?|totals?|team\s+totals?|game\s+lines?|over|under)\b/i;
/** Carry explicit league/props intent only for a continuation, never across a reset or topic switch. */
export function resolveCoachFollowupAsk(current:string|null|undefined,priorUserTexts:readonly string[]=[]):string {
 const ask=String(current??'');
 if(reset.test(ask)||!continuation.test(ask))return ask;
 const named=focalSportsFromText(ask),team=coachAskTeamScope(ask);
 // Explicit current league/team overrides older intent in full.
 if(team)return ask;
 for(let i=priorUserTexts.length-1;i>=0;i--){
  const previous=String(priorUserTexts[i]??'').trim();
  if(!previous||previous===ask.trim())continue;
  if(reset.test(previous)||isSoftSportPreferenceAsk(previous))return ask;
  const sports=focalSportsFromText(previous),scope=coachAskTeamScope(previous);
  if(!sports.size&&scope)sports.add(scope.sport);
  if(sports.size){
   if(named.size&&(sports.size!==named.size||[...named].some(s=>!sports.has(s))))return ask;
   const inheritProps=!market.test(ask)&&/\b(?:player\s+)?props?\b/i.test(previous);
   const currentExclusions=new Set(excludedTeamScopesFromText(ask).map(x=>x.nick));
   const inheritedExclusions=[...new Set(excludedTeamScopesFromText(previous).filter(x=>sports.has(x.sport)&&!currentExclusions.has(x.nick)).map(x=>x.nick))].map(nick=>`no ${nick}`).join(' ');
   // Put inherited league before negative clauses so exclusion stripping cannot remove it.
   return `${named.size?'':[...sports].join(' ')+' '}${ask}${inheritProps?' player props':''}${inheritedExclusions?' '+inheritedExclusions:''}`;
  }
  if(!continuation.test(previous))return ask;
 }
 return ask;
}

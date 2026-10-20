/** Completed-game opportunity study. No model multipliers or request-time collection. */
import { createHash } from "node:crypto";
import { cacheGet, cacheSet } from "./store.js";
import { peekScoringSnapshot, warmScoringSnapshot, type ScoringSnapshot } from "./footballScoringOpportunities.js";
import { logger } from "./logger.js";
const paths: Record<string, string> = { nba: "basketball/nba", wnba: "basketball/wnba", ncaab: "basketball/mens-college-basketball" };
const TTL = 6 * 3600_000;
export type BasketballGameStudy = { eventId: string; date: string; players: Array<{ athleteId: string; minutes: number; fga: number; threePa: number }> };
export type CoachingStudy = {
  version: 1; mode: "shadow"; sport: string; teamId: string; collectedAt: number;
  eventIds: string[]; fingerprint: string; source: "espn_completed_games";
  metrics: Record<string, number>; players: Array<{ athleteId: string; games: number; minutesPerGame: number; shotAttemptShare: number; threeAttemptShare: number | null }>;
  unavailable: string[];
};
function envelope(sport: string, teamId: string, collectedAt: number, games: Array<{ eventId: string }>, metrics: Record<string, number>, players: CoachingStudy["players"], unavailable: string[]): CoachingStudy {
  return { version: 1, mode: "shadow", sport, teamId, collectedAt, eventIds: games.map(g => g.eventId), metrics, players, unavailable, source: "espn_completed_games", fingerprint: createHash("sha256").update(JSON.stringify({sport,teamId,games,metrics,players})).digest("hex").slice(0,24) };
}
export function footballCallStudy(snapshot: ScoringSnapshot): CoachingStudy | null {
  const games = [...new Map(snapshot.games.filter(g => Number.isFinite(Date.parse(g.date)) && Date.parse(g.date)<snapshot.collectedAt && snapshot.collectedAt-Date.parse(g.date)<=180*86400_000 && g.calls && g.calls.rush + g.calls.pass >= 20).map(g => [g.eventId,g])).values()];
  if (games.length < 3) return null;
  const total = (field: "rush" | "pass" | "earlyDownRush" | "earlyDownPass") => games.reduce((n,g) => n + g.calls![field],0);
  const early = total("earlyDownPass") + total("earlyDownRush");
  return envelope(snapshot.sport, snapshot.teamId, snapshot.collectedAt, games, { games: games.length, classifiedCalls: total("rush") + total("pass"), passAttemptShare: total("pass") / (total("pass") + total("rush")), ...(early ? { earlyDownPassAttemptShare: total("earlyDownPass") / early } : {}) }, [], ["coach_identity_and_tenure", "neutral_score_adjustment", "formations", "blitz_and_coverage", "routes", "designed_qb_run_vs_scramble", "sacks_not_in_pass_attempt_denominator"]);
}
const madeAttempts = (value: unknown): number | null => { const m = String(value ?? "").match(/^\d+-(\d+)$/); return m ? Number(m[1]) : null; };
/** Require a completed, ID-bound full team box; no invented usage/rotation labels. */
export function parseBasketballStudy(eventId: string, date: string, teamId: string, data: any, sport = "nba"): BasketballGameStudy | null {
  const comp = data.header?.competitions?.[0];
  if (String(data.header?.id) !== eventId || comp?.status?.type?.completed !== true || !comp.competitors?.some((c: any) => String(c.team?.id) === teamId)) return null;
  const blocks = (data.boxscore?.players ?? []).filter((b: any) => String(b.team?.id) === teamId);
  const players: BasketballGameStudy["players"] = [];
  for (const block of blocks) for (const group of block.statistics ?? []) {
    const labels: string[] = group.labels ?? [];
    const min = labels.indexOf("MIN"), fg = labels.indexOf("FG"), three = labels.indexOf("3PT");
    if (min < 0 || fg < 0 || three < 0) continue;
    for (const row of group.athletes ?? []) {
      if (row.didNotPlay) continue;
      const athleteId = String(row.athlete?.id ?? ""), raw = String(row.stats?.[min] ?? "");
      if (!/^\d+$/.test(athleteId) || !/^\d+(?::\d{2})?$/.test(raw)) return null;
      const [m,s] = raw.split(":").map(Number), minutes = m! + (s ?? 0)/60;
      const fga = madeAttempts(row.stats?.[fg]), threePa = madeAttempts(row.stats?.[three]);
      if (fga == null || threePa == null || threePa > fga || minutes < 0 || minutes > 80 || players.some(p => p.athleteId === athleteId)) return null;
      players.push({athleteId, minutes, fga, threePa});
    }
  }
  return players.length >= 5 && players.reduce((n,p) => n+p.minutes,0) >= (sport === "nba" ? 230 : 190) && players.reduce((n,p) => n+p.fga,0) >= 20 ? {eventId,date,players} : null;
}
export function basketballCallStudy(sport: string, teamId: string, gamesRaw: BasketballGameStudy[], now = Date.now()): CoachingStudy | null {
  if (!paths[sport]) return null;
  const games = [...new Map(gamesRaw.filter(g => Number.isFinite(Date.parse(g.date)) && Date.parse(g.date) < now && now-Date.parse(g.date) <= 180*86400_000).map(g => [g.eventId,g])).values()].sort((a,b)=>Date.parse(b.date)-Date.parse(a.date)).slice(0,5);
  if (games.length < 3) return null;
  const fga = games.reduce((n,g)=>n+g.players.reduce((s,p)=>s+p.fga,0),0), three = games.reduce((n,g)=>n+g.players.reduce((s,p)=>s+p.threePa,0),0);
  if (!fga) return null;
  const byId = new Map<string,{games:number;minutes:number;fga:number;three:number}>();
  for (const g of games) for (const p of g.players) { const a=byId.get(p.athleteId) ?? {games:0,minutes:0,fga:0,three:0}; a.games++;a.minutes+=p.minutes;a.fga+=p.fga;a.three+=p.threePa;byId.set(p.athleteId,a); }
  return envelope(sport,teamId,now,games,{games:games.length,fieldGoalAttempts:fga,threePointAttemptRate:three/fga},[...byId].map(([athleteId,p])=>({athleteId,games:p.games,minutesPerGame:p.minutes/p.games,shotAttemptShare:p.fga/fga,threeAttemptShare:three ? p.three/three : null})),["coach_identity_and_tenure","pick_and_roll","isolation","defensive_coverage","touches","rotation_stints","clutch_play_design"]);
}
const key=(sport:string,teamId:string)=>`coaching-study:v1:${sport}:${teamId}`;
export async function readCoachingStudy(sport:string,teamId:string,now=Date.now()):Promise<CoachingStudy|null> {
  let timer:ReturnType<typeof setTimeout>|undefined;
  try { const value=await Promise.race([cacheGet<CoachingStudy>(key(sport,teamId)),new Promise<undefined>(resolve=>{timer=setTimeout(()=>resolve(undefined),40);})]); return value?.version===1 && value.sport===sport && value.teamId===teamId && value.collectedAt<=now && now-value.collectedAt<TTL ? value : null; } catch {return null;} finally {if(timer) clearTimeout(timer);}
}
async function json(url:string):Promise<any> {const r=await fetch(url,{signal:AbortSignal.timeout(6000)});if(!r.ok)throw new Error(`study HTTP ${r.status}`);return r.json();}
/** Cron-only; bounded slate batch below prevents public requests amplifying work. */
export async function warmCoachingStudy(sport:string,teamId:string):Promise<void> {
  if (!/^\d+$/.test(teamId) || (!paths[sport] && !["nfl","ncaaf"].includes(sport))) return;
  if (await readCoachingStudy(sport,teamId)) return;
  try {
    let study:CoachingStudy|null=null;
    if (["nfl","ncaaf"].includes(sport)) { await warmScoringSnapshot(sport,teamId);const snap=peekScoringSnapshot(sport,teamId);if(snap) study=footballCallStudy(snap); }
    else {
      const schedule=await json(`https://site.api.espn.com/apis/site/v2/sports/${paths[sport]}/teams/${teamId}/schedule`);
      const events=(schedule.events??[]).filter((e:any)=>/^\d+$/.test(String(e.id)) && Date.parse(e.date)<Date.now() && e.competitions?.[0]?.status?.type?.completed===true).sort((a:any,b:any)=>Date.parse(b.date)-Date.parse(a.date)).slice(0,5);
      const games:BasketballGameStudy[]=[];
      for(const e of events) {const data=await json(`https://site.api.espn.com/apis/site/v2/sports/${paths[sport]}/summary?event=${e.id}`);const g=parseBasketballStudy(String(e.id),e.date,teamId,data,sport);if(g)games.push(g);}
      study=basketballCallStudy(sport,teamId,games);
    }
    if(study) await cacheSet(key(sport,teamId),study,TTL);
  } catch(error) {logger.warn({sport,teamId,error:error instanceof Error?error.message:"unavailable"},"coaching study unavailable; no model change");}
}
export async function warmCoachingStudyBatch(teams:Array<{sport:string;teamId:string}>):Promise<void> {
  const unique=[...new Map(teams.map(t=>[`${t.sport}:${t.teamId}`,t])).values()].filter(t=>paths[t.sport] || ["nfl","ncaaf"].includes(t.sport)).slice(0,12);
  for(let i=0;i<unique.length;i+=2) await Promise.all(unique.slice(i,i+2).map(t=>warmCoachingStudy(t.sport,t.teamId)));
}

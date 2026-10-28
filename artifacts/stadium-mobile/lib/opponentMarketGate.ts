/** Exact-stat opponent evidence is required for team-sport prop recommendations.
 * Unknown inputs withhold; no probability or synthetic league baseline is invented.
 */
export type OpponentMarketEvidence={market:string;perGame:number;sampleSize:number;firstGame:string;lastGame:string;scope:'team_allowed'|'team_offensive_exposure';source:string};
export function hasOpponentMarketEvidence(sport:string,market:string,rows:readonly OpponentMarketEvidence[]|null|undefined,cutoff=Date.now()):boolean{
 if(!['nba','wnba','ncaab','nfl','ncaaf','nhl','mlb','soccer'].includes(sport))return false;
 const key=market.replace(/_alternate$/,'');
 return !!rows?.some(r=>r.market===key&&Number.isSafeInteger(r.sampleSize)&&r.sampleSize>=3&&Number.isFinite(r.perGame)&&r.perGame>=0&&['team_allowed','team_offensive_exposure'].includes(r.scope)&&!!r.source&&Number.isFinite(Date.parse(r.firstGame))&&Date.parse(r.firstGame)<=Date.parse(r.lastGame)&&Date.parse(r.lastGame)<cutoff);
}
export const isTeamPropEvidenceRequired=(sport:string,market:string)=>['nba','wnba','ncaab','nfl','ncaaf','nhl','mlb','soccer'].includes(sport)&&/^(player|batter|pitcher)_/.test(market);

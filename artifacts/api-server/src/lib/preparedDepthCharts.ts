/** Reported depth order only. Never a confirmed starter or workload projection. */
import { createHash } from "node:crypto";
import { cachedJson } from "./sports.js";
export type DepthChartEvidence = {
 source: "espn_depthchart"; teamId: string; season: number; receivedAtMs: number;
 sourceResponseAt: string | null; publishedAt: null; sourceSha256: string;
 players: Array<{ athleteId: string; chartId: string; position: string; depthOrder: number }>;
 roleProjectionValidated: false;
};
type RawDepth = {team?: {id?: string}; season?: {year?: number}; timestamp?: string;
 depthchart?: Array<{id?: string; positions?: Record<string, {athletes?: Array<{id?: string}>}>}>};
export function parseDepthChartEvidence(raw: RawDepth, teamId: string, season: number, receivedAtMs: number): DepthChartEvidence | null {
 if (!/^\d+$/.test(teamId) || raw.team?.id !== teamId || raw.season?.year !== season || !Number.isFinite(receivedAtMs) || !raw.depthchart?.length) return null;
 const players: DepthChartEvidence["players"] = [];
 for (const chart of raw.depthchart) {
  if (!chart.id) continue;
  for (const [position, row] of Object.entries(chart.positions ?? {})) {
   const ids = (row.athletes ?? []).map(a => a.id);
   // Duplicate/unknown IDs make this position's ordering ambiguous.
   if (!ids.length || ids.some(id => !id || !/^\d+$/.test(id)) || new Set(ids).size !== ids.length) continue;
   ids.forEach((id, i) => players.push({athleteId: id!, chartId: chart.id!, position, depthOrder:i+1}));
  }
 }
 if (!players.length) return null;
 return {source:"espn_depthchart", teamId, season, receivedAtMs,
 sourceResponseAt: typeof raw.timestamp === "string" && Number.isFinite(Date.parse(raw.timestamp)) ? raw.timestamp : null,
 // Endpoint timestamp is not independently verified publication time.
 publishedAt:null, sourceSha256:createHash("sha256").update(JSON.stringify(raw)).digest("hex"), players, roleProjectionValidated:false};
}
/** Background-only. Caller supplies season from the event, never the wall clock. */
export async function warmDepthChartEvidence(teamId: string, season: number): Promise<DepthChartEvidence | null> {
 if (!/^\d+$/.test(teamId) || !Number.isInteger(season)) return null;
 try {
  return await cachedJson(`coach-depth:v1:nfl:${season}:${teamId}`, 15*60_000, async () => {
   const r=await fetch(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/${teamId}/depthcharts`, {signal:AbortSignal.timeout(1000)});
   if (!r.ok) throw Error("depth_source_unavailable");
   const evidence=parseDepthChartEvidence(await r.json() as RawDepth,teamId,season,Date.now());
   if (!evidence) throw Error("depth_source_identity_or_order_invalid");
   return evidence;
  });
 } catch {return null;}
}

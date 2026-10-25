/** Sanitized cohort inventory over the existing immutable research archive.
 * Metadata eligibility is NOT independent authentication or release acceptance.
 */
import type { ResearchDb } from "./ncaafValidationPipeline.js";
import { loadFrozenAdjustedModel } from "./ncaafAdjustedModelStore.js";
import { ADJUSTED_MODEL_VERSION } from "./ncaafAdjustedModel.js";
export type LedgerRow = {season: string; eventId: string; modelVersion: string; role: string;
 recordedAt: string; forecastAt: string; kickoff: string; settlementLinked: boolean; development: boolean};
export function summarizeResearchLedger(rows: LedgerRow[], registry: {modelVersion:string;frozenAt:string;excludedGameIds:string[]} | null, now: string, truncated=false) {
 const clock=Date.parse(now);if (!Number.isFinite(clock)) throw Error("ledger_invalid_clock");
 const excluded=new Set(registry?.excludedGameIds ?? []);
 const reasons: Record<string,number>={};
 const cohorts=new Map<string,{season:number;modelVersion:string;games:Set<string>;settled:Set<string>}>();
 for (const r of rows) {
  let reason:string|null=null;
  const id=`${r.season}:${r.eventId}`,recorded=Date.parse(r.recordedAt),forecast=Date.parse(r.forecastAt),kickoff=Date.parse(r.kickoff);
  if (!/^\d{4}$/.test(r.season) || !/^\d+$/.test(r.eventId)) reason="invalid_game_identity";
  else if (r.development || excluded.has(id)) reason="development_or_excluded_game";
  else if (!registry || r.role!=="independent_holdout" || r.modelVersion!==registry.modelVersion) reason="not_current_frozen_holdout";
  else if (![recorded,forecast,kickoff].every(Number.isFinite) || !Number.isFinite(Date.parse(registry.frozenAt)) || forecast<Date.parse(registry.frozenAt) || forecast>recorded || recorded>=kickoff || recorded>clock) reason="invalid_prospective_timing";
  if (reason) {reasons[reason]=(reasons[reason]??0)+1;continue;}
  const key=`${r.modelVersion}:${r.season}`;
  const cohort=cohorts.get(key)??{season:Number(r.season),modelVersion:r.modelVersion,games:new Set<string>(),settled:new Set<string>()};
  cohort.games.add(id);if(r.settlementLinked)cohort.settled.add(id);cohorts.set(key,cohort);
 }
 const values=[...cohorts.values()].map(c=>({season:c.season,modelVersion:c.modelVersion,distinctProspectiveGames:c.games.size,settlementLinkedGames:c.settled.size})).sort((a,b)=>a.season-b.season);
 return {checkedAt:now,researchOnly:true,coachEnabled:false,releaseEligible:false,qualifiedHoldoutGames:null,
 scope:"metadata_inventory_not_authenticated_validation",truncated,rowsInspected:rows.length,cohorts:values,excludedReasons:reasons,
 requirements:{independentGames:500,seasons:2},
 limitations:["settlement_links_do_not_verify_outcomes","source_hashes_exact_lines_and_pushes_require_separate_authentication","development_and_old_forecasts_are_not_relabelled","metadata_counts_do_not_pass_calibration_or_release_review"]};
}
export async function loadResearchLedger(db:ResearchDb) {
 const frozen=await loadFrozenAdjustedModel(db);
 const clock=(await db.query("SELECT clock_timestamp() AS now")).rows[0].now;
 const result=await db.query(`SELECT f.value->'target'->>'season' AS season,f.value->'target'->>'eventId' AS "eventId",
 f.value->>'modelVersion' AS "modelVersion",f.value->>'datasetRole' AS role,
 f.value->>'recordedAt' AS "recordedAt",f.value->>'forecastAt' AS "forecastAt",f.value->'target'->>'kickoff' AS kickoff,
 EXISTS(SELECT 1 FROM public.app_kv s WHERE s.key=replace(f.key,'research:ncaaf:forecast:','research:ncaaf:settlement:')) AS "settlementLinked",
 EXISTS(SELECT 1 FROM public.app_kv d WHERE d.key LIKE 'research:ncaaf:context-input:v2:%' AND d.value->>'datasetRole'='development_only'
 AND d.value->'target'->>'season'=f.value->'target'->>'season' AND d.value->'target'->>'eventId'=f.value->'target'->>'eventId') AS development
 FROM public.app_kv f WHERE f.key LIKE 'research:ncaaf:forecast:%' ORDER BY f.key LIMIT 10001`);
 return summarizeResearchLedger(result.rows.slice(0,10000),frozen?{modelVersion:`${ADJUSTED_MODEL_VERSION}:${frozen.pointer.modelSha256}`,frozenAt:frozen.artifact.frozenAt,excludedGameIds:frozen.artifact.excludedGameIds}:null,new Date(clock).toISOString(),result.rows.length>10000);
}

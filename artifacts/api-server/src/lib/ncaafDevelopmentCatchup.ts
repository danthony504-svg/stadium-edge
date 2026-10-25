/** Free evidence catch-up for development or independent holdout contexts; never requests odds. */
import { loadFrozenAdjustedModel } from "./ncaafAdjustedModelStore.js";
import { researchSlot, type ResearchDb } from "./ncaafValidationPipeline.js";
export async function catchUpNcaafDevelopment({ db, runCollector, loadFrozen = loadFrozenAdjustedModel }: {
  db: ResearchDb;
  runCollector: (name: string, args: string[]) => Promise<void>;
  loadFrozen?: typeof loadFrozenAdjustedModel;
}) {
  if ((await db.query("SELECT current_database() AS name")).rows[0].name !== "stadium_edge_production")
    throw Error("context_unexpected_database");
  const pointer = (await db.query("SELECT value FROM public.app_kv WHERE key=$1", ["research:ncaaf:context-model:first:v1"])).rows[0]?.value;
  // A frozen model ends development, not prospective evidence collection.
  // The journal still independently authenticates contexts and excludes training.
  const frozen = pointer ? await loadFrozen(db) : null;
  if (pointer && !frozen) throw Error("context_invalid_frozen_registry");
  const now = new Date((await db.query("SELECT clock_timestamp() AS now")).rows[0].now);
  const live = (await db.query("SELECT key,value FROM public.app_kv WHERE key LIKE 'research:ncaaf:live-inputs:%' ORDER BY key DESC LIMIT 1")).rows[0]?.value;
  if (!live) return { state: "waiting_for_current_inputs", releaseEligible: false };
  const received = Date.parse(live.odds?.receivedAt);
  if (!Number.isFinite(received) || received > now.getTime() || now.getTime() - received > 12 * 3600000)
    return { state: "waiting_for_current_inputs", releaseEligible: false };
  if (live.version !== 1 || live.researchOnly !== true || !Array.isArray(live.matched) || live.matched.length > 128)
    throw Error("context_invalid_live_archive");
  const excluded = new Set(frozen?.artifact.excludedGameIds ?? []);
  const targets = live.matched.filter((m: any) => Date.parse(m.target?.kickoff) > now.getTime() && !excluded.has(`${m.target?.season}:${m.target?.eventId}`));
  if (!targets.length) return { state: "waiting_for_upcoming_targets", releaseEligible: false };
  const seasons = [...new Set<number>(targets.map((m: any) => m.target.season))];
  if (seasons.length > 2 || seasons.some(s => !Number.isSafeInteger(s) || s < 2021 || s > now.getUTCFullYear()))
    throw Error("context_invalid_season");
  // Reuse the actual slot: usage's 64-attempt ledger and immutable history caches
  // remain authoritative across both prewarming and this catch-up pass.
  const slot = researchSlot(new Date(received));
  if (slot !== researchSlot(now)) return { state: "waiting_for_active_slot_inputs", releaseEligible: false };
  // Free evidence only — injuries keep the journal's 6h freshness window alive
  // when the paid odds slot already finished earlier in the day. Isolate injury
  // failures so conference/usage/context retries still run.
  let injuryRefreshFailed = false;
  try {
    await runCollector("ncaaf-capture-injuries.mjs", []);
  } catch {
    injuryRefreshFailed = true;
  }
  // One additional, deduplicated public report capture per odds slot.
  // Empty verifiedEvents stays retryable inside the collector after backoff.
  await runCollector("ncaaf-conference-availability.mjs", ["--capture-slot", slot, "--development-catchup"]);
  for (const season of seasons)
    await runCollector("ncaaf-repair-team-history.mjs", ["--season", String(season), "--capture-slot", slot]);
  await runCollector("ncaaf-capture-usage.mjs", ["--capture-slot", slot]);
  await runCollector("ncaaf-context-dataset.mjs", []);
  return {
    state: "processed",
    contextRole: frozen ? "holdout_context" : "development_only",
    upcomingTargets: targets.length,
    injuryRefreshFailed,
    releaseEligible: false,
  };
}

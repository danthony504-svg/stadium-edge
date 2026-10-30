/** Free evidence catch-up for development or independent holdout contexts; never requests odds. */
import { loadFrozenAdjustedModel } from "./ncaafAdjustedModelStore.js";
import { researchSlot, type ResearchDb } from "./ncaafValidationPipeline.js";

const CATCHUP_LATEST = "research:ncaaf:development-catchup:latest";

function sanitizeStepReason(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  return /^(pipeline|context|conference|usage|repair|history|injury|development|collector)_[a-z0-9_]+$/.test(
    message,
  )
    ? message
    : "pipeline_collector_failed";
}

export async function catchUpNcaafDevelopment({
  db,
  runCollector,
  loadFrozen = loadFrozenAdjustedModel,
}: {
  db: ResearchDb;
  runCollector: (name: string, args: string[]) => Promise<void>;
  loadFrozen?: typeof loadFrozenAdjustedModel;
}) {
  if (
    (await db.query("SELECT current_database() AS name")).rows[0].name !==
    "stadium_edge_production"
  )
    throw Error("context_unexpected_database");
  const pointer = (
    await db.query("SELECT value FROM public.app_kv WHERE key=$1", [
      "research:ncaaf:context-model:first:v1",
    ])
  ).rows[0]?.value;
  // A frozen model ends development, not prospective evidence collection.
  // The journal still independently authenticates contexts and excludes training.
  const frozen = pointer ? await loadFrozen(db) : null;
  if (pointer && !frozen) throw Error("context_invalid_frozen_registry");
  const now = new Date(
    (await db.query("SELECT clock_timestamp() AS now")).rows[0].now,
  );
  const live = (
    await db.query(
      "SELECT key,value FROM public.app_kv WHERE key LIKE 'research:ncaaf:live-inputs:%' ORDER BY key DESC LIMIT 1",
    )
  ).rows[0];
  if (!live?.value)
    return { state: "waiting_for_current_inputs", releaseEligible: false };
  const received = Date.parse(live.value.odds?.receivedAt);
  if (
    !Number.isFinite(received) ||
    received > now.getTime() ||
    now.getTime() - received > 12 * 3600000
  )
    return { state: "waiting_for_current_inputs", releaseEligible: false };
  if (
    live.value.version !== 1 ||
    live.value.researchOnly !== true ||
    !Array.isArray(live.value.matched) ||
    live.value.matched.length > 128
  )
    throw Error("context_invalid_live_archive");
  const excluded = new Set(frozen?.artifact.excludedGameIds ?? []);
  const targets = live.value.matched.filter(
    (m: any) =>
      Date.parse(m.target?.kickoff) > now.getTime() &&
      !excluded.has(`${m.target?.season}:${m.target?.eventId}`),
  );
  if (!targets.length)
    return { state: "waiting_for_upcoming_targets", releaseEligible: false };
  const seasons = [
    ...new Set<number>(targets.map((m: any) => m.target.season)),
  ];
  if (
    seasons.length > 2 ||
    seasons.some(
      (s) =>
        !Number.isSafeInteger(s) || s < 2021 || s > now.getUTCFullYear(),
    )
  )
    throw Error("context_invalid_season");
  // Reuse the actual slot: usage's 64-attempt ledger and immutable history caches
  // remain authoritative across both prewarming and this catch-up pass.
  const slot = researchSlot(new Date(received));
  if (slot !== researchSlot(now))
    return { state: "waiting_for_active_slot_inputs", releaseEligible: false };

  const startedAt = now.toISOString();
  const steps: {
    collector: string;
    state: string;
    reason?: string;
  }[] = [];

  const runStep = async (collector: string, args: string[] = []) => {
    try {
      await runCollector(collector, args);
      steps.push({ collector, state: "processed" });
      return true;
    } catch (error) {
      steps.push({
        collector,
        state: "failed",
        reason: sanitizeStepReason(error),
      });
      return false;
    }
  };

  // Free evidence only — injuries keep the journal's 6h freshness window alive
  // when the paid odds slot already finished earlier in the day. Isolate injury
  // failures so conference/usage/context retries still run.
  const injuryOk = await runStep("ncaaf-capture-injuries.mjs");
  // One additional, deduplicated public report capture per odds slot.
  // Empty verifiedEvents stays retryable inside the collector after backoff.
  // Soft-continue after conference faults so usage/context still retry.
  await runStep("ncaaf-conference-availability.mjs", [
    "--capture-slot",
    slot,
    "--development-catchup",
  ]);
  for (const season of seasons)
    await runStep("ncaaf-repair-team-history.mjs", [
      "--season",
      String(season),
      "--capture-slot",
      slot,
    ]);
  await runStep("ncaaf-capture-usage.mjs", ["--capture-slot", slot]);
  const contextOk = await runStep("ncaaf-context-dataset.mjs");

  const failed = steps.filter((s) => s.state === "failed");
  const finishedAt = new Date(
    (await db.query("SELECT clock_timestamp() AS now")).rows[0].now,
  ).toISOString();
  const contextStep = steps.find(
    (s) => s.collector === "ncaaf-context-dataset.mjs",
  );
  const result = {
    state: !contextOk
      ? "context_assembly_failed"
      : failed.length
        ? "partial_failure"
        : "processed",
    contextRole: frozen ? "holdout_context" : "development_only",
    upcomingTargets: targets.length,
    liveArchiveKey: live.key,
    slot,
    injuryRefreshFailed: !injuryOk,
    contextAssemblyFailed: !contextOk,
    steps,
    failedCollectors: failed.map((s) => s.collector),
    failedReasons: Object.fromEntries(
      failed.map((s) => [s.collector, s.reason ?? "pipeline_collector_failed"]),
    ),
    primaryFailureReason: !contextOk
      ? (contextStep?.reason ??
        "pipeline_collector_ncaaf_context_dataset_failed")
      : (failed[0]?.reason ?? null),
    startedAt,
    finishedAt,
    researchOnly: true,
    releaseEligible: false,
  };
  await db.query(
    "INSERT INTO public.app_kv(key,value) VALUES($1,$2::jsonb) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=now()",
    [CATCHUP_LATEST, JSON.stringify(result)],
  );

  // Context assembly is the holdout-blocking step: surface its exact collector
  // code to lifecycle. Soft injuries/conference faults stay visible in
  // catchup:latest without collapsing the whole stage to a generic token when
  // contexts were written.
  if (!contextOk) {
    throw Error(
      contextStep?.reason ??
        "pipeline_collector_ncaaf_context_dataset_failed",
    );
  }
  return result;
}

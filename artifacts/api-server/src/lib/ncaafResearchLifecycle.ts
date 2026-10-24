/** Independent research stages. Nothing here changes Coach release authority. */
import type { ResearchDb } from "./ncaafValidationPipeline.js";
import { calibrationReport } from "./ncaafValidationPipeline.js";
export type LifecycleDependencies = {
  db: ResearchDb;
  settle: () => Promise<unknown>;
  collect: () => Promise<unknown>;
  transfer?: () => Promise<unknown>;
  label: () => Promise<unknown>;
  prepareDevelopment: () => Promise<unknown>;
  fitAdjusted?: () => Promise<unknown>;
  journalAdjusted?: () => Promise<unknown>;
  catchUpDevelopment?: () => Promise<unknown>;
};
const PREFIX = "research:ncaaf:lifecycle:";
const CADENCE = 30 * 60000;
const time = (s: unknown) => (typeof s === "string" ? Date.parse(s) : NaN);
export async function runNcaafResearchLifecycle(deps: LifecycleDependencies) {
  const { db } = deps;
  if (
    (await db.query("SELECT current_database() AS name")).rows[0].name !==
    "stadium_edge_production"
  )
    throw Error("lifecycle_unexpected_database");
  if (
    !(await db.query("SELECT pg_try_advisory_lock(64233,20261103) AS acquired"))
      .rows[0].acquired
  )
    return { state: "skipped_overlap", releaseEligible: false };
  const clock = async () =>
    new Date(
      (await db.query("SELECT clock_timestamp() AS now")).rows[0].now,
    ).toISOString();
  const get = async (key: string) =>
    (await db.query("SELECT value FROM public.app_kv WHERE key=$1", [key]))
      .rows[0]?.value;
  const put = async (key: string, value: unknown) => {
    await db.query(
      "INSERT INTO public.app_kv(key,value) VALUES($1,$2::jsonb) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=now()",
      [key, JSON.stringify(value)],
    );
  };
  let startedAt = "";
  const stages: Record<
    string,
    {
      state: string;
      startedAt?: string;
      finishedAt?: string;
      reason?: string;
      resultState?: string;
    }
  > = {};
  async function stage(
    name: string,
    action: () => Promise<unknown>,
    throttle = false,
  ) {
    const key = PREFIX + "stage:" + name,
      now = await clock(),
      previous = await get(key);
    if (
      throttle &&
      Number.isFinite(time(previous?.startedAt)) &&
      Date.parse(now) >= time(previous.startedAt) &&
      Date.parse(now) - time(previous.startedAt) < CADENCE
    ) {
      stages[name] = {
        state: "skipped_cadence",
        startedAt: previous.startedAt,
        finishedAt: previous.finishedAt,
      };
      return;
    }
    // Durable claim precedes work, including failed work; do not spin on repeated cron ticks.
    stages[name] = { state: "running", startedAt: now };
    await put(key, {
      ...stages[name],
      researchOnly: true,
      releaseEligible: false,
    });
    await put(PREFIX + "latest", {
      version: 2,
      state: "running",
      startedAt,
      stages,
      researchOnly: true,
      releaseEligible: false,
      coachEnabled: false,
    });
    try {
      const result = await action();
      const resultState =
        result &&
        typeof result === "object" &&
        "state" in result &&
        typeof result.state === "string" &&
        /^[a-z_]+$/.test(result.state)
          ? result.state
          : undefined;
      stages[name] = {
        ...(resultState ? { resultState } : {}),
        ...stages[name],
        state: "completed",
        finishedAt: await clock(),
      };
    } catch (e) {
      const reason =
        e instanceof Error &&
        /^(adjusted|context|development|transfer|journal|pipeline)_[a-z_]+$/.test(
          e.message,
        )
          ? e.message
          : "stage_failed";
      stages[name] = {
        ...stages[name],
        state: "failed",
        finishedAt: await clock(),
        reason,
      };
    }
    await put(key, {
      ...stages[name],
      researchOnly: true,
      releaseEligible: false,
    });
    await put(PREFIX + "latest", {
      version: 2,
      state: "running",
      startedAt,
      stages,
      researchOnly: true,
      releaseEligible: false,
      coachEnabled: false,
    });
  }
  try {
    startedAt = await clock();
    await put(PREFIX + "latest", {
      version: 2,
      state: "running",
      startedAt,
      stages,
      researchOnly: true,
      releaseEligible: false,
      coachEnabled: false,
    });
    // Finish cheap outcome maintenance before any potentially slow collection work.
    await stage("settlement", deps.settle);
    await stage("development_labels", deps.label, true);
    await stage("development_dataset", deps.prepareDevelopment, true);
    if (deps.fitAdjusted) await stage("adjusted_model", deps.fitAdjusted, true);
    await stage(
      "research_metrics",
      async () => {
        const settlements = (
          await db.query(
            "SELECT jsonb_build_object('researchOnly',value->'researchOnly','metrics',value->'metrics') AS value FROM public.app_kv WHERE key LIKE 'research:ncaaf:settlement:%' ORDER BY key DESC LIMIT 5000",
          )
        ).rows.map((r) => r.value);
        // Descriptive research scores only: neither these counts nor metrics approve release.
        await put(PREFIX + "metrics", {
          ...calibrationReport(settlements),
          refreshedAt: await clock(),
          scope: "latest_5000_settlement_records_not_independent_holdout",
        });
      },
      true,
    );
    await stage("collection", deps.collect);
    if (deps.catchUpDevelopment)
      await stage("development_catchup", deps.catchUpDevelopment, true);
    if (deps.transfer) await stage("transfer_journal", deps.transfer);
    if (deps.journalAdjusted)
      await stage("adjusted_journal", deps.journalAdjusted);
    const failed = Object.values(stages).some((s) => s.state === "failed");
    const report = {
      version: 2,
      state: failed ? "partial_failure" : "completed",
      startedAt,
      finishedAt: await clock(),
      stages,
      researchOnly: true,
      releaseEligible: false,
      coachEnabled: false,
    };
    await put(PREFIX + "latest", report);
    return report;
  } finally {
    await db.query("SELECT pg_advisory_unlock(64233,20261103)");
  }
}

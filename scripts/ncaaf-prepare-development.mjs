/** Authenticate completed development examples; never fit or invent a model. */
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  outcomeFromSettlement,
  contextFeatures,
  usageFromSummary,
} from "./ncaaf-context-dataset.mjs";
import { bindConferenceReports } from "./ncaaf-conference-availability.mjs";
const canonical = (x) => JSON.stringify(sort(x));
const sort = (x) =>
  Array.isArray(x)
    ? x.map(sort)
    : x && typeof x === "object"
      ? Object.fromEntries(
          Object.keys(x)
            .sort()
            .map((k) => [k, sort(x[k])]),
        )
      : x;
const hash = (x) => createHash("sha256").update(canonical(x)).digest("hex");
export function authenticateDevelopmentExample(
  inputKey,
  input,
  label,
  settlement,
  history,
  now,
) {
  const t = input?.target;
  if (
    !/^research:ncaaf:context-input:v2:\d{4}:\d+$/.test(inputKey) ||
    input?.datasetRole !== "development_only" ||
    input.featureVersion !== "ncaaf-participation-availability-v2" ||
    !t ||
    inputKey !== `research:ncaaf:context-input:v2:${t.season}:${t.eventId}` ||
    label?.inputKey !== inputKey ||
    label.inputSha256 !== hash(input) ||
    label.datasetRole !== "development_only" ||
    label.settlementKey !== settlement?.key ||
    !Number.isFinite(Date.parse(label.observedAt)) ||
    Date.parse(label.observedAt) > Date.parse(now) ||
    Date.parse(label.observedAt) < Date.parse(label.sourceReceivedAt)
  )
    throw Error("development_input_or_label_mismatch");
  const checked = outcomeFromSettlement(input, settlement.value, now);
  if (
    canonical(checked.outcome) !== canonical(label.outcome) ||
    checked.sourceSha256 !== label.sourceSha256 ||
    checked.sourceReceivedAt !== label.sourceReceivedAt
  )
    throw Error("development_final_mismatch");
  const evidence = input.historySourceEvidence;
  if (
    !evidence ||
    evidence.key !== history?.key ||
    evidence.sha256 !== hash(history.value) ||
    !Array.isArray(evidence.priorEventIds) ||
    !Array.isArray(history.value.games) ||
    new Set(evidence.priorEventIds).size !== evidence.priorEventIds.length
  )
    throw Error("development_history_mismatch");
  const selected = history.value.games.filter((g) =>
    evidence.priorEventIds.includes(g.eventId),
  );
  if (
    selected.length !== evidence.priorEventIds.length ||
    selected.some(
      (g) =>
        g.eventId === t.eventId ||
        g.season !== t.season ||
        !Number.isFinite(Date.parse(g.observedAt)) ||
        !Number.isFinite(Date.parse(g.completedAt)) ||
        Date.parse(g.observedAt) > Date.parse(input.capturedAt) ||
        Date.parse(g.completedAt) >= Date.parse(input.capturedAt),
    )
  )
    throw Error("development_future_or_missing_history");
  if (
    input.sides?.length !== 2 ||
    new Set(input.sides.map((s) => s.teamId)).size !== 2 ||
    input.sides.some((s) => ![t.homeId, t.awayId].includes(s.teamId))
  )
    throw Error("development_team_mismatch");
  const missing = [];
  if (typeof t.neutralSite !== "boolean") missing.push("venue_unknown");
  for (const side of input.sides)
    for (const family of ["passingAttempts", "carries", "receptions"]) {
      const f = side.features?.[family],
        shares = f?.shares;
      if (
        f?.coverage !== "observed_participation" ||
        !Number.isSafeInteger(f.games) ||
        f.games < 3 ||
        !shares ||
        [
          "available",
          "probable",
          "questionable",
          "doubtful",
          "out",
          "game_time_decision",
          "unknown",
        ].some((k) => !Object.hasOwn(shares, k)) ||
        Object.keys(shares).length !== 7 ||
        Object.values(shares).some(
          (n) => typeof n !== "number" || !Number.isFinite(n) || n < 0 || n > 1,
        ) ||
        Math.abs(Object.values(shares).reduce((a, b) => a + b, 0) - 1) > 1e-9
      )
        missing.push(`${side.teamId}:${family}:usage_unknown`);
    }
  // A missing feature is not converted into a healthy player or a zero adjustment.
  return {
    season: t.season,
    eventId: t.eventId,
    kickoff: t.kickoff,
    inputKey,
    inputSha256: hash(input),
    labelSha256: hash(label),
    settlementKey: settlement.key,
    historyKey: history.key,
    historySha256: evidence.sha256,
    sourceReceivedAt: checked.sourceReceivedAt,
    featureComplete: missing.length === 0,
    missing,
    datasetRole: "development_only",
  };
}
export async function verifyContextSources(input, read) {
  if (
    !input ||
    !Array.isArray(input.usageArchiveKeys) ||
    input.usageArchiveKeys.length > 10 ||
    new Set(input.usageArchiveKeys).size !== input.usageArchiveKeys.length
  )
    throw Error("development_usage_sources_invalid");
  const availability = await read(input.availabilityArchiveKey),
    live = await read(input.liveArchiveKey);
  if (!availability || !live) throw Error("development_source_archive_missing");
  const bindings = bindConferenceReports(
    availability.value,
    live.value,
    input.capturedAt,
  ).filter(
    (b) =>
      b.eventBindingVerified &&
      b.target.eventId === input.target.eventId &&
      b.target.season === input.target.season,
  );
  if (
    bindings.length !== 1 ||
    canonical(bindings[0].sourceHashes) !==
      canonical(input.availabilitySourceHashes)
  )
    throw Error("development_availability_binding_mismatch");
  const usage = [];
  for (const key of input.usageArchiveKeys) {
    const row = await read(key);
    if (!row) throw Error("development_usage_archive_missing");
    usage.push(usageFromSummary(row.value, input.target, input.capturedAt));
  }
  const reconstructed = contextFeatures(bindings[0], usage, input.capturedAt);
  for (const field of [
    "target",
    "featureVersion",
    "sides",
    "availabilityObservedAt",
    "availabilityPublishedAt",
  ])
    if (canonical(reconstructed[field]) !== canonical(input[field]))
      throw Error("development_feature_source_mismatch");
}
export async function prepareDevelopmentDataset(db) {
  if (
    (await db.query("SELECT current_database() AS name")).rows[0].name !==
    "stadium_edge_production"
  )
    throw Error("development_unexpected_database");
  const now = new Date(
    (await db.query("SELECT clock_timestamp() AS now")).rows[0].now,
  ).toISOString();
  const rows = (
    await db.query(
      "SELECT i.key,i.value,l.value AS label FROM public.app_kv i LEFT JOIN public.app_kv l ON l.key=replace(i.key,'context-input:','context-outcome:') WHERE i.key LIKE 'research:ncaaf:context-input:v2:%' ORDER BY i.key LIMIT 1025",
    )
  ).rows;
  if (rows.length > 1024)
    throw Error("development_batch_limit_requires_partition");
  const examples = [],
    errors = {},
    cache = new Map(),
    seen = new Set();
  let pending = 0;
  const read = async (key) => {
    if (typeof key !== "string" || !key.startsWith("research:ncaaf:"))
      throw Error("development_source_key_missing");
    const shared =
      /^research:ncaaf:(history-summary|conference-availability-v2|live-inputs):/.test(
        key,
      );
    if (shared && cache.has(key)) return cache.get(key);
    const row = (
      await db.query("SELECT key,value FROM public.app_kv WHERE key=$1", [key])
    ).rows[0];
    if (shared) cache.set(key, row);
    return row;
  };
  for (const row of rows) {
    if (!row.label) {
      pending++;
      continue;
    }
    try {
      await verifyContextSources(row.value, read);
      const example = authenticateDevelopmentExample(
        row.key,
        row.value,
        row.label,
        await read(row.label.settlementKey),
        await read(row.value.historySourceEvidence?.key),
        now,
      );
      const id = `${example.season}:${example.eventId}`;
      if (seen.has(id)) throw Error("development_duplicate_game");
      seen.add(id);
      examples.push(example);
    } catch (e) {
      const reason = /^(development|context|repair|history)_[a-z_]+$/.test(
        e?.message ?? "",
      )
        ? e.message
        : "development_invalid_evidence";
      errors[reason] = (errors[reason] ?? 0) + 1;
    }
  }
  const manifest = {
    version: 1,
    featureVersion: "ncaaf-participation-availability-v2",
    datasetRole: "development_only",
    examples,
    researchOnly: true,
    holdoutEligible: false,
    independentSourceReviewRequired: true,
    releaseEligible: false,
  };
  const manifestSha256 = hash(manifest);
  if (examples.length)
    await db.query(
      "INSERT INTO public.app_kv(key,value) VALUES($1,$2::jsonb) ON CONFLICT(key) DO NOTHING",
      [
        `research:ncaaf:development-manifest:${manifestSha256}`,
        JSON.stringify(manifest),
      ],
    );
  const result = {
    version: 1,
    state: examples.length
      ? "development_examples_prepared"
      : "waiting_for_verified_development_finals",
    checkedAt: now,
    inputRecords: rows.length,
    pendingFinals: pending,
    authenticatedDevelopmentGames: examples.length,
    featureCompleteGames: examples.filter((x) => x.featureComplete).length,
    rejectedRecords: Object.values(errors).reduce((a, b) => a + b, 0),
    blockers: errors,
    manifestSha256: examples.length ? manifestSha256 : null,
    modelFit: "not_run_no_registered_adjusted_trainer",
    holdoutEligible: false,
    releaseEligible: false,
    coachEnabled: false,
  };
  await db.query(
    "INSERT INTO public.app_kv(key,value) VALUES($1,$2::jsonb) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=now()",
    ["research:ncaaf:development-dataset:latest", JSON.stringify(result)],
  );
  return result;
}
async function main() {
  if (!process.argv.includes("--execute")) {
    console.log(
      JSON.stringify({
        planOnly: true,
        providerRequests: 0,
        modelFit: false,
        releaseEligible: false,
      }),
    );
    return;
  }
  if (!process.env.DATABASE_URL) throw Error("development_database_missing");
  const { Client } = createRequire(
    resolve(
      process.env.NCAAF_REPO_ROOT ?? "/opt/render/project/src",
      "lib/db/package.json",
    ),
  )("pg");
  const db = new Client({
    connectionString: process.env.DATABASE_URL,
    connectionTimeoutMillis: 10000,
    query_timeout: 15000,
  });
  await db.connect();
  try {
    console.log(JSON.stringify(await prepareDevelopmentDataset(db)));
  } finally {
    await db.end();
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  main().catch(() => {
    console.error("NCAAF development preparation failed; model unchanged.");
    process.exitCode = 1;
  });

/** Server-only, immutable research fit/journal. Never registers a Coach model. */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import type { ResearchDb } from "./ncaafValidationPipeline.js";
import {
  ADJUSTED_MODEL_VERSION,
  MIN_ADJUSTED_DEVELOPMENT_GAMES,
  adjustedHash,
  contextScoreFeatures,
  fitAdjustedModel,
  validateAdjustedModel,
  validateAdjustedEvidence,
  type AdjustedModel,
  type AdjustedTrainingGame,
} from "./ncaafAdjustedModel.js";
import { freezeModelProtocol } from "./ncaafModelProtocol.js";
import {
  overtimeSupportFromArchive,
  verifyOvertimeSupportArchive,
  canonicalEvidenceJson,
} from "./ncaafOvertimeTransfer.js";
import { forecastInputFromArchive } from "./ncaafLiveInputAdapter.js";
import { prepareForwardForecast } from "./ncaafForecastJournal.js";
const POINTER = "research:ncaaf:context-model:first:v1";
const SOURCE_FILES = [
  "artifacts/api-server/src/lib/ncaafAdjustedModel.ts",
  "artifacts/api-server/src/lib/ncaafAdjustedModelStore.ts",
  "artifacts/api-server/src/lib/ncaafForecastJournal.ts",
  "artifacts/api-server/src/lib/ncaafOpponentResearch.ts",
  "artifacts/api-server/src/lib/ncaafFullGameBacktest.ts",
  "artifacts/api-server/src/lib/ncaafModelProtocol.ts",
  "artifacts/api-server/src/lib/ncaafOvertimeTransfer.ts",
  "artifacts/api-server/src/lib/sportSim/ncaafCandidate.ts",
  "artifacts/api-server/src/lib/sportSim/ncaafFullGameCandidate.ts",
  "scripts/ncaaf-context-dataset.mjs",
  "scripts/ncaaf-prepare-development.mjs",
];
async function implementationHash(root: string) {
  const h = createHash("sha256");
  for (const path of SOURCE_FILES) {
    h.update(path + "\0");
    h.update(await readFile(resolve(root, path)));
  }
  return h.digest("hex");
}
function operations(db: ResearchDb) {
  const row = async (key: string) =>
    (await db.query("SELECT key,value FROM public.app_kv WHERE key=$1", [key]))
      .rows[0];
  const clock = async () =>
    new Date(
      (await db.query("SELECT clock_timestamp() AS now")).rows[0].now,
    ).toISOString();
  const put = async (key: string, value: unknown) => {
    await db.query(
      "INSERT INTO public.app_kv(key,value) VALUES($1,$2::jsonb) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=now()",
      [key, JSON.stringify(value)],
    );
  };
  return { row, clock, put };
}
async function sourceHelpers(root: string) {
  return import(
    pathToFileURL(resolve(root, "scripts/ncaaf-prepare-development.mjs")).href
  );
}
async function guard(db: ResearchDb) {
  if (
    (await db.query("SELECT current_database() AS name")).rows[0].name !==
    "stadium_edge_production"
  )
    throw Error("adjusted_unexpected_database");
}
export async function loadFrozenAdjustedModel(db: ResearchDb) {
  const { row } = operations(db),
    pointer = (await row(POINTER))?.value;
  if (!pointer) return null;
  if (
    pointer.state !== "frozen_research_candidate" ||
    pointer.modelKey !==
      `research:ncaaf:context-model:artifact:${pointer.modelSha256}`
  )
    throw Error("adjusted_invalid_registry_pointer");
  const artifact = (await row(pointer.modelKey))?.value as AdjustedModel;
  validateAdjustedModel(artifact, pointer.modelSha256);
  const sealed = freezeModelProtocol(
    pointer.protocol,
    pointer.protocolRecordedAt,
  );
  if (
    sealed.protocolSha256 !== pointer.protocolSha256 ||
    pointer.protocol.modelSha256 !== pointer.modelSha256 ||
    pointer.protocol.frozenAt !== artifact.frozenAt ||
    pointer.protocol.implementationCommit !== artifact.implementationCommit ||
    canonicalEvidenceJson(pointer.protocol.trainingGameIds) !==
      canonicalEvidenceJson(artifact.excludedGameIds) ||
    !Number.isFinite(Date.parse(pointer.registeredAt)) ||
    Date.parse(pointer.registeredAt) < Date.parse(artifact.frozenAt)
  )
    throw Error("adjusted_protocol_registry_mismatch");
  return { pointer, artifact };
}
export async function fitAndFreezeContextModel(db: ResearchDb, root: string) {
  await guard(db);
  const { row, clock, put } = operations(db);
  if (
    !(await db.query("SELECT pg_try_advisory_lock(64233,20261105) AS acquired"))
      .rows[0].acquired
  )
    return { state: "skipped_overlap", releaseEligible: false };
  try {
    const existing = await loadFrozenAdjustedModel(db);
    if (existing) {
      const result = {
        state: "frozen_candidate_preserved",
        modelSha256: existing.pointer.modelSha256,
        trainingGames: existing.artifact.trainingGameIds.length,
        checkedAt: await clock(),
        researchOnly: true,
        releaseEligible: false,
      };
      await put("research:ncaaf:adjusted-model:latest", result);
      return result;
    }
    const status = (await row("research:ncaaf:development-dataset:latest"))
      ?.value;
    const wait = async (
      state: string,
      reasons: string[],
      extra: object = {},
    ) => {
      const result = {
        state,
        reasons,
        ...extra,
        minimumDevelopmentGames: MIN_ADJUSTED_DEVELOPMENT_GAMES,
        checkedAt: await clock(),
        trainerVersion: ADJUSTED_MODEL_VERSION,
        researchOnly: true,
        releaseEligible: false,
      };
      await put("research:ncaaf:adjusted-model:latest", result);
      return result;
    };
    if (!status?.manifestSha256)
      return wait(
        "waiting_for_verified_development_finals",
        ["no_authenticated_development_manifest"],
        { trainingGames: 0 },
      );
    const manifest = (
      await row(`research:ncaaf:development-manifest:${status.manifestSha256}`)
    )?.value;
    if (
      !manifest ||
      adjustedHash(manifest) !== status.manifestSha256 ||
      manifest.datasetRole !== "development_only" ||
      !Array.isArray(manifest.examples) ||
      manifest.examples.length > 1024
    )
      throw Error("adjusted_invalid_development_manifest");
    if (
      manifest.examples.filter((x: any) => x.featureComplete).length <
      MIN_ADJUSTED_DEVELOPMENT_GAMES
    )
      return wait(
        "waiting_for_more_development_games",
        ["development_cohort_too_small"],
        {
          trainingGames: manifest.examples.filter((x: any) => x.featureComplete)
            .length,
        },
      );
    const helpers = await sourceHelpers(root),
      games: AdjustedTrainingGame[] = [],
      errors: Record<string, number> = {};
    const read = async (key: string) => {
      if (typeof key !== "string" || !key.startsWith("research:ncaaf:"))
        throw Error("adjusted_invalid_source_key");
      return row(key);
    };
    for (const example of manifest.examples) {
      if (!example.featureComplete) continue;
      try {
        const input = (await read(example.inputKey))?.value,
          label = (
            await read(
              example.inputKey.replace("context-input:", "context-outcome:"),
            )
          )?.value;
        if (
          adjustedHash(input) !== example.inputSha256 ||
          adjustedHash(label) !== example.labelSha256
        )
          throw Error("adjusted_manifest_input_changed");
        const history = await read(example.historyKey),
          settlement = await read(example.settlementKey),
          now = await clock();
        await helpers.verifyContextSources(input, read);
        const authenticated = helpers.authenticateDevelopmentExample(
          example.inputKey,
          input,
          label,
          settlement,
          history,
          now,
        );
        if (
          !authenticated.featureComplete ||
          input.datasetRole !== "development_only"
        )
          throw Error("adjusted_incomplete_training_features");
        const o = label.outcome;
        if (typeof o.overtime !== "boolean")
          throw Error("adjusted_unknown_overtime_label");
        games.push({
          id: `${o.season}:${o.eventId}`,
          inputSha256: example.inputSha256,
          labelSha256: example.labelSha256,
          observedAt: label.observedAt,
          features: contextScoreFeatures(input, history.value),
          regulationHome: o.overtime ? o.regulationHomePoints : o.homePoints,
          regulationAway: o.overtime ? o.regulationAwayPoints : o.awayPoints,
        });
      } catch (e) {
        const reason =
          e instanceof Error &&
          /^(adjusted|context|development|repair)_[a-z_]+$/.test(e.message)
            ? e.message
            : "adjusted_training_source_invalid";
        errors[reason] = (errors[reason] ?? 0) + 1;
      }
    }
    const supportRow = (
      await db.query(
        "SELECT key,value FROM public.app_kv WHERE key LIKE 'research:ncaaf:history-summary:2025:%' ORDER BY key DESC LIMIT 1",
      )
    ).rows[0];
    if (!supportRow)
      return wait("waiting_for_overtime_evidence", ["support_archive_missing"]);
    const support = overtimeSupportFromArchive(
        supportRow.key,
        supportRow.value,
      ),
      commit = process.env.RENDER_GIT_COMMIT ?? "";
    const fitted = fitAdjustedModel(games, {
      now: await clock(),
      implementationCommit: commit,
      implementationSha256: await implementationHash(root),
      manifestSha256: status.manifestSha256,
      overtimeSupport: support,
    });
    if (!fitted.model)
      return wait(fitted.state, fitted.reasons, {
        trainingGames: games.length,
        rejected: errors,
      });
    const frozenAt = await clock(),
      model: AdjustedModel = { ...fitted.model, frozenAt },
      modelSha256 = adjustedHash(model);
    const sealed = freezeModelProtocol(
      {
        version: 1,
        modelSha256,
        frozenAt,
        trainingGameIds: model.excludedGameIds,
        featureVersion: "ncaaf-participation-availability-v2",
        implementationCommit: commit,
        simulations: 10000,
        markets: ["ml", "spread", "total"],
        settlement: "full_game_including_overtime",
        minimumIndependentGames: 500,
        minimumSeasons: 2,
      },
      frozenAt,
    );
    const modelKey = `research:ncaaf:context-model:artifact:${modelSha256}`;
    await db.query("BEGIN");
    try {
      await db.query(
        "INSERT INTO public.app_kv(key,value) VALUES($1,$2::jsonb) ON CONFLICT(key) DO NOTHING",
        [modelKey, JSON.stringify(model)],
      );
      await db.query(
        "INSERT INTO public.app_kv(key,value) VALUES($1,$2::jsonb || jsonb_build_object('registeredAt',clock_timestamp())) ON CONFLICT(key) DO NOTHING",
        [
          POINTER,
          JSON.stringify({
            state: "frozen_research_candidate",
            modelKey,
            modelSha256,
            protocol: sealed.protocol,
            protocolSha256: sealed.protocolSha256,
            protocolRecordedAt: sealed.recordedAt,
            researchOnly: true,
            releaseEligible: false,
          }),
        ],
      );
      await db.query("COMMIT");
    } catch (e) {
      await db.query("ROLLBACK");
      throw e;
    }
    return wait(
      "frozen_research_candidate",
      ["independent_validation_and_review_required"],
      { modelSha256, trainingGames: games.length, rejected: errors },
    );
  } finally {
    await db.query("SELECT pg_advisory_unlock(64233,20261105)");
  }
}
export async function persistAdjustedForecast(
  db: ResearchDb,
  forecast: ReturnType<typeof prepareForwardForecast>,
) {
  const e = forecast.input.adjustedEvidence,
    t = forecast.target;
  if (
    !e ||
    forecast.modelVersion !== `${ADJUSTED_MODEL_VERSION}:${e.modelSha256}` ||
    forecast.datasetRole !== "independent_holdout" ||
    adjustedHash(forecast.input) !== forecast.inputSha256
  )
    throw Error("adjusted_invalid_forecast_write");
  validateAdjustedEvidence(e, t, forecast.forecastAt);
  const key = `research:ncaaf:forecast:${forecast.modelVersion}:${t.season}:${t.eventId}`;
  const saved = await db.query(
    "INSERT INTO public.app_kv(key,value) SELECT $1,$2::jsonb || jsonb_build_object('recordedAt',clock_timestamp()) WHERE clock_timestamp()<$3::timestamptz ON CONFLICT(key) DO NOTHING RETURNING key",
    [key, JSON.stringify(forecast), t.kickoff],
  );
  if (saved.rowCount) return "recorded";
  if (
    (await db.query("SELECT value FROM public.app_kv WHERE key=$1", [key]))
      .rows[0]?.value
  )
    return "existing";
  throw Error("adjusted_kickoff_crossed_before_write");
}
export async function recordAdjustedContextForecasts(
  db: ResearchDb,
  root: string,
) {
  await guard(db);
  const { row, clock, put } = operations(db);
  if (
    !(await db.query("SELECT pg_try_advisory_lock(64233,20261106) AS acquired"))
      .rows[0].acquired
  )
    return { state: "skipped_overlap", releaseEligible: false };
  try {
    const frozen = await loadFrozenAdjustedModel(db);
    if (!frozen) {
      const result = {
        state: "waiting_for_frozen_model",
        checkedAt: await clock(),
        recorded: 0,
        releaseEligible: false,
      };
      await put("research:ncaaf:adjusted-journal:latest", result);
      return result;
    }
    const { artifact: model, pointer } = frozen;
    if ((await implementationHash(root)) !== model.implementationSha256)
      throw Error("adjusted_implementation_changed_requires_review");
    const support = (await row(model.overtimeSupport.sourceKey))?.value;
    verifyOvertimeSupportArchive(model.overtimeSupport, support);
    const live = (
      await db.query(
        "SELECT key,value FROM public.app_kv WHERE key LIKE 'research:ncaaf:live-inputs:%' ORDER BY key DESC LIMIT 1",
      )
    ).rows[0];
    const injury = (
      await db.query(
        "SELECT key,value FROM public.app_kv WHERE key LIKE 'research:ncaaf:injuries:%' ORDER BY key DESC LIMIT 1",
      )
    ).rows[0];
    if (!live || !injury) {
      const result = {
        state: "waiting_for_current_inputs",
        checkedAt: await clock(),
        recorded: 0,
        releaseEligible: false,
      };
      await put("research:ncaaf:adjusted-journal:latest", result);
      return result;
    }
    const contexts = (
      await db.query(
        "SELECT key,value FROM public.app_kv WHERE key LIKE 'research:ncaaf:context-input:v2:%' AND value->>'datasetRole'='holdout_context' AND (value->'target'->>'kickoff')::timestamptz>clock_timestamp() ORDER BY value->'target'->>'kickoff',key LIMIT 128",
      )
    ).rows;
    const helpers = await sourceHelpers(root);
    let recorded = 0,
      existing = 0;
    const withheld: Record<string, number> = {};
    for (const r of contexts) {
      try {
        const context = r.value,
          t = context.target,
          modelVersion = `${ADJUSTED_MODEL_VERSION}:${pointer.modelSha256}`,
          key = `research:ncaaf:forecast:${modelVersion}:${t.season}:${t.eventId}`;
        if ((await row(key))?.value) {
          existing++;
          continue;
        }
        const now = await clock();
        if (
          Date.parse(context.recordedAt) < Date.parse(pointer.registeredAt) ||
          Date.parse(injury.value.observedAt) > Date.parse(now) ||
          Date.parse(now) - Date.parse(injury.value.observedAt) > 6 * 3600000
        )
          throw Error("adjusted_stale_or_prefreeze_context");
        await helpers.verifyContextSources(context, row);
        const history = (await row(context.historySourceEvidence.key))?.value;
        const input = forecastInputFromArchive(
          live.value,
          t.eventId,
          history.games,
          {
            key: injury.key,
            observedAt: injury.value.observedAt,
            sha256: injury.value.sha256,
            rawResponse: injury.value.rawResponse,
            absentTeamStatus: "unknown",
          },
          `ncaa-football-season-${t.season}-unverified`,
          now,
        );
        Object.assign(input, {
          overtimeSupport: model.overtimeSupport,
          liveSourceEvidence: {
            key: live.key,
            sha256: createHash("sha256")
              .update(JSON.stringify(live.value))
              .digest("hex"),
          },
          adjustedEvidence: {
            model,
            modelSha256: pointer.modelSha256,
            protocol: pointer.protocol,
            protocolSha256: pointer.protocolSha256,
            protocolRecordedAt: pointer.protocolRecordedAt,
            context,
            historyArchive: history,
          },
        });
        const forecast = prepareForwardForecast(input, now);
        if ((await persistAdjustedForecast(db, forecast)) === "recorded")
          recorded++;
        else existing++;
      } catch (e) {
        const reason =
          e instanceof Error &&
          /^(adjusted|journal|protocol|context|development|repair)_[a-z_]+$/.test(
            e.message,
          )
            ? e.message
            : "adjusted_forecast_withheld";
        withheld[reason] = (withheld[reason] ?? 0) + 1;
      }
    }
    const result = {
      state: "processed",
      checkedAt: await clock(),
      modelSha256: pointer.modelSha256,
      recorded,
      existing,
      withheld,
      researchOnly: true,
      releaseEligible: false,
    };
    await put("research:ncaaf:adjusted-journal:latest", result);
    return result;
  } finally {
    await db.query("SELECT pg_advisory_unlock(64233,20261106)");
  }
}

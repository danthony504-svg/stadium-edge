/**
 * NCAAB research freeze coordinator + fit.
 * Never freezes product sim ncaab-score-v2, never enables Coach,
 * never rewrites NCAAF keys or football frozen artifacts.
 */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import type { ResearchDb } from "./ncaafValidationPipeline.js";
import {
  NCAAB_ADJUSTED_MODEL_VERSION,
  NCAAB_MIN_ADJUSTED_DEVELOPMENT_GAMES,
  fitNcaabAdjustedModel,
  ncaabAdjustedHash,
  validateNcaabAdjustedModel,
  type NcaabAdjustedTrainingGame,
} from "./ncaabAdjustedModel.js";

export {
  NCAAB_MIN_ADJUSTED_DEVELOPMENT_GAMES,
  NCAAB_ADJUSTED_MODEL_VERSION as NCAAB_RESEARCH_TRAINER_VERSION,
};
export const NCAAB_PRODUCT_SIM_ID = "ncaab-score-v2";

const POINTER = "research:ncaab:context-model:first:v1";
const LATEST = "research:ncaab:adjusted-model:latest";

/** NCAAB-only implementation fingerprint — never include NCAAF SOURCE_FILES. */
export const NCAAB_SOURCE_FILES = [
  "artifacts/api-server/src/lib/ncaabAdjustedModel.ts",
  "artifacts/api-server/src/lib/ncaabAdjustedModelStore.ts",
  "artifacts/api-server/src/lib/ncaabForecastSettlement.ts",
  "artifacts/api-server/src/lib/ncaabForecastJournal.ts",
  "scripts/ncaab-prepare-development.mjs",
  "scripts/ncaab-bind-final-summary.mjs",
  "scripts/ncaab-capture-live-inputs.mjs",
];

async function implementationHash(root: string) {
  const h = createHash("sha256");
  for (const path of NCAAB_SOURCE_FILES) {
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

async function guard(db: ResearchDb) {
  if (
    (await db.query("SELECT current_database() AS name")).rows[0].name !==
    "stadium_edge_production"
  )
    throw Error("ncaab_adjusted_unexpected_database");
}

/** Reject any attempt to treat the product sim as a research freeze. */
export function assertNotProductSimFreeze(candidate: {
  modelSha256?: unknown;
  trainerVersion?: unknown;
  engineId?: unknown;
  modelVersion?: unknown;
}) {
  const tokens = [
    candidate.modelSha256,
    candidate.trainerVersion,
    candidate.engineId,
    candidate.modelVersion,
  ]
    .filter((v) => typeof v === "string")
    .map((v) => String(v).toLowerCase());
  if (
    tokens.some(
      (t) =>
        t === NCAAB_PRODUCT_SIM_ID ||
        t.includes("ncaab-score-v2") ||
        t.includes("product-sim"),
    )
  )
    throw Error("ncaab_product_sim_cannot_freeze_research_candidate");
}

export async function loadFrozenNcaabAdjustedModel(db: ResearchDb) {
  const { row } = operations(db);
  const pointer = (await row(POINTER))?.value;
  if (!pointer) return null;
  assertNotProductSimFreeze(pointer);
  if (
    pointer.state !== "frozen_research_candidate" ||
    typeof pointer.modelSha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(pointer.modelSha256) ||
    pointer.modelKey !==
      `research:ncaab:context-model:artifact:${pointer.modelSha256}` ||
    pointer.researchOnly !== true ||
    pointer.releaseEligible === true ||
    pointer.coachEnabled === true
  )
    throw Error("ncaab_adjusted_invalid_registry_pointer");
  const artifact = (await row(pointer.modelKey))?.value;
  if (!artifact) throw Error("ncaab_adjusted_missing_artifact");
  assertNotProductSimFreeze(artifact);
  validateNcaabAdjustedModel(artifact, pointer.modelSha256);
  return { pointer, artifact };
}

/**
 * Fit and freeze an NCAAB research candidate when development evidence passes.
 * Waiting states never write modelSha256 / artifact / first pointer.
 */
export async function attemptNcaabResearchFreeze(
  db: ResearchDb,
  root = resolve(process.cwd(), "../.."),
) {
  await guard(db);
  const { row, clock, put } = operations(db);
  if (
    !(await db.query("SELECT pg_try_advisory_lock(64234,20261030) AS acquired"))
      .rows[0].acquired
  )
    return { state: "skipped_overlap", releaseEligible: false, coachEnabled: false };

  try {
    const existing = await loadFrozenNcaabAdjustedModel(db);
    if (existing) {
      const result = {
        state: "frozen_candidate_preserved",
        modelSha256: existing.pointer.modelSha256,
        trainingGames: existing.artifact.trainingGameIds.length,
        checkedAt: await clock(),
        researchOnly: true,
        releaseEligible: false,
        coachEnabled: false,
        validationReady: false,
      };
      await put(LATEST, result);
      return result;
    }

    const wait = async (
      state: string,
      reasons: string[],
      extra: Record<string, unknown> = {},
    ) => {
      const result = {
        state,
        reasons,
        ...extra,
        minimumDevelopmentGames: NCAAB_MIN_ADJUSTED_DEVELOPMENT_GAMES,
        checkedAt: await clock(),
        trainerVersion: NCAAB_ADJUSTED_MODEL_VERSION,
        productSimRejectedAsFreezeSource: NCAAB_PRODUCT_SIM_ID,
        researchOnly: true,
        releaseEligible: false,
        coachEnabled: false,
        validationReady: false,
        // Must remain last so extras cannot inject a fake hash.
        modelSha256: null,
      };
      await put(LATEST, result);
      // Waiting paths must not create freeze artifacts.
      return result;
    };

    const status = (await row("research:ncaab:development-dataset:latest"))
      ?.value;
    if (!status?.manifestSha256) {
      return wait("waiting_for_verified_development_finals", [
        "no_authenticated_development_manifest",
      ], { trainingGames: 0 });
    }

    const manifest = (
      await row(`research:ncaab:development-manifest:${status.manifestSha256}`)
    )?.value;
    if (
      !manifest ||
      manifest.datasetRole !== "development_only" ||
      !Array.isArray(manifest.examples) ||
      manifest.examples.length > 1024 ||
      ncaabAdjustedHash(manifest) !== status.manifestSha256
    )
      throw Error("ncaab_adjusted_invalid_development_manifest");

    const completeExamples = manifest.examples.filter(
      (x: { featureComplete?: boolean }) => x.featureComplete === true,
    );
    if (completeExamples.length < NCAAB_MIN_ADJUSTED_DEVELOPMENT_GAMES) {
      return wait("waiting_for_more_development_games", [
        "feature_complete_development_below_minimum",
      ], { trainingGames: completeExamples.length });
    }

    const training: NcaabAdjustedTrainingGame[] = [];
    for (const ex of completeExamples) {
      const input = (await row(ex.inputKey))?.value;
      const label = (await row(ex.labelKey))?.value;
      if (!input?.features?.home?.values || !label?.outcome) continue;
      training.push({
        id: `${ex.season}:${ex.eventId}`,
        inputSha256: ex.inputSha256,
        labelSha256: ncaabAdjustedHash(label),
        observedAt: label.observedAt,
        regulationHome: label.outcome.regulationHomePoints,
        regulationAway: label.outcome.regulationAwayPoints,
        features: input.features,
      });
    }
    if (training.length < NCAAB_MIN_ADJUSTED_DEVELOPMENT_GAMES) {
      return wait("waiting_for_more_development_games", [
        "reauthenticated_feature_complete_below_minimum",
      ], { trainingGames: training.length });
    }

    const implSha = await implementationHash(root);
    const commit =
      process.env.RENDER_GIT_COMMIT?.trim() ||
      process.env.GIT_COMMIT?.trim() ||
      "";
    if (!/^[a-f0-9]{40}$/.test(commit)) {
      return wait("waiting_for_implementation_commit", [
        "missing_40_hex_implementation_commit",
      ], { trainingGames: training.length });
    }

    const fitted = fitNcaabAdjustedModel(training, {
      now: await clock(),
      implementationCommit: commit,
      implementationSha256: implSha,
      manifestSha256: status.manifestSha256,
    });
    if (!fitted.model || !fitted.modelSha256) {
      return wait(fitted.state, fitted.reasons, {
        trainingGames: training.length,
      });
    }
    assertNotProductSimFreeze(fitted.model);
    validateNcaabAdjustedModel(fitted.model, fitted.modelSha256);

    const modelKey = `research:ncaab:context-model:artifact:${fitted.modelSha256}`;
    await db.query(
      "INSERT INTO public.app_kv(key,value) VALUES($1,$2::jsonb) ON CONFLICT(key) DO NOTHING",
      [modelKey, JSON.stringify(fitted.model)],
    );
    const registeredAt = await clock();
    const pointer = {
      state: "frozen_research_candidate",
      sport: "ncaab",
      modelSha256: fitted.modelSha256,
      modelKey,
      trainerVersion: NCAAB_ADJUSTED_MODEL_VERSION,
      frozenAt: fitted.model.frozenAt,
      registeredAt,
      researchOnly: true,
      releaseEligible: false,
      coachEnabled: false,
      validationReady: false,
    };
    assertNotProductSimFreeze(pointer);
    const written = await db.query(
      "INSERT INTO public.app_kv(key,value) VALUES($1,$2::jsonb) ON CONFLICT(key) DO NOTHING RETURNING key",
      [POINTER, JSON.stringify(pointer)],
    );
    if (!written.rowCount) {
      const preserved = await loadFrozenNcaabAdjustedModel(db);
      const result = {
        state: "frozen_candidate_preserved",
        modelSha256: preserved!.pointer.modelSha256,
        trainingGames: preserved!.artifact.trainingGameIds.length,
        checkedAt: await clock(),
        researchOnly: true,
        releaseEligible: false,
        coachEnabled: false,
        validationReady: false,
      };
      await put(LATEST, result);
      return result;
    }

    const result = {
      state: "frozen_research_candidate",
      modelSha256: fitted.modelSha256,
      trainingGames: fitted.model.trainingGameIds.length,
      checkedAt: await clock(),
      researchOnly: true,
      releaseEligible: false,
      coachEnabled: false,
      validationReady: false,
    };
    await put(LATEST, result);
    return result;
  } finally {
    await db.query("SELECT pg_advisory_unlock(64234,20261030)");
  }
}

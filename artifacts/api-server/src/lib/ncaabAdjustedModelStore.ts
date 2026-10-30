/**
 * NCAAB research freeze coordinator.
 * Records honest waiting states only until an authenticated development
 * manifest and basketball research trainer exist. Never freezes product
 * sim `ncaab-score-v2`, never invents coefficients, never enables Coach.
 */
import type { ResearchDb } from "./ncaafValidationPipeline.js";

export const NCAAB_MIN_ADJUSTED_DEVELOPMENT_GAMES = 23;
export const NCAAB_RESEARCH_TRAINER_VERSION =
  "ncaab-context-ridge-research-v1-not-implemented";
export const NCAAB_PRODUCT_SIM_ID = "ncaab-score-v2";
const POINTER = "research:ncaab:context-model:first:v1";
const LATEST = "research:ncaab:adjusted-model:latest";

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

/**
 * Attempt to preserve or prepare an NCAAB research freeze.
 * This revision never writes a new modelSha256 — the basketball trainer is
 * not implemented yet. Status always stays research-only / release-ineligible.
 */
export async function attemptNcaabResearchFreeze(db: ResearchDb) {
  await guard(db);
  const { row, clock, put } = operations(db);
  if (
    !(await db.query("SELECT pg_try_advisory_lock(64234,20261030) AS acquired"))
      .rows[0].acquired
  )
    return { state: "skipped_overlap", releaseEligible: false, coachEnabled: false };

  try {
    const pointer = (await row(POINTER))?.value;
    if (pointer) {
      assertNotProductSimFreeze(pointer);
      if (
        pointer.state !== "frozen_research_candidate" ||
        typeof pointer.modelSha256 !== "string" ||
        !/^[a-f0-9]{64}$/.test(pointer.modelSha256) ||
        pointer.modelKey !==
          `research:ncaab:context-model:artifact:${pointer.modelSha256}` ||
        pointer.researchOnly !== true ||
        pointer.releaseEligible === true
      )
        throw Error("ncaab_adjusted_invalid_registry_pointer");
      const artifact = (await row(pointer.modelKey))?.value;
      if (!artifact) throw Error("ncaab_adjusted_missing_artifact");
      assertNotProductSimFreeze(artifact);
      const result = {
        state: "frozen_candidate_preserved",
        modelSha256: pointer.modelSha256,
        trainingGames: Array.isArray(artifact.trainingGameIds)
          ? artifact.trainingGameIds.length
          : 0,
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
        trainerVersion: NCAAB_RESEARCH_TRAINER_VERSION,
        productSimRejectedAsFreezeSource: NCAAB_PRODUCT_SIM_ID,
        researchOnly: true,
        releaseEligible: false,
        coachEnabled: false,
        validationReady: false,
        // Explicit: no modelSha256 until a real trainer freezes an artifact.
        modelSha256: null,
      };
      await put(LATEST, result);
      return result;
    };

    const status = (await row("research:ncaab:development-dataset:latest"))
      ?.value;
    if (!status?.manifestSha256) {
      return wait("waiting_for_verified_development_finals", [
        "no_authenticated_development_manifest",
        "ncaab_context_prepare_pipeline_not_built",
      ], { trainingGames: 0 });
    }

    const manifest = (
      await row(`research:ncaab:development-manifest:${status.manifestSha256}`)
    )?.value;
    if (
      !manifest ||
      manifest.datasetRole !== "development_only" ||
      !Array.isArray(manifest.examples) ||
      manifest.examples.length > 1024
    )
      throw Error("ncaab_adjusted_invalid_development_manifest");

    const complete = manifest.examples.filter(
      (x: { featureComplete?: boolean }) => x.featureComplete === true,
    ).length;
    if (complete < NCAAB_MIN_ADJUSTED_DEVELOPMENT_GAMES) {
      return wait("waiting_for_more_development_games", [
        "feature_complete_development_below_minimum",
      ], { trainingGames: complete });
    }

    // Authenticated development volume exists, but the basketball research
    // trainer / coefficient fit is intentionally not implemented yet.
    return wait("waiting_for_ncaab_research_trainer", [
      "basketball_adjusted_trainer_not_implemented",
      "refusing_to_freeze_product_sim_ncaab_score_v2",
    ], { trainingGames: complete });
  } finally {
    await db.query("SELECT pg_advisory_unlock(64234,20261030)");
  }
}

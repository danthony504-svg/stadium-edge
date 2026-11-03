/**
 * Prospective NCAAB research forecasts from a frozen odds-ridge candidate.
 * Writes only before kickoff for games excluded from training.
 * Never enables Coach / releaseEligible.
 */
import type { ResearchDb } from "./ncaafValidationPipeline.js";
import {
  NCAAB_ADJUSTED_MODEL_VERSION,
  contextScoreFeaturesFromPrimary,
  ncaabConditionalWinProbability,
  predictNcaabAdjustedMeans,
  selectPrimaryNcaabQuotes,
  type NcaabAdjustedModel,
} from "./ncaabAdjustedModel.js";
import { loadFrozenNcaabAdjustedModel } from "./ncaabAdjustedModelStore.js";

const JOURNAL = "research:ncaab:adjusted-journal:latest";

function operations(db: ResearchDb) {
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
  return { clock, put };
}

type JournalCandidate = {
  matched: any;
  archive: { key: string; value: any };
  capturedAt: string;
  primary: ReturnType<typeof selectPrimaryNcaabQuotes>;
  features: ReturnType<typeof contextScoreFeaturesFromPrimary>["features"];
  means: { home: number; away: number };
};

export async function recordNcaabAdjustedForecasts(db: ResearchDb) {
  const { clock, put } = operations(db);
  if (
    (await db.query("SELECT current_database() AS name")).rows[0].name !==
    "stadium_edge_production"
  )
    throw Error("ncaab_journal_unexpected_database");

  const frozen = await loadFrozenNcaabAdjustedModel(db);
  if (!frozen) {
    const result = {
      state: "waiting_for_frozen_ncaab_candidate",
      recorded: 0,
      existing: 0,
      withheld: 0,
      researchOnly: true,
      releaseEligible: false,
      coachEnabled: false,
      checkedAt: await clock(),
    };
    await put(JOURNAL, result);
    return result;
  }

  const model = frozen.artifact as NcaabAdjustedModel;
  const modelSha = frozen.pointer.modelSha256 as string;
  // Permanently exclude training games and any later development-only examples.
  const excluded = new Set([
    ...(model.excludedGameIds ?? []),
    ...(model.trainingGameIds ?? []),
  ]);
  const developmentRows = (
    await db.query(
      "SELECT (value->'target'->>'season')||':'||(value->'target'->>'eventId') AS id FROM public.app_kv WHERE key LIKE 'research:ncaab:context-input:v1:%' AND value->>'datasetRole'='development_only'",
    )
  ).rows;
  for (const row of developmentRows) if (row.id) excluded.add(row.id);

  const now = await clock();
  const nowMs = Date.parse(now);

  const archives = (
    await db.query(
      "SELECT key,value FROM public.app_kv WHERE key LIKE 'research:ncaab:live-inputs:%' ORDER BY key DESC LIMIT 8",
    )
  ).rows;

  // Collect earliest valid pre-kickoff capture per game across all archives.
  // Incomplete newer snapshots must not block older complete ones.
  const candidates = new Map<string, JournalCandidate>();
  let withheld = 0;

  for (const archive of archives) {
    for (const matched of archive.value?.matched ?? []) {
      const t = matched.target;
      if (!t?.eventId || !Number.isSafeInteger(t.season)) continue;
      const id = `${t.season}:${t.eventId}`;
      if (excluded.has(id)) continue;

      const kickoffMs = Date.parse(t.kickoff);
      if (!Number.isFinite(kickoffMs) || kickoffMs <= nowMs) {
        withheld++;
        continue;
      }
      const capturedAt =
        archive.value.odds?.receivedAt ?? archive.value.observedAt;
      if (
        !Number.isFinite(Date.parse(capturedAt)) ||
        Date.parse(capturedAt) >= kickoffMs
      ) {
        withheld++;
        continue;
      }

      const primary = selectPrimaryNcaabQuotes(
        matched.quotes ?? [],
        matched.homeTeam,
        matched.awayTeam,
      );
      const venue =
        typeof t.neutralSite === "boolean"
          ? { neutralSite: t.neutralSite }
          : { neutralSite: null };
      const { missing, features } = contextScoreFeaturesFromPrimary(
        primary,
        venue,
      );
      if (missing.length || !features.home.values.length) {
        withheld++;
        continue;
      }

      let means: { home: number; away: number };
      try {
        means = predictNcaabAdjustedMeans(model, modelSha, features);
      } catch {
        withheld++;
        continue;
      }

      const prev = candidates.get(id);
      if (!prev || Date.parse(capturedAt) < Date.parse(prev.capturedAt)) {
        candidates.set(id, {
          matched,
          archive,
          capturedAt,
          primary,
          features,
          means,
        });
      }
    }
  }

  let recorded = 0;
  let existing = 0;

  for (const candidate of candidates.values()) {
    const t = candidate.matched.target;
    const kickoffMs = Date.parse(t.kickoff);
    const { primary, means, capturedAt, archive } = candidate;

    const markets = (
      [
        primary.ml
          ? {
              bookmaker: primary.ml.bookmaker,
              market: "ml" as const,
              line: null,
              firstPrice: primary.ml.firstPrice,
              secondPrice: primary.ml.secondPrice,
              conditionalWinProbability: ncaabConditionalWinProbability(
                "ml",
                null,
                means.home,
                means.away,
              ),
            }
          : null,
        primary.spread
          ? {
              bookmaker: primary.spread.bookmaker,
              market: "spread" as const,
              line: primary.spread.line,
              firstPrice: primary.spread.firstPrice,
              secondPrice: primary.spread.secondPrice,
              conditionalWinProbability: ncaabConditionalWinProbability(
                "spread",
                primary.spread.line,
                means.home,
                means.away,
              ),
            }
          : null,
        primary.total
          ? {
              bookmaker: primary.total.bookmaker,
              market: "total" as const,
              line: primary.total.line,
              firstPrice: primary.total.firstPrice,
              secondPrice: primary.total.secondPrice,
              conditionalWinProbability: ncaabConditionalWinProbability(
                "total",
                primary.total.line,
                means.home,
                means.away,
              ),
            }
          : null,
      ] as const
    ).filter(Boolean);

    if (!markets.length) {
      withheld++;
      continue;
    }

    const forecastAt = now;
    if (Date.parse(forecastAt) >= kickoffMs) {
      withheld++;
      continue;
    }

    const record = {
      version: 1,
      sport: "ncaab",
      researchOnly: true as const,
      releaseEligible: false,
      coachEnabled: false,
      datasetRole: "independent_holdout",
      modelVersion: `${NCAAB_ADJUSTED_MODEL_VERSION}:${modelSha}`,
      modelSha256: modelSha,
      recordedAt: forecastAt,
      forecastAt,
      inputCutoffAt: capturedAt,
      target: {
        eventId: String(t.eventId),
        season: t.season,
        homeId: String(t.homeId),
        awayId: String(t.awayId),
        kickoff: t.kickoff,
        ruleset: "full_game_including_overtime" as const,
        neutralSite:
          typeof t.neutralSite === "boolean" ? t.neutralSite : null,
      },
      markets,
      homeMean: means.home,
      awayMean: means.away,
      liveArchiveKey: archive.key,
    };

    const key = `research:ncaab:forecast:${NCAAB_ADJUSTED_MODEL_VERSION}:${modelSha.slice(0, 12)}:${t.season}:${t.eventId}`;
    const written = await db.query(
      "INSERT INTO public.app_kv(key,value) VALUES($1,$2::jsonb) ON CONFLICT(key) DO NOTHING RETURNING key",
      [key, JSON.stringify(record)],
    );
    if (written.rowCount) recorded++;
    else existing++;
  }

  const result = {
    state: "processed",
    recorded,
    existing,
    withheld,
    modelSha256: modelSha,
    researchOnly: true,
    releaseEligible: false,
    coachEnabled: false,
    checkedAt: await clock(),
  };
  await put(JOURNAL, result);
  return result;
}

/** Experimental fitted regulation-score adjustments. No production eligibility. */
import { createHash } from "node:crypto";
import {
  canonicalEvidenceJson,
  researchOvertimeSupport,
  type OvertimeSupport,
} from "./ncaafOvertimeTransfer.js";
import {
  readFullGameReplayArchive,
  priorRegulationTeamSample,
  type TimedGame,
} from "./ncaafFullGameBacktest.js";
import { opponentScoreMeans } from "./ncaafOpponentResearch.js";
import {
  assertProspectiveHoldout,
  type ModelProtocol,
} from "./ncaafModelProtocol.js";
export const ADJUSTED_MODEL_VERSION = "ncaaf-context-ridge-research-v1";
export const ADJUSTED_FEATURE_VERSION = "ncaaf-context-score-features-v1";
export const FAMILY_NAMES = [
  "passingAttempts",
  "carries",
  "receptions",
] as const;
const STATUSES = [
  "probable",
  "questionable",
  "doubtful",
  "out",
  "game_time_decision",
  "unknown",
] as const;
export const ADJUSTED_FEATURE_NAMES = [
  "intercept",
  "opponent_score_delta",
  "venue_home_margin",
  ...FAMILY_NAMES.flatMap((f) => STATUSES.map((s) => `${f}:${s}`)),
];
export const MIN_ADJUSTED_DEVELOPMENT_GAMES = ADJUSTED_FEATURE_NAMES.length + 2;
export const adjustedHash = (v: unknown) =>
  createHash("sha256").update(canonicalEvidenceJson(v)).digest("hex");
const time = (v: unknown) => (typeof v === "string" ? Date.parse(v) : NaN);
export type ContextTarget = {
  season: number;
  eventId: string;
  homeId: string;
  awayId: string;
  kickoff: string;
  neutralSite: boolean | null;
};
export type ContextFeatures = {
  featureVersion: string;
  datasetRole: string;
  target: ContextTarget;
  capturedAt: string;
  recordedAt: string;
  availabilityObservedAt: string;
  historySourceEvidence: { sha256: string; priorEventIds: string[] };
  sides: {
    teamId: string;
    features: Record<
      string,
      { coverage: string; games: number; shares: Record<string, number> | null }
    >;
  }[];
};
export type ScoreFeaturePair = {
  home: { baseline: number; values: number[] };
  away: { baseline: number; values: number[] };
  neutralSite: boolean;
  historyGameIds: string[];
};
export function contextScoreFeatures(
  context: ContextFeatures,
  history: { games: TimedGame[] },
  cutoff = context.capturedAt,
): ScoreFeaturePair {
  const t = context?.target,
    clock = time(cutoff);
  if (
    context?.featureVersion !== "ncaaf-participation-availability-v2" ||
    !["development_only", "holdout_context"].includes(context.datasetRole) ||
    !t ||
    !Number.isSafeInteger(t.season) ||
    !/^\d+$/.test(t.eventId) ||
    !/^\d+$/.test(t.homeId) ||
    !/^\d+$/.test(t.awayId) ||
    t.homeId === t.awayId ||
    typeof t.neutralSite !== "boolean" ||
    ![
      cutoff,
      context.capturedAt,
      context.recordedAt,
      context.availabilityObservedAt,
      t.kickoff,
    ].every((v) => Number.isFinite(time(v))) ||
    time(context.availabilityObservedAt) > time(context.capturedAt) ||
    time(context.capturedAt) > time(context.recordedAt) ||
    time(context.recordedAt) >= time(t.kickoff) ||
    time(context.capturedAt) > clock ||
    clock >= time(t.kickoff) ||
    context.sides?.length !== 2 ||
    new Set(context.sides.map((s) => s.teamId)).size !== 2
  )
    throw Error("adjusted_invalid_context_or_venue");
  if (
    adjustedHash(history) !== context.historySourceEvidence?.sha256 ||
    !Array.isArray(context.historySourceEvidence.priorEventIds) ||
    new Set(context.historySourceEvidence.priorEventIds).size !==
      context.historySourceEvidence.priorEventIds.length
  )
    throw Error("adjusted_history_hash_mismatch");
  const allowed = new Set(context.historySourceEvidence.priorEventIds);
  const selected = history.games.filter((g) => allowed.has(g.eventId));
  if (selected.length !== allowed.size)
    throw Error("adjusted_history_ids_missing");
  const games = readFullGameReplayArchive({
    version: 1,
    games: selected,
    forecasts: [],
    quotes: [],
  }).games;
  if (
    games.some(
      (g) =>
        g.season !== t.season ||
        g.eventId === t.eventId ||
        time(g.observedAt) > time(context.capturedAt) ||
        time(g.completedAt) >= time(context.capturedAt),
    )
  )
    throw Error("adjusted_future_or_target_history");
  const stamp = {
    season: t.season,
    eventId: t.eventId,
    forecastAt: context.capturedAt,
    inputCutoffAt: context.capturedAt,
    injurySourceTimestamp: context.availabilityObservedAt,
    ruleset: `ncaa-football-season-${t.season}-unverified`,
  };
  const h = priorRegulationTeamSample(games, t, stamp, t.homeId),
    a = priorRegulationTeamSample(games, t, stamp, t.awayId);
  const opponent = opponentScoreMeans(games, t);
  if (!h || !a || !opponent) throw Error("adjusted_thin_opponent_history");
  const homeBase = (h.ptsFor + a.ptsAgainst) / 2,
    awayBase = (a.ptsFor + h.ptsAgainst) / 2;
  function side(
    id: string,
    baseline: number,
    opponentMean: number,
    venue: number,
  ) {
    const rows = context.sides.filter((s) => s.teamId === id);
    if (rows.length !== 1) throw Error("adjusted_team_identity");
    const values = [1, opponentMean - baseline, venue];
    for (const family of FAMILY_NAMES) {
      const f = rows[0].features[family],
        shares = f?.shares;
      if (
        f?.coverage !== "observed_participation" ||
        !Number.isSafeInteger(f.games) ||
        f.games < 3 ||
        !shares ||
        Object.keys(shares).length !== 7 ||
        !["available", ...STATUSES].every((s) => Object.hasOwn(shares, s)) ||
        Object.values(shares).some(
          (n) => !Number.isFinite(n) || n < 0 || n > 1,
        ) ||
        Math.abs(Object.values(shares).reduce((x, y) => x + y, 0) - 1) > 1e-9
      )
        throw Error("adjusted_unknown_usage_family");
      for (const status of STATUSES) values.push(shares[status]);
    }
    if (
      !Number.isFinite(baseline) ||
      baseline < 0 ||
      baseline > 84 ||
      values.some((v) => !Number.isFinite(v))
    )
      throw Error("adjusted_invalid_features");
    return { baseline, values };
  }
  return {
    home: side(t.homeId, homeBase, opponent.home, t.neutralSite ? 0 : 0.5),
    away: side(t.awayId, awayBase, opponent.away, t.neutralSite ? 0 : -0.5),
    neutralSite: t.neutralSite,
    historyGameIds: games.map((g) => `${g.season}:${g.eventId}`).sort(),
  };
}
export type AdjustedTrainingGame = {
  id: string;
  inputSha256: string;
  labelSha256: string;
  observedAt: string;
  features: ScoreFeaturePair;
  regulationHome: number;
  regulationAway: number;
};
export type AdjustedModel = {
  version: 1;
  trainerVersion: string;
  featureVersion: string;
  featureNames: string[];
  ridge: number;
  frozenAt: string;
  implementationCommit: string;
  implementationSha256: string;
  developmentManifestSha256: string;
  trainingGameIds: string[];
  excludedGameIds: string[];
  centers: number[];
  scales: number[];
  coefficients: number[];
  ranges: { min: number; max: number }[];
  neutralObserved: boolean;
  researchOnly: true;
  productionReady: false;
  validationReady: false;
  overtimeSupport: OvertimeSupport;
  limitations: string[];
};
function solve(a: number[][], b: number[]) {
  const n = b.length,
    m = a.map((row, i) => [...row, b[i]]);
  for (let i = 0; i < n; i++) {
    let p = i;
    for (let j = i + 1; j < n; j++)
      if (Math.abs(m[j][i]) > Math.abs(m[p][i])) p = j;
    if (!Number.isFinite(m[p][i]) || Math.abs(m[p][i]) < 1e-10)
      throw Error("adjusted_singular_fit");
    [m[i], m[p]] = [m[p], m[i]];
    const div = m[i][i];
    for (let j = i; j <= n; j++) m[i][j] /= div;
    for (let k = 0; k < n; k++)
      if (k !== i) {
        const mult = m[k][i];
        for (let j = i; j <= n; j++) m[k][j] -= mult * m[i][j];
      }
  }
  return m.map((row) => row[n]);
}
export function fitAdjustedModel(
  games: AdjustedTrainingGame[],
  meta: {
    now: string;
    implementationCommit: string;
    implementationSha256: string;
    manifestSha256: string;
    overtimeSupport: OvertimeSupport;
  },
): {
  state: string;
  reasons: string[];
  model?: AdjustedModel;
  modelSha256?: string;
} {
  if (
    !Number.isFinite(time(meta.now)) ||
    !/^[a-f0-9]{40}$/.test(meta.implementationCommit) ||
    !/^[a-f0-9]{64}$/.test(meta.implementationSha256) ||
    !/^[a-f0-9]{64}$/.test(meta.manifestSha256)
  )
    throw Error("adjusted_invalid_fit_metadata");
  const supportGames = researchOvertimeSupport(
    meta.overtimeSupport,
    2026,
    meta.now,
  );
  if (supportGames.length < 30)
    return {
      state: "waiting_for_overtime_evidence",
      reasons: ["requires_30_distinct_ot_games"],
    };
  const sorted = [...games].sort((a, b) => a.id.localeCompare(b.id)),
    ids = new Set<string>();
  for (const g of sorted) {
    if (
      !/^\d{4}:\d+$/.test(g.id) ||
      ids.has(g.id) ||
      ![g.inputSha256, g.labelSha256].every((s) => /^[a-f0-9]{64}$/.test(s)) ||
      !Number.isFinite(time(g.observedAt)) ||
      time(g.observedAt) > time(meta.now) ||
      ![g.regulationHome, g.regulationAway].every(
        (v) => Number.isSafeInteger(v) && v >= 0 && v <= 84,
      ) ||
      [g.features.home, g.features.away].some(
        (s) =>
          s.values.length !== ADJUSTED_FEATURE_NAMES.length ||
          s.values[0] !== 1 ||
          s.values.some((v) => !Number.isFinite(v)) ||
          !Number.isFinite(s.baseline),
      )
    )
      throw Error("adjusted_invalid_training_record");
    ids.add(g.id);
  }
  if (sorted.length < MIN_ADJUSTED_DEVELOPMENT_GAMES)
    return {
      state: "waiting_for_more_development_games",
      reasons: [
        `requires_${MIN_ADJUSTED_DEVELOPMENT_GAMES}_distinct_development_games`,
      ],
    };
  const rows = sorted.flatMap((g) => [
    { ...g.features.home, y: g.regulationHome - g.features.home.baseline },
    { ...g.features.away, y: g.regulationAway - g.features.away.baseline },
  ]);
  const p = ADJUSTED_FEATURE_NAMES.length,
    centers = Array.from({ length: p }, (_, i) =>
      i ? rows.reduce((s, r) => s + r.values[i], 0) / rows.length : 0,
    ),
    scales = centers.map((mu, i) =>
      i
        ? Math.sqrt(
            rows.reduce((s, r) => s + (r.values[i] - mu) ** 2, 0) / rows.length,
          ) || 1
        : 1,
    );
  const ranges = centers.map((_, i) => ({
    min: Math.min(...rows.map((r) => r.values[i])),
    max: Math.max(...rows.map((r) => r.values[i])),
  }));
  const injuryIndices = ADJUSTED_FEATURE_NAMES.map((name, i) =>
    /:(out|doubtful|questionable|game_time_decision)$/.test(name) ? i : -1,
  ).filter((i) => i >= 0);
  const reasons = [];
  if (ranges[1].max - ranges[1].min < 1e-8)
    reasons.push("opponent_effect_not_identifiable");
  if (ranges[2].max - ranges[2].min < 1e-8)
    reasons.push("venue_effect_not_identifiable");
  if (!injuryIndices.some((i) => ranges[i].max - ranges[i].min > 1e-8))
    reasons.push("availability_effect_not_identifiable");
  if (reasons.length) return { state: "waiting_for_signal_variation", reasons };
  const matrix = Array.from({ length: p }, () => Array(p).fill(0)),
    target = Array(p).fill(0),
    ridge = 4;
  for (const row of rows) {
    const x = row.values.map((v, i) => (v - centers[i]) / scales[i]);
    for (let i = 0; i < p; i++) {
      target[i] += x[i] * row.y;
      for (let j = 0; j < p; j++) matrix[i][j] += x[i] * x[j];
    }
  }
  for (let i = 1; i < p; i++) matrix[i][i] += ridge;
  const coefficients = solve(matrix, target);
  if (coefficients.some((v) => !Number.isFinite(v)))
    throw Error("adjusted_nonfinite_fit");
  const model: AdjustedModel = {
    version: 1,
    trainerVersion: ADJUSTED_MODEL_VERSION,
    featureVersion: ADJUSTED_FEATURE_VERSION,
    featureNames: [...ADJUSTED_FEATURE_NAMES],
    ridge,
    frozenAt: meta.now,
    implementationCommit: meta.implementationCommit,
    implementationSha256: meta.implementationSha256,
    developmentManifestSha256: meta.manifestSha256,
    trainingGameIds: [...ids].sort(),
    excludedGameIds: [
      ...new Set([
        ...ids,
        ...sorted.flatMap((g) => g.features.historyGameIds),
        ...supportGames.map((g) => `${g.season}:${g.eventId}`),
      ]),
    ].sort(),
    centers,
    scales,
    coefficients,
    ranges,
    neutralObserved: sorted.some((g) => g.features.neutralSite),
    researchOnly: true,
    productionReady: false,
    validationReady: false,
    overtimeSupport: meta.overtimeSupport,
    limitations: [
      "observational_regulation_score_fit_not_causal_injury_estimates",
      "fixed_experimental_ridge_not_holdout_tuned",
      "drive_distribution_and_ot_transfer_require_independent_validation",
      "unknown_availability_remains_an_explicit_predictor",
      "unsupported_feature_ranges_withheld",
      "no_coach_release_authority",
    ],
  };
  return {
    state: "fitted_research_candidate",
    reasons: [],
    model,
    modelSha256: adjustedHash(model),
  };
}
export function validateAdjustedModel(model: AdjustedModel, hash: string) {
  const n = ADJUSTED_FEATURE_NAMES.length;
  if (
    !model ||
    adjustedHash(model) !== hash ||
    model.version !== 1 ||
    model.trainerVersion !== ADJUSTED_MODEL_VERSION ||
    model.featureVersion !== ADJUSTED_FEATURE_VERSION ||
    canonicalEvidenceJson(model.featureNames) !==
      canonicalEvidenceJson(ADJUSTED_FEATURE_NAMES) ||
    model.ridge !== 4 ||
    model.researchOnly !== true ||
    model.productionReady !== false ||
    model.validationReady !== false ||
    !Number.isFinite(time(model.frozenAt)) ||
    ![model.implementationSha256, model.developmentManifestSha256].every((s) =>
      /^[a-f0-9]{64}$/.test(s),
    ) ||
    !/^[a-f0-9]{40}$/.test(model.implementationCommit) ||
    ![model.centers, model.scales, model.coefficients, model.ranges].every(
      (a) => Array.isArray(a) && a.length === n,
    ) ||
    [...model.centers, ...model.scales, ...model.coefficients].some(
      (v) => !Number.isFinite(v),
    ) ||
    model.scales.some((v) => v <= 0) ||
    model.ranges.some(
      (r) =>
        !Number.isFinite(r.min) || !Number.isFinite(r.max) || r.min > r.max,
    ) ||
    model.trainingGameIds.length < MIN_ADJUSTED_DEVELOPMENT_GAMES ||
    new Set(model.trainingGameIds).size !== model.trainingGameIds.length ||
    !Array.isArray(model.excludedGameIds) ||
    [...model.trainingGameIds, ...model.excludedGameIds].some(
      (id) => !/^\d{4}:\d+$/.test(id),
    ) ||
    model.trainingGameIds.some((id) => !model.excludedGameIds.includes(id)) ||
    researchOvertimeSupport(model.overtimeSupport, 2026, model.frozenAt)
      .length < 30 ||
    model.overtimeSupport.games.some(
      (g) => !model.excludedGameIds.includes(`${g.season}:${g.eventId}`),
    )
  )
    throw Error("adjusted_invalid_frozen_artifact");
}
export function predictAdjustedMeans(
  model: AdjustedModel,
  hash: string,
  features: ScoreFeaturePair,
) {
  validateAdjustedModel(model, hash);
  if (features.neutralSite && !model.neutralObserved)
    throw Error("adjusted_neutral_site_not_observed");
  const score = (row: ScoreFeaturePair["home"]) => {
    if (
      row.values.length !== model.featureNames.length ||
      row.values.some(
        (v, i) =>
          !Number.isFinite(v) ||
          v < model.ranges[i].min - 1e-9 ||
          v > model.ranges[i].max + 1e-9,
      )
    )
      throw Error("adjusted_feature_outside_training_support");
    const mean =
      row.baseline +
      row.values.reduce(
        (sum, v, i) =>
          sum +
          ((v - model.centers[i]) / model.scales[i]) * model.coefficients[i],
        0,
      );
    if (!Number.isFinite(mean) || mean < 0 || mean > 84)
      throw Error("adjusted_prediction_outside_score_support");
    return mean;
  };
  return { home: score(features.home), away: score(features.away) };
}
export type AdjustedEvidence = {
  model: AdjustedModel;
  modelSha256: string;
  protocol: ModelProtocol;
  protocolSha256: string;
  protocolRecordedAt: string;
  context: ContextFeatures;
  historyArchive: { games: TimedGame[] };
};
export function validateAdjustedEvidence(
  e: AdjustedEvidence,
  target: {
    season: number;
    eventId: string;
    homeId: string;
    awayId: string;
    kickoff: string;
  },
  forecastAt: string,
) {
  validateAdjustedModel(e?.model, e?.modelSha256);
  if (
    e.protocol.modelSha256 !== e.modelSha256 ||
    e.protocol.frozenAt !== e.model.frozenAt ||
    canonicalEvidenceJson(e.protocol.trainingGameIds) !==
      canonicalEvidenceJson(e.model.excludedGameIds) ||
    e.context?.datasetRole !== "holdout_context" ||
    ![
      e.context.capturedAt,
      e.context.recordedAt,
      e.context.availabilityObservedAt,
      forecastAt,
      target.kickoff,
    ].every((v) => Number.isFinite(time(v))) ||
    time(e.context.availabilityObservedAt) > time(e.context.capturedAt) ||
    time(e.context.capturedAt) > time(e.context.recordedAt) ||
    time(e.context.recordedAt) >= time(target.kickoff) ||
    adjustedHash(e.historyArchive) !==
      e.context.historySourceEvidence?.sha256 ||
    (e.context as any).holdoutModelSha256 !== e.modelSha256 ||
    (e.context as any).holdoutProtocolSha256 !== e.protocolSha256 ||
    time(e.context.recordedAt) < time(e.model.frozenAt) ||
    ["season", "eventId", "homeId", "awayId"].some(
      (k) => (e.context.target as any)[k] !== (target as any)[k],
    ) ||
    time(e.context.target.kickoff) !== time(target.kickoff) ||
    time(e.context.recordedAt) > time(forecastAt) ||
    time(forecastAt) - time(e.context.capturedAt) > 6 * 3600000
  )
    throw Error("adjusted_context_or_protocol_mismatch");
  assertProspectiveHoldout(e.protocol, e.protocolSha256, {
    ...target,
    modelSha256: e.modelSha256,
    protocolSha256: e.protocolSha256,
    protocolRecordedAt: e.protocolRecordedAt,
    forecastAt,
    inputCutoffAt: forecastAt,
    recordedAt: forecastAt,
    datasetRole: "independent_holdout",
    simulations: 10000,
    settlement: "full_game_including_overtime",
  });
}

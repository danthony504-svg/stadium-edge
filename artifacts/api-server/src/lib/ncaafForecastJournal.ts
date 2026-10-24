/** Forward-only research journal. Never grants Coach release authority. */
import { createHash } from "node:crypto";
import {
  readFullGameReplayArchive,
  priorRegulationTeamSample,
  type TimedGame,
  type ReplayQuote,
} from "./ncaafFullGameBacktest.js";
import { runNcaafFullGameCandidate } from "./sportSim/ncaafFullGameCandidate.js";
import {
  canonicalEvidenceJson,
  researchOvertimeSupport,
  OT_TRANSFER_REGIME,
  OT_TRANSFER_MODEL_VERSION,
  OT_RULE_REVIEW,
  type OvertimeSupport,
} from "./ncaafOvertimeTransfer.js";
import {
  ADJUSTED_MODEL_VERSION,
  primaryAdjustedQuote,
  validateAdjustedEvidence,
  contextScoreFeatures,
  predictAdjustedMeans,
  adjustedHash,
  type AdjustedEvidence,
} from "./ncaafAdjustedModel.js";
export type ForecastInput = {
  adjustedEvidence?: AdjustedEvidence;
  overtimeSupport?: OvertimeSupport;
  version: 1;
  target: Pick<
    TimedGame,
    "season" | "eventId" | "homeId" | "awayId" | "kickoff" | "ruleset"
  >;
  games: TimedGame[];
  quotes: ReplayQuote[];
  injuryEvidence: {
    key: string;
    observedAt: string;
    sha256: string;
    rawResponse: string;
    absentTeamStatus: "unknown";
  };
};
const ms = (v: string) => Date.parse(v);
export function prepareForwardForecast(
  input: ForecastInput,
  forecastAt: string,
) {
  const t = input?.target,
    now = ms(forecastAt);
  if (
    input?.version !== 1 ||
    !t ||
    !Number.isFinite(now) ||
    !Number.isSafeInteger(t.season) ||
    !/^\d+$/.test(t.eventId) ||
    !/^\d+$/.test(t.homeId) ||
    !/^\d+$/.test(t.awayId) ||
    t.homeId === t.awayId ||
    !Number.isFinite(ms(t.kickoff)) ||
    ms(t.kickoff) <= now ||
    !t.ruleset?.trim()
  )
    throw Error("journal_invalid_or_started_event");
  // Reuse strict settled-history validation without fabricating a target result.
  const { games } = readFullGameReplayArchive({
    version: 1,
    games: input.games,
    forecasts: [],
    quotes: [],
  });
  if (
    games.some(
      (g) =>
        (g.eventId === t.eventId && g.season === t.season) ||
        ms(g.observedAt) > now,
    )
  )
    throw Error("journal_future_or_target_history");
  const injury = input.injuryEvidence;
  if (
    !injury ||
    !/^research:ncaaf:injuries:/.test(injury.key) ||
    !Number.isFinite(ms(injury.observedAt)) ||
    ms(injury.observedAt) > now ||
    injury.absentTeamStatus !== "unknown" ||
    createHash("sha256").update(injury.rawResponse).digest("hex") !==
      injury.sha256
  )
    throw Error("journal_invalid_injury_evidence");
  if (!Array.isArray(JSON.parse(injury.rawResponse).injuries))
    throw Error("journal_invalid_injury_payload");
  const f = {
    season: t.season,
    eventId: t.eventId,
    forecastAt,
    inputCutoffAt: forecastAt,
    injurySourceTimestamp: injury.observedAt,
    ruleset: t.ruleset,
  };
  const home = priorRegulationTeamSample(games, t, f, t.homeId),
    away = priorRegulationTeamSample(games, t, f, t.awayId);
  if (!home || !away) throw Error("journal_thin_team_history");
  const support = input.overtimeSupport
    ? researchOvertimeSupport(input.overtimeSupport, t.season, forecastAt)
    : [];
  if (
    input.overtimeSupport &&
    t.ruleset !== "ncaa-football-season-2026-unverified"
  )
    throw Error("journal_invalid_overtime_transfer");
  const overtimeHistory = [...games, ...support]
    .filter(
      (g) =>
        (g.ruleset === t.ruleset ||
          (support.includes(g) && g.season === 2025)) &&
        g.overtime === true &&
        g.regulationHomePoints != null &&
        g.regulationAwayPoints != null &&
        ms(g.observedAt) < now,
    )
    .map((g) => ({
      gameId: `${g.season}:${g.eventId}`,
      ruleset: input.overtimeSupport ? OT_TRANSFER_REGIME : g.ruleset,
      completedAt: g.completedAt,
      observedAt: g.observedAt,
      regulationHome: g.regulationHomePoints!,
      regulationAway: g.regulationAwayPoints!,
      finalHome: g.homePoints,
      finalAway: g.awayPoints,
    }));
  const adjusted = input.adjustedEvidence;
  let expectedScoreMeans: { home: number; away: number } | undefined;
  if (adjusted) {
    validateAdjustedEvidence(adjusted, t, forecastAt);
    if (
      !input.overtimeSupport ||
      canonicalEvidenceJson(input.overtimeSupport) !==
        canonicalEvidenceJson(adjusted.model.overtimeSupport)
    )
      throw Error("journal_adjusted_ot_support_changed");
    const means = predictAdjustedMeans(
      adjusted.model,
      adjusted.modelSha256,
      contextScoreFeatures(adjusted.context, adjusted.historyArchive),
    );
    expectedScoreMeans = means;
  }
  const sim = runNcaafFullGameCandidate({
    home,
    away,
    ...(expectedScoreMeans ? { expectedScoreMeans } : {}),
    seed: Number(t.eventId) >>> 0,
    forecastAt,
    kickoff: t.kickoff,
    ruleset: input.overtimeSupport ? OT_TRANSFER_REGIME : t.ruleset,
    overtimeHistory,
  });
  if (!sim) throw Error("journal_insufficient_candidate_evidence");
  if (!Array.isArray(input.quotes) || !input.quotes.length)
    throw Error("journal_missing_quotes");
  const seen = new Set<string>();
  const markets = input.quotes.map((q) => {
    if (
      q.season !== t.season ||
      q.eventId !== t.eventId ||
      !q.bookmaker?.trim() ||
      !["ml", "spread", "total"].includes(q.market) ||
      q.settlement !== "full_game_including_overtime" ||
      ![q.firstPrice, q.secondPrice].every(
        (p) => Number.isFinite(p) && Math.abs(p) >= 100,
      ) ||
      !Number.isFinite(ms(q.observedAt)) ||
      ms(q.observedAt) > now ||
      (q.market === "ml" ? q.line !== null : !Number.isFinite(q.line)) ||
      (q.market === "total" && q.line! < 0)
    )
      throw Error("journal_invalid_quote");
    const identity = JSON.stringify([q.bookmaker, q.market, q.line]);
    if (seen.has(identity)) throw Error("journal_duplicate_quote");
    seen.add(identity);
    let wins = 0,
      pushes = 0;
    for (let i = 0; i < sim.draws; i++) {
      const h = sim.homeScores[i]!,
        a = sim.awayScores[i]!;
      const v =
        q.market === "ml"
          ? h - a
          : q.market === "spread"
            ? h - a + q.line!
            : h + a - q.line!;
      if (v > 0) wins++;
      else if (v === 0) pushes++;
    }
    return {
      ...q,
      winProbability: wins / sim.draws,
      pushProbability: pushes / sim.draws,
      conditionalWinProbability:
        pushes === sim.draws ? null : wins / (sim.draws - pushes),
    };
  });
  const primary = adjusted ? primaryAdjustedQuote(markets) : null;
  const pairIdentity = (q: (typeof markets)[number] | null) =>
    q
      ? {
          bookmaker: q.bookmaker,
          market: q.market,
          line: q.line,
          firstPrice: q.firstPrice,
          secondPrice: q.secondPrice,
          observedAt: q.observedAt,
        }
      : null;
  const evaluationPairs = adjusted
    ? Object.fromEntries(
        (["ml", "spread", "total"] as const).map((m) => [
          m,
          pairIdentity(primaryAdjustedQuote(markets, m)),
        ]),
      )
    : undefined;

  return {
    version: 1,
    researchOnly: true,
    productionReady: false,
    validationReady: false,
    automaticUnlock: false,
    modelVersion: adjusted
      ? `${ADJUSTED_MODEL_VERSION}:${adjusted.modelSha256}`
      : input.overtimeSupport
        ? OT_TRANSFER_MODEL_VERSION
        : sim.version,
    ...(adjusted
      ? {
          modelSha256: adjusted.modelSha256,
          protocolSha256: adjusted.protocolSha256,
          datasetRole: "independent_holdout" as const,
          modelLimitations: adjusted.model.limitations,
          evaluationPairs,
          evaluationPair: primary
            ? {
                bookmaker: primary.bookmaker,
                market: primary.market,
                line: primary.line,
                firstPrice: primary.firstPrice,
                secondPrice: primary.secondPrice,
                observedAt: primary.observedAt,
              }
            : null,
        }
      : {}),
    ...(input.overtimeSupport
      ? { overtimeTransferReview: OT_RULE_REVIEW }
      : {}),
    target: t,
    forecastAt,
    inputCutoffAt: forecastAt,
    simulations: sim.draws,
    homeMean: sim.homeMean,
    awayMean: sim.awayMean,
    markets,
    injuryEvidenceKey: injury.key,
    injurySourceTimestamp: injury.observedAt,
    absentTeamStatus: "unknown",
    sourceProvenance: "requires_independent_review",
    ...(input.overtimeSupport || adjusted
      ? { inputHashFormat: "canonical-json-sha256-v1" }
      : {}),
    inputSha256: createHash("sha256")
      .update(
        input.overtimeSupport || adjusted
          ? canonicalEvidenceJson(input)
          : JSON.stringify(input),
      )
      .digest("hex"),
    input,
  };
}

/** Score persisted probabilities, never recompute from the final score. */
export function scoreRecordedForecast(
  record: ReturnType<typeof prepareForwardForecast> & { recordedAt: string },
  outcome: TimedGame,
) {
  const t = record.target;
  const isAdjusted = record.modelVersion.startsWith(
    ADJUSTED_MODEL_VERSION + ":",
  );
  if (isAdjusted) {
    const e = record.input.adjustedEvidence;
    if (
      !e ||
      record.modelVersion !== `${ADJUSTED_MODEL_VERSION}:${e.modelSha256}` ||
      record.inputHashFormat !== "canonical-json-sha256-v1" ||
      adjustedHash(record.input) !== record.inputSha256 ||
      record.datasetRole !== "independent_holdout"
    )
      throw Error("journal_invalid_adjusted_forecast");
    if (
      record.markets.length !== record.input.quotes.length ||
      record.markets.some((q, i) => {
        const original = record.input.quotes[i];
        return [
          "season",
          "eventId",
          "bookmaker",
          "market",
          "line",
          "firstPrice",
          "secondPrice",
          "observedAt",
          "settlement",
        ].some((k) => (q as any)[k] !== (original as any)[k]);
      })
    )
      throw Error("journal_adjusted_quote_binding_changed");
    const primary = primaryAdjustedQuote(record.markets);
    const identity = primary
      ? {
          bookmaker: primary.bookmaker,
          market: primary.market,
          line: primary.line,
          firstPrice: primary.firstPrice,
          secondPrice: primary.secondPrice,
          observedAt: primary.observedAt,
        }
      : null;
    if (
      canonicalEvidenceJson(identity) !==
      canonicalEvidenceJson(record.evaluationPair)
    )
      throw Error("journal_adjusted_evaluation_pair_changed");
    const evaluationPairs = Object.fromEntries(
      (["ml", "spread", "total"] as const).map((m) => {
        const q = primaryAdjustedQuote(record.markets, m);
        return [
          m,
          q
            ? {
                bookmaker: q.bookmaker,
                market: q.market,
                line: q.line,
                firstPrice: q.firstPrice,
                secondPrice: q.secondPrice,
                observedAt: q.observedAt,
              }
            : null,
        ];
      }),
    );
    if (
      canonicalEvidenceJson(evaluationPairs) !==
      canonicalEvidenceJson(record.evaluationPairs)
    )
      throw Error("journal_adjusted_market_selection_changed");
    validateAdjustedEvidence(e, t, record.forecastAt);
  }
  const checked = readFullGameReplayArchive({
    version: 1,
    games: [outcome],
    forecasts: [],
    quotes: [],
  }).games[0]!;
  if (
    !record.researchOnly ||
    (!isAdjusted &&
      !["ncaaf-observed-ot-research-v1", OT_TRANSFER_MODEL_VERSION].includes(
        record.modelVersion,
      )) ||
    ![
      record.recordedAt,
      record.forecastAt,
      record.inputCutoffAt,
      t.kickoff,
    ].every((v) => Number.isFinite(ms(v))) ||
    ms(record.inputCutoffAt) > ms(record.forecastAt) ||
    ms(record.recordedAt) < ms(record.forecastAt) ||
    ms(record.recordedAt) >= ms(t.kickoff) ||
    checked.eventId !== t.eventId ||
    checked.season !== t.season ||
    checked.homeId !== t.homeId ||
    checked.awayId !== t.awayId ||
    ms(checked.kickoff) !== ms(t.kickoff) ||
    checked.ruleset !== t.ruleset
  )
    throw Error("journal_unmatched_or_late_record");
  return record.markets.map((q) => {
    const p = q.conditionalWinProbability;
    if (p !== null && (!Number.isFinite(p) || p < 0 || p > 1))
      throw Error("journal_invalid_saved_probability");
    const value =
      q.market === "ml"
        ? checked.homePoints - checked.awayPoints
        : q.market === "spread"
          ? checked.homePoints - checked.awayPoints + q.line!
          : checked.homePoints + checked.awayPoints - q.line!;
    const implied = (price: number) =>
      price < 0 ? -price / (-price + 100) : 100 / (price + 100);
    const a = implied(q.firstPrice),
      b = implied(q.secondPrice),
      marketProbability = a / (a + b),
      hit = value > 0 ? 1 : 0;
    return {
      eventId: t.eventId,
      season: t.season,
      modelVersion: record.modelVersion,
      bookmaker: q.bookmaker,
      market: q.market,
      line: q.line,
      result: value === 0 ? "push" : value > 0 ? "win" : "loss",
      modelBrier: value === 0 || p === null ? null : (p - hit) ** 2,
      marketBrier:
        value === 0 || p === null ? null : (marketProbability - hit) ** 2,
      validationReady: false,
    };
  });
}

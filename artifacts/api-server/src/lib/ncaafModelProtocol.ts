/** Immutable research boundaries. A protocol is not validation or permission to release. */
import { createHash } from "node:crypto";
import { canonicalEvidenceJson } from "./ncaafOvertimeTransfer.js";
export type ModelProtocol = {
  version: 1;
  modelSha256: string;
  frozenAt: string;
  trainingGameIds: string[];
  featureVersion: string;
  implementationCommit: string;
  simulations: 10000;
  markets: ("ml" | "spread" | "total")[];
  settlement: "full_game_including_overtime";
  minimumIndependentGames: 500;
  minimumSeasons: 2;
};
const sha = (v: unknown) =>
  createHash("sha256").update(canonicalEvidenceJson(v)).digest("hex");
export function freezeModelProtocol(input: ModelProtocol, now: string) {
  if (
    input?.version !== 1 ||
    !/^[a-f0-9]{64}$/.test(input.modelSha256) ||
    !/^[a-f0-9]{40}$/.test(input.implementationCommit) ||
    input.featureVersion !== "ncaaf-participation-availability-v2" ||
    !Number.isFinite(Date.parse(input.frozenAt)) ||
    !Number.isFinite(Date.parse(now)) ||
    Date.parse(input.frozenAt) > Date.parse(now) ||
    input.simulations !== 10000 ||
    input.minimumIndependentGames !== 500 ||
    input.minimumSeasons !== 2 ||
    input.settlement !== "full_game_including_overtime" ||
    !Array.isArray(input.markets) ||
    !input.markets.length ||
    input.markets.some((m) => !["ml", "spread", "total"].includes(m)) ||
    new Set(input.markets).size !== input.markets.length ||
    !Array.isArray(input.trainingGameIds) ||
    !input.trainingGameIds.length ||
    input.trainingGameIds.some((id) => !/^\d{4}:\d+$/.test(id)) ||
    new Set(input.trainingGameIds).size !== input.trainingGameIds.length
  )
    throw Error("protocol_invalid_model_or_boundaries");
  const protocol = {
    ...input,
    trainingGameIds: [...input.trainingGameIds].sort(),
    markets: [...input.markets].sort(),
  };
  return {
    protocol,
    protocolSha256: sha(protocol),
    researchOnly: true,
    validationReady: false,
    releaseEligible: false,
  };
}
export function assertProspectiveHoldout(
  protocol: ModelProtocol,
  protocolSha256: string,
  forecast: {
    season: number;
    eventId: string;
    kickoff: string;
    forecastAt: string;
    inputCutoffAt: string;
    recordedAt: string;
    modelSha256: string;
    protocolSha256: string;
    datasetRole: string;
    simulations: number;
    settlement: string;
  },
) {
  // Revalidate stored content; do not trust a caller's eligibility boolean.
  const sealed = freezeModelProtocol(protocol, forecast.recordedAt);
  if (
    sealed.protocolSha256 !== protocolSha256 ||
    forecast.protocolSha256 !== protocolSha256 ||
    forecast.modelSha256 !== protocol.modelSha256 ||
    forecast.datasetRole !== "independent_holdout" ||
    protocol.trainingGameIds.includes(
      `${forecast.season}:${forecast.eventId}`,
    ) ||
    !Number.isSafeInteger(forecast.season) ||
    !/^\d+$/.test(forecast.eventId) ||
    ![
      forecast.forecastAt,
      forecast.inputCutoffAt,
      forecast.recordedAt,
      forecast.kickoff,
    ].every((s) => Number.isFinite(Date.parse(s))) ||
    Date.parse(forecast.inputCutoffAt) > Date.parse(forecast.forecastAt) ||
    Date.parse(forecast.forecastAt) < Date.parse(protocol.frozenAt) ||
    Date.parse(forecast.recordedAt) < Date.parse(forecast.forecastAt) ||
    Date.parse(forecast.recordedAt) >= Date.parse(forecast.kickoff) ||
    forecast.simulations !== 10000 ||
    forecast.settlement !== protocol.settlement
  )
    throw Error("protocol_holdout_leakage_or_identity");
  return { eligibleForScoring: true, releaseEligible: false };
}

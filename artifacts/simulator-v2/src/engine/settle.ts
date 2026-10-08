import type { SimV2ScenarioTensor } from "../schemas/scenarioTensor.js";
import type { SimV2Market } from "../schemas/market.js";
import type { SimV2Odds } from "../schemas/odds.js";
import type { SimV2SimulationResult } from "../schemas/simulationResult.js";
import { SIM_V2_SCHEMA_VERSION } from "../version.js";
import { americanToDecimal } from "../schemas/odds.js";
import { validateScenarioConsistency } from "../validation/consistency.js";
import { isMarketFamilySupported, missingDataReject } from "../validation/unsupported.js";
import { validateSimHitProbability } from "../validation/probability.js";

export type SettleRequest = {
  tensor: SimV2ScenarioTensor;
  market: SimV2Market;
  odds: SimV2Odds | null;
  /** Test-only: allow settling fixture tensors. */
  allowFixture?: boolean;
  periodSumGroup?: string[];
};

function resolveSeries(tensor: SimV2ScenarioTensor, market: SimV2Market): Float64Array | null {
  const path = market.settlement.settlePath;
  if (path === "team.homeFg") return tensor.team.homeFg;
  if (path === "team.awayFg") return tensor.team.awayFg;
  if (path === "team.totalFg") {
    const out = new Float64Array(tensor.meta.nDraws);
    for (let i = 0; i < out.length; i++) out[i] = tensor.team.homeFg[i] + tensor.team.awayFg[i];
    return out;
  }
  const periodHome = /^team\.homeByPeriod\.(\w+)$/.exec(path);
  if (periodHome) return tensor.team.homeByPeriod[periodHome[1]] ?? null;
  const periodAway = /^team\.awayByPeriod\.(\w+)$/.exec(path);
  if (periodAway) return tensor.team.awayByPeriod[periodAway[1]] ?? null;
  const playerStat = /^players\.([^.]+)\.stats\.([^.]+)$/.exec(path);
  if (playerStat) {
    return tensor.players[playerStat[1]]?.stats[playerStat[2]] ?? null;
  }
  if (path === "team.margin") {
    const out = new Float64Array(tensor.meta.nDraws);
    for (let i = 0; i < out.length; i++) out[i] = tensor.team.homeFg[i] - tensor.team.awayFg[i];
    return out;
  }
  return null;
}

function hitForDraw(value: number, market: SimV2Market): boolean {
  const line = market.line ?? 0;
  switch (market.settlement.comparator) {
    case "gt":
      return value > line;
    case "gte":
      return value >= line;
    case "lt":
      return value < line;
    case "lte":
      return value <= line;
    case "eq":
      return value === line;
    case "home_wins":
      return value > 0;
    case "away_wins":
      return value < 0;
    case "push_push":
      return false;
    default:
      return false;
  }
}

export function settleMarket(req: SettleRequest): SimV2SimulationResult {
  const t0 = performance.now();
  const { tensor, market, odds } = req;
  const base = {
    schemaVersion: SIM_V2_SCHEMA_VERSION,
    engineId: "simulator-v2" as const,
    marketId: market.marketId,
    eventId: market.eventId,
    sport: market.sport,
    family: market.family,
    modelId: tensor.meta.modelId,
    modelVersion: tensor.meta.modelVersion,
    dataFingerprint: tensor.meta.dataFingerprint,
    nDraws: tensor.meta.nDraws,
    seed: tensor.meta.seed,
    computedAt: new Date().toISOString(),
  };

  const finish = (
    partial: Omit<SimV2SimulationResult, keyof typeof base | "latencyMs"> & {
      latencyMs?: number;
    },
  ): SimV2SimulationResult => ({
    ...base,
    ...partial,
    latencyMs: performance.now() - t0,
  });

  if (tensor.meta.isFixture && !req.allowFixture) {
    return finish({
      status: "fixture_only",
      reason: "fixture_tensor_not_for_production",
      simHit: null,
      providerOddsAmerican: odds?.american ?? null,
      impliedProbRaw: odds?.impliedProbRaw ?? null,
      edgePct: null,
      evPct: null,
    });
  }

  const support = isMarketFamilySupported(market.sport, market.family, {
    allowFixture: req.allowFixture,
    isFixtureTensor: tensor.meta.isFixture,
  });
  if (!support.supported) {
    return finish({
      status: "unsupported",
      reason: support.reason,
      simHit: null,
      providerOddsAmerican: odds?.american ?? null,
      impliedProbRaw: odds?.impliedProbRaw ?? null,
      edgePct: null,
      evPct: null,
    });
  }

  const missing = missingDataReject(tensor.meta.quality.missingFields);
  if (!missing.supported || tensor.meta.quality.status === "reject") {
    return finish({
      status: "missing_data",
      reason: missing.reason ?? "data_quality_reject",
      simHit: null,
      providerOddsAmerican: odds?.american ?? null,
      impliedProbRaw: odds?.impliedProbRaw ?? null,
      edgePct: null,
      evPct: null,
    });
  }

  const consistency = validateScenarioConsistency(tensor, {
    periodSumGroup: req.periodSumGroup ?? ["h1", "h2"],
  });
  if (!consistency.ok) {
    return finish({
      status: "integrity_reject",
      reason: consistency.issues.map((i) => i.code).join(","),
      simHit: null,
      providerOddsAmerican: odds?.american ?? null,
      impliedProbRaw: odds?.impliedProbRaw ?? null,
      edgePct: null,
      evPct: null,
    });
  }

  if (!odds) {
    return finish({
      status: "missing_data",
      reason: "missing_data:provider_odds",
      simHit: null,
      providerOddsAmerican: null,
      impliedProbRaw: null,
      edgePct: null,
      evPct: null,
    });
  }

  const series = resolveSeries(tensor, market);
  if (!series) {
    return finish({
      status: "unsupported",
      reason: `unsupported_settlement:${market.settlement.settlePath}`,
      simHit: null,
      providerOddsAmerican: odds.american,
      impliedProbRaw: odds.impliedProbRaw,
      edgePct: null,
      evPct: null,
    });
  }

  let hits = 0;
  for (let i = 0; i < series.length; i++) {
    if (hitForDraw(series[i], market)) hits += 1;
  }
  const simHit = hits / series.length;
  const probOk = validateSimHitProbability(simHit);
  if (!probOk.ok) {
    return finish({
      status: "integrity_reject",
      reason: probOk.reason,
      simHit: null,
      providerOddsAmerican: odds.american,
      impliedProbRaw: odds.impliedProbRaw,
      edgePct: null,
      evPct: null,
    });
  }

  const edgePct = (simHit - odds.impliedProbRaw) * 100;
  const evPct = (simHit * americanToDecimal(odds.american) - 1) * 100;

  return finish({
    status: "ok",
    simHit,
    providerOddsAmerican: odds.american,
    impliedProbRaw: odds.impliedProbRaw,
    edgePct,
    evPct,
  });
}

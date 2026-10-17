/**
 * Option C — Hybrid allowlist for player-prop probability provenance.
 *
 * - exact_market_10k: 10_000 sims completed for exact athlete/event/market/side/line
 * - validated_historical_model: only when sport+market is on the allowlist with evidence
 * - insufficient_evidence: failed/unmapped/unapproved — not seating-eligible
 *
 * Allowlist starts EMPTY until validation evidence is supplied. History hits alone
 * never invent eligibility. Do not manufacture hit probabilities.
 */

export const EXACT_MARKET_10K_MIN_SIMULATIONS = 10_000;

export type PropProbabilitySource =
  | "exact_market_10k"
  | "validated_historical_model"
  | "insufficient_evidence";

export type PropProbabilityProvenance = {
  source: PropProbabilitySource;
  hitProbability: number | null;
  simulations: number;
  nullReason: string | null;
  hitReliability: number | null;
  sport?: string | null;
  marketKey?: string | null;
};

/** Explicit validation record — required before any historical fallback seats. */
export type ValidatedHistoricalMarketEntry = {
  /** Canonical sport id (nfl, ncaaf, nba, …). */
  sport: string;
  /** Odds API / prop market key (player_anytime_td, …). */
  marketKey: string;
  /** Pointer to empirical validation evidence (doc path, eval id, or report). */
  evidenceRef: string;
};

/**
 * Approved historical-model fallbacks.
 * EMPTY until validation evidence is supplied — do not auto-approve ATD/first TD.
 */
export const VALIDATED_HISTORICAL_MODEL_ALLOWLIST: readonly ValidatedHistoricalMarketEntry[] =
  Object.freeze([]);

export const SIM_FACTOR_LABEL_EXACT_10K = "10K Simulation";
export const SIM_FACTOR_LABEL_HISTORICAL = "Historical Model";

function canonSport(sport?: string | null): string {
  return String(sport ?? "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-");
}

function canonMarketKey(marketKey?: string | null): string {
  return String(marketKey ?? "")
    .toLowerCase()
    .trim()
    .replace(/_alternate$/i, "");
}

export function isValidatedHistoricalMarket(
  sport?: string | null,
  marketKey?: string | null,
): boolean {
  const s = canonSport(sport);
  const m = canonMarketKey(marketKey);
  if (!s || !m) return false;
  return VALIDATED_HISTORICAL_MODEL_ALLOWLIST.some(
    (e) => canonSport(e.sport) === s && canonMarketKey(e.marketKey) === m,
  );
}

export function simulationFactorLabelForSource(
  source: PropProbabilitySource | null | undefined,
): string | null {
  if (source === "exact_market_10k") return SIM_FACTOR_LABEL_EXACT_10K;
  if (source === "validated_historical_model") return SIM_FACTOR_LABEL_HISTORICAL;
  return null;
}

export function insufficientPropProvenance(opts: {
  sport?: string | null;
  marketKey?: string | null;
  nullReason?: string | null;
  hitReliability?: number | null;
  simulations?: number | null;
}): PropProbabilityProvenance {
  return {
    source: "insufficient_evidence",
    hitProbability: null,
    simulations: Math.max(0, Math.floor(opts.simulations ?? 0)),
    nullReason: opts.nullReason ?? "insufficient_evidence",
    hitReliability:
      opts.hitReliability != null && Number.isFinite(opts.hitReliability)
        ? opts.hitReliability
        : null,
    sport: opts.sport ?? null,
    marketKey: opts.marketKey ?? null,
  };
}

/**
 * Stamp exact-market 10k only when simulations completed for the exact key
 * and a finite hit exists. Never upgrade partial/failed draws.
 */
export function exactMarket10kProvenance(opts: {
  hitProbability: number | null | undefined;
  simulations: number | null | undefined;
  sport?: string | null;
  marketKey?: string | null;
  nullReason?: string | null;
  hitReliability?: number | null;
}): PropProbabilityProvenance {
  const sims = Math.floor(opts.simulations ?? 0);
  const hit = opts.hitProbability;
  if (
    hit != null &&
    Number.isFinite(hit) &&
    sims >= EXACT_MARKET_10K_MIN_SIMULATIONS
  ) {
    return {
      source: "exact_market_10k",
      hitProbability: hit,
      simulations: sims,
      nullReason: null,
      hitReliability:
        opts.hitReliability != null && Number.isFinite(opts.hitReliability)
          ? opts.hitReliability
          : null,
      sport: opts.sport ?? null,
      marketKey: opts.marketKey ?? null,
    };
  }
  return insufficientPropProvenance({
    sport: opts.sport,
    marketKey: opts.marketKey,
    nullReason:
      opts.nullReason ??
      (sims > 0 && sims < EXACT_MARKET_10K_MIN_SIMULATIONS
        ? "insufficient_simulations"
        : "exact_market_10k_incomplete"),
    hitReliability: opts.hitReliability,
    simulations: sims,
  });
}

/**
 * Historical-model stamp — seating hit only when sport/market is allowlisted.
 * Non-allowlisted history never becomes a seating probability.
 */
export function historicalModelProvenance(opts: {
  hitProbability: number | null | undefined;
  sport?: string | null;
  marketKey?: string | null;
  nullReason?: string | null;
  hitReliability?: number | null;
}): PropProbabilityProvenance {
  const hit = opts.hitProbability;
  const allowed = isValidatedHistoricalMarket(opts.sport, opts.marketKey);
  if (
    allowed &&
    hit != null &&
    Number.isFinite(hit)
  ) {
    return {
      source: "validated_historical_model",
      hitProbability: hit,
      simulations: 0,
      nullReason: null,
      hitReliability:
        opts.hitReliability != null && Number.isFinite(opts.hitReliability)
          ? opts.hitReliability
          : null,
      sport: opts.sport ?? null,
      marketKey: opts.marketKey ?? null,
    };
  }
  return insufficientPropProvenance({
    sport: opts.sport,
    marketKey: opts.marketKey,
    nullReason:
      opts.nullReason ??
      (hit != null && Number.isFinite(hit)
        ? "unapproved_historical_model"
        : "insufficient_evidence"),
    hitReliability: opts.hitReliability,
    simulations: 0,
  });
}

/** True when provenance authorizes using hitProbability for #711 / seating. */
export function propProvenanceAllowsSeating(
  provenance: PropProbabilityProvenance | null | undefined,
): boolean {
  if (!provenance) return false;
  if (provenance.source === "insufficient_evidence") return false;
  if (provenance.hitProbability == null || !Number.isFinite(provenance.hitProbability)) {
    return false;
  }
  if (provenance.source === "exact_market_10k") {
    return provenance.simulations >= EXACT_MARKET_10K_MIN_SIMULATIONS;
  }
  if (provenance.source === "validated_historical_model") {
    return isValidatedHistoricalMarket(provenance.sport, provenance.marketKey);
  }
  return false;
}

/** Seating hit from provenance — null when not authorized (never invent). */
export function seatingHitFromProvenance(
  provenance: PropProbabilityProvenance | null | undefined,
): number | null {
  if (!propProvenanceAllowsSeating(provenance)) return null;
  return provenance!.hitProbability;
}

/**
 * Prefer stronger authorized provenance. Never promote insufficient over a
 * valid exact/historical stamp. Never invent hits.
 */
export function preferPropProvenance(
  current: PropProbabilityProvenance | null | undefined,
  incoming: PropProbabilityProvenance | null | undefined,
): PropProbabilityProvenance {
  if (!incoming) {
    return current ?? insufficientPropProvenance({});
  }
  if (!current) return incoming;
  if (propProvenanceAllowsSeating(current) && !propProvenanceAllowsSeating(incoming)) {
    return current;
  }
  if (!propProvenanceAllowsSeating(current) && propProvenanceAllowsSeating(incoming)) {
    return incoming;
  }
  // Both authorized or both not — prefer exact 10k over historical.
  if (
    incoming.source === "exact_market_10k" &&
    current.source !== "exact_market_10k"
  ) {
    return incoming;
  }
  if (
    current.source === "exact_market_10k" &&
    incoming.source !== "exact_market_10k"
  ) {
    return current;
  }
  return incoming;
}

export function validatedHistoricalAllowlistEvidence(): readonly ValidatedHistoricalMarketEntry[] {
  return VALIDATED_HISTORICAL_MODEL_ALLOWLIST;
}

/** Resolve provenance from pick and/or score — never invent. */
export function resolvePropProbabilityProvenance(input: {
  propProbabilityProvenance?: PropProbabilityProvenance | null;
  finalAiScore?: { propProbabilityProvenance?: PropProbabilityProvenance | null } | null;
}): PropProbabilityProvenance | null {
  return (
    input.propProbabilityProvenance ??
    input.finalAiScore?.propProbabilityProvenance ??
    null
  );
}

/**
 * Test / fixture helper — stamp authorized exact 10k when a finite seating hit
 * already exists. Production paths must use exactMarket10kProvenance from real sims.
 */
export function withExactMarket10kProvenance<
  T extends {
    isProp?: boolean | null;
    sport?: string | null;
    propMarketKey?: string | null;
    market?: string | null;
    simHit?: number | null;
    propProbabilityProvenance?: PropProbabilityProvenance | null;
    finalAiScore?: {
      simHit?: number | null;
      propProbabilityProvenance?: PropProbabilityProvenance | null;
    } | null;
  },
>(pick: T, simulations = EXACT_MARKET_10K_MIN_SIMULATIONS): T {
  if (!pick.isProp) return pick;
  const hit =
    pick.simHit ??
    pick.finalAiScore?.simHit ??
    pick.propProbabilityProvenance?.hitProbability ??
    null;
  const provenance = exactMarket10kProvenance({
    hitProbability: hit,
    simulations,
    sport: pick.sport,
    marketKey: pick.propMarketKey ?? pick.market,
  });
  return {
    ...pick,
    propProbabilityProvenance: provenance,
    ...(pick.finalAiScore
      ? {
          finalAiScore: {
            ...pick.finalAiScore,
            propProbabilityProvenance: provenance,
          },
        }
      : {}),
  };
}

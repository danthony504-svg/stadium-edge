/**
 * Option C — Hybrid allowlist for player-prop probability provenance.
 *
 * - exact_market_10k: trusted completed 10k sims for exact athlete/event/market/side/line
 * - validated_historical_model: only when sport+market is on the allowlist with evidence
 * - insufficient_evidence: failed/unmapped/unapproved — not seating-eligible
 *
 * Exact-market seating requires a module-private trusted evidence registration.
 * Caller-created `{ source: "exact_market_10k", simulations: 10000 }` objects
 * never authorize seating. Allowlist starts EMPTY.
 */

export const EXACT_MARKET_10K_MIN_SIMULATIONS = 10_000;

export type PropProbabilitySource =
  | "exact_market_10k"
  | "validated_historical_model"
  | "insufficient_evidence";

export type ExactMarketIdentity = {
  athleteId: string;
  eventId: string;
  marketKey: string;
  side: "Over" | "Under";
  line: number;
};

export type PropHitAdjustment = "grade_clip" | "defense_tilt" | "aligned";

export type PropProbabilityProvenance = {
  source: PropProbabilitySource;
  hitProbability: number | null;
  /**
   * Draw count from the original exact-market batch. Adjustments keep this
   * value — they do not imply a new 10k Monte Carlo run.
   */
  simulations: number;
  nullReason: string | null;
  hitReliability: number | null;
  sport?: string | null;
  marketKey?: string | null;
  athleteId?: string | null;
  eventId?: string | null;
  side?: "Over" | "Under" | null;
  line?: number | null;
  /**
   * Opaque trust token minted only by exactMarket10kProvenance / derived
   * adjustment mint when registered. Client-copied stamps without a live
   * registry entry fail.
   */
  evidenceId?: string | null;
  /** Parent evidenceId when this stamp is a grade/clip/tilt adjustment. */
  derivedFromEvidenceId?: string | null;
  /** Raw sim hit before adjustment (lineage). */
  rawHitProbability?: number | null;
  /** Why hitProbability differs from the original sim draw. */
  hitAdjustment?: PropHitAdjustment | null;
};

/** Explicit validation record — required before any historical fallback seats. */
export type ValidatedHistoricalMarketEntry = {
  sport: string;
  marketKey: string;
  evidenceRef: string;
};

export const VALIDATED_HISTORICAL_MODEL_ALLOWLIST: readonly ValidatedHistoricalMarketEntry[] =
  Object.freeze([]);

export const SIM_FACTOR_LABEL_EXACT_10K = "10K Simulation";
export const SIM_FACTOR_LABEL_HISTORICAL = "Historical Model";

type TrustedExactEvidence = ExactMarketIdentity & {
  hitProbability: number;
  simulations: number;
  integrity: string;
  parentEvidenceId?: string | null;
  rawHitProbability?: number | null;
  hitAdjustment?: PropHitAdjustment | null;
};

const trustedExactEvidence = new Map<string, TrustedExactEvidence>();
let evidenceSeq = 0;

/** Coverage counters — missing/fail-closed identity (no extra network). */
export type ExactMarketCoverageImpact = {
  missingAthleteId: number;
  missingEventId: number;
  missingMarketSideLine: number;
  stampedExact10k: number;
  /** Grade/clip/tilt adjustments of existing evidence — not new MC batches. */
  adjustedExact10k: number;
  rejectedMissingIdentity: number;
};

const coverageImpact: ExactMarketCoverageImpact = {
  missingAthleteId: 0,
  missingEventId: 0,
  missingMarketSideLine: 0,
  stampedExact10k: 0,
  adjustedExact10k: 0,
  rejectedMissingIdentity: 0,
};

export function getExactMarketCoverageImpact(): ExactMarketCoverageImpact {
  return { ...coverageImpact };
}

export function resetExactMarketCoverageImpactForTests(): void {
  coverageImpact.missingAthleteId = 0;
  coverageImpact.missingEventId = 0;
  coverageImpact.missingMarketSideLine = 0;
  coverageImpact.stampedExact10k = 0;
  coverageImpact.adjustedExact10k = 0;
  coverageImpact.rejectedMissingIdentity = 0;
}

/** Test isolation — clears trusted evidence registry. */
export function clearTrustedExactEvidenceForTests(): void {
  trustedExactEvidence.clear();
  evidenceSeq = 0;
}

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

function canonSide(side?: string | null): "Over" | "Under" | null {
  if (side === "Over" || side === "Under") return side;
  return null;
}

function integrityFor(ev: {
  athleteId: string;
  eventId: string;
  marketKey: string;
  side: "Over" | "Under";
  line: number;
  hitProbability: number;
  simulations: number;
}): string {
  return [
    String(ev.athleteId).trim(),
    String(ev.eventId).trim(),
    canonMarketKey(ev.marketKey),
    ev.side,
    String(ev.line),
    String(ev.hitProbability),
    String(ev.simulations),
  ].join("|");
}

/** Authoritative exact-market identity key — never player-name-only. */
export function exactMarketIdentityKey(identity: ExactMarketIdentity): string {
  return [
    String(identity.athleteId).trim(),
    String(identity.eventId).trim(),
    canonMarketKey(identity.marketKey),
    identity.side,
    String(identity.line),
  ].join("|");
}

export type ExactMarketCandidate = {
  athleteId?: string | null;
  eventId?: string | null;
  propMarketKey?: string | null;
  market?: string | null;
  propSide?: string | null;
  propLine?: number | null;
  side?: string | null;
  line?: number | null;
};

/**
 * Resolve authoritative identity. Missing athleteId/eventId/market/side/line
 * → null (fail closed for exact-market stamps).
 */
export function resolveExactMarketIdentity(
  candidate: ExactMarketCandidate | null | undefined,
): ExactMarketIdentity | null {
  if (!candidate) return null;
  const athleteId = String(candidate.athleteId ?? "").trim();
  const eventId = String(candidate.eventId ?? "").trim();
  const marketKey = canonMarketKey(candidate.propMarketKey ?? candidate.market);
  const side = canonSide(candidate.propSide ?? candidate.side);
  const lineRaw = candidate.propLine ?? candidate.line;
  const line =
    lineRaw != null && Number.isFinite(lineRaw) ? Number(lineRaw) : null;
  if (!athleteId) return null;
  if (!eventId) return null;
  if (!marketKey || !side || line == null) return null;
  return { athleteId, eventId, marketKey, side, line };
}

export function identitiesMatch(
  a: ExactMarketIdentity,
  b: ExactMarketIdentity,
): boolean {
  return exactMarketIdentityKey(a) === exactMarketIdentityKey(b);
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

/** True when a trusted exact-market 10k registration exists for this identity. */
export function hasTrustedExactMarketEvidence(
  candidate: ExactMarketCandidate | null | undefined,
): boolean {
  const id = resolveExactMarketIdentity(candidate);
  if (!id) return false;
  for (const trusted of trustedExactEvidence.values()) {
    if (
      identitiesMatch(id, trusted) &&
      trusted.simulations >= EXACT_MARKET_10K_MIN_SIMULATIONS &&
      Number.isFinite(trusted.hitProbability)
    ) {
      return true;
    }
  }
  return false;
}

/**
 * PickCard / ALT ladder caption — only claim 10K when every displayed alt has
 * verified exact-market evidence for its athlete/event/market/side/line.
 */
export function altLadderSimulationCaption(opts: {
  parent: ExactMarketCandidate & {
    propProbabilityProvenance?: PropProbabilityProvenance | null;
    finalAiScore?: { propProbabilityProvenance?: PropProbabilityProvenance | null } | null;
  };
  alts: ReadonlyArray<{
    propLine?: number | null;
    line?: number | null;
    propProbabilityProvenance?: PropProbabilityProvenance | null;
    propSide?: string | null;
    side?: string | null;
  }>;
}): string {
  const base = "Alternate lines · Safest → Best → Value → High Risk";
  if (!opts.alts.length) return base;
  const allVerified = opts.alts.every((alt) => {
    const line = alt.propLine ?? alt.line ?? null;
    const side = alt.propSide ?? alt.side ?? opts.parent.propSide ?? opts.parent.side;
    // Prefer alt-attached provenance when present; else check trusted registry
    // for this exact line (sibling lines registered from the same deep draw).
    if (alt.propProbabilityProvenance) {
      return propProvenanceAllowsSeating(alt.propProbabilityProvenance, {
        athleteId: opts.parent.athleteId,
        eventId: opts.parent.eventId,
        propMarketKey: opts.parent.propMarketKey ?? opts.parent.market,
        propSide: side,
        propLine: line,
      });
    }
    return hasTrustedExactMarketEvidence({
      athleteId: opts.parent.athleteId,
      eventId: opts.parent.eventId,
      propMarketKey: opts.parent.propMarketKey ?? opts.parent.market,
      propSide: side,
      propLine: line,
    });
  });
  if (!allVerified) return base;
  return "Alternate lines · 10K Simulation · Safest → Best → Value → High Risk";
}

export function insufficientPropProvenance(opts: {
  sport?: string | null;
  marketKey?: string | null;
  nullReason?: string | null;
  hitReliability?: number | null;
  simulations?: number | null;
  athleteId?: string | null;
  eventId?: string | null;
  side?: "Over" | "Under" | null;
  line?: number | null;
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
    athleteId: opts.athleteId ?? null,
    eventId: opts.eventId ?? null,
    side: opts.side ?? null,
    line: opts.line ?? null,
    evidenceId: null,
  };
}

/**
 * Stamp exact-market 10k only when:
 * - authoritative athleteId + eventId + market + side + line are present
 * - simulations >= 10000 and hit is finite
 * Registers trusted evidence — forged copies without registration never seat.
 */
export function exactMarket10kProvenance(opts: {
  hitProbability: number | null | undefined;
  simulations: number | null | undefined;
  sport?: string | null;
  marketKey?: string | null;
  nullReason?: string | null;
  hitReliability?: number | null;
  athleteId?: string | null;
  eventId?: string | null;
  side?: string | null;
  line?: number | null;
}): PropProbabilityProvenance {
  const sims = Math.floor(opts.simulations ?? 0);
  const hit = opts.hitProbability;
  const identity = resolveExactMarketIdentity({
    athleteId: opts.athleteId,
    eventId: opts.eventId,
    propMarketKey: opts.marketKey,
    propSide: opts.side,
    propLine: opts.line,
  });

  if (!identity) {
    if (!String(opts.athleteId ?? "").trim()) coverageImpact.missingAthleteId += 1;
    if (!String(opts.eventId ?? "").trim()) coverageImpact.missingEventId += 1;
    if (
      !canonMarketKey(opts.marketKey) ||
      !canonSide(opts.side) ||
      opts.line == null ||
      !Number.isFinite(opts.line)
    ) {
      coverageImpact.missingMarketSideLine += 1;
    }
    coverageImpact.rejectedMissingIdentity += 1;
    return insufficientPropProvenance({
      sport: opts.sport,
      marketKey: opts.marketKey,
      nullReason: opts.nullReason ?? "missing_exact_identity",
      hitReliability: opts.hitReliability,
      simulations: sims,
      athleteId: opts.athleteId ?? null,
      eventId: opts.eventId ?? null,
      side: canonSide(opts.side),
      line: opts.line != null && Number.isFinite(opts.line) ? Number(opts.line) : null,
    });
  }

  if (hit == null || !Number.isFinite(hit) || sims < EXACT_MARKET_10K_MIN_SIMULATIONS) {
    return insufficientPropProvenance({
      sport: opts.sport,
      marketKey: identity.marketKey,
      nullReason:
        opts.nullReason ??
        (sims > 0 && sims < EXACT_MARKET_10K_MIN_SIMULATIONS
          ? "insufficient_simulations"
          : "exact_market_10k_incomplete"),
      hitReliability: opts.hitReliability,
      simulations: sims,
      athleteId: identity.athleteId,
      eventId: identity.eventId,
      side: identity.side,
      line: identity.line,
    });
  }

  const integrity = integrityFor({
    ...identity,
    hitProbability: hit,
    simulations: sims,
  });
  evidenceSeq += 1;
  const evidenceId = `tev_${evidenceSeq}_${integrity.slice(0, 24)}`;
  trustedExactEvidence.set(evidenceId, {
    ...identity,
    hitProbability: hit,
    simulations: sims,
    integrity,
  });
  coverageImpact.stampedExact10k += 1;

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
    marketKey: identity.marketKey,
    athleteId: identity.athleteId,
    eventId: identity.eventId,
    side: identity.side,
    line: identity.line,
    evidenceId,
  };
}

/**
 * Historical-model stamp — seating hit only when sport/market is allowlisted.
 */
export function historicalModelProvenance(opts: {
  hitProbability: number | null | undefined;
  sport?: string | null;
  marketKey?: string | null;
  nullReason?: string | null;
  hitReliability?: number | null;
  athleteId?: string | null;
  eventId?: string | null;
  side?: string | null;
  line?: number | null;
}): PropProbabilityProvenance {
  const hit = opts.hitProbability;
  const allowed = isValidatedHistoricalMarket(opts.sport, opts.marketKey);
  const side = canonSide(opts.side);
  const line =
    opts.line != null && Number.isFinite(opts.line) ? Number(opts.line) : null;
  if (allowed && hit != null && Number.isFinite(hit)) {
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
      athleteId: opts.athleteId ?? null,
      eventId: opts.eventId ?? null,
      side,
      line,
      evidenceId: null,
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
    athleteId: opts.athleteId ?? null,
    eventId: opts.eventId ?? null,
    side,
    line,
  });
}

function trustedExactEvidenceValid(
  provenance: PropProbabilityProvenance,
  candidate?: ExactMarketCandidate | null,
): boolean {
  if (provenance.source !== "exact_market_10k") return false;
  const evidenceId = provenance.evidenceId;
  if (!evidenceId) return false;
  const trusted = trustedExactEvidence.get(evidenceId);
  if (!trusted) return false;
  if (
    provenance.hitProbability == null ||
    !Number.isFinite(provenance.hitProbability) ||
    provenance.simulations < EXACT_MARKET_10K_MIN_SIMULATIONS
  ) {
    return false;
  }
  const fromProv = resolveExactMarketIdentity({
    athleteId: provenance.athleteId,
    eventId: provenance.eventId,
    propMarketKey: provenance.marketKey,
    propSide: provenance.side,
    propLine: provenance.line,
  });
  if (!fromProv) return false;
  if (!identitiesMatch(fromProv, trusted)) return false;
  const expectedIntegrity = integrityFor({
    ...trusted,
    hitProbability: provenance.hitProbability,
    simulations: provenance.simulations,
  });
  if (expectedIntegrity !== trusted.integrity) return false;
  // Tamper check: provenance hit/sims must match registered evidence.
  if (
    provenance.hitProbability !== trusted.hitProbability ||
    provenance.simulations !== trusted.simulations
  ) {
    return false;
  }
  if (candidate) {
    const cand = resolveExactMarketIdentity(candidate);
    if (!cand || !identitiesMatch(cand, trusted)) return false;
  }
  return true;
}

/**
 * True when provenance authorizes seating. Exact-market requires live trusted
 * evidence + optional candidate identity match. Forged stamps fail closed.
 */
export function propProvenanceAllowsSeating(
  provenance: PropProbabilityProvenance | null | undefined,
  candidate?: ExactMarketCandidate | null,
): boolean {
  if (!provenance) return false;
  if (provenance.source === "insufficient_evidence") return false;
  if (provenance.hitProbability == null || !Number.isFinite(provenance.hitProbability)) {
    return false;
  }
  if (provenance.source === "exact_market_10k") {
    return trustedExactEvidenceValid(provenance, candidate);
  }
  if (provenance.source === "validated_historical_model") {
    return isValidatedHistoricalMarket(provenance.sport, provenance.marketKey);
  }
  return false;
}

/** Seating hit from provenance — null when not authorized (never invent). */
export function seatingHitFromProvenance(
  provenance: PropProbabilityProvenance | null | undefined,
  candidate?: ExactMarketCandidate | null,
): number | null {
  if (!propProvenanceAllowsSeating(provenance, candidate)) return null;
  return provenance!.hitProbability;
}

/**
 * Mint a derived exact-market stamp for a grade/clip/tilt adjustment.
 * Keeps the original batch simulation count and parent evidenceId — does not
 * imply another 10k Monte Carlo run (does not bump stampedExact10k).
 */
function mintAdjustedExactEvidence(opts: {
  parent: PropProbabilityProvenance;
  trusted: TrustedExactEvidence;
  identity: ExactMarketIdentity;
  adjustedHit: number;
  hitAdjustment: PropHitAdjustment;
}): PropProbabilityProvenance {
  const sims = opts.trusted.simulations;
  const rawHit =
    opts.parent.rawHitProbability ??
    opts.trusted.rawHitProbability ??
    opts.trusted.hitProbability;
  const parentId = opts.parent.evidenceId ?? null;
  const integrity = integrityFor({
    ...opts.identity,
    hitProbability: opts.adjustedHit,
    simulations: sims,
  });
  evidenceSeq += 1;
  const evidenceId = `tev_${evidenceSeq}_adj_${integrity.slice(0, 20)}`;
  trustedExactEvidence.set(evidenceId, {
    ...opts.identity,
    hitProbability: opts.adjustedHit,
    simulations: sims,
    integrity,
    parentEvidenceId: parentId,
    rawHitProbability: rawHit,
    hitAdjustment: opts.hitAdjustment,
  });
  coverageImpact.adjustedExact10k += 1;
  return {
    source: "exact_market_10k",
    hitProbability: opts.adjustedHit,
    simulations: sims,
    nullReason: null,
    hitReliability:
      opts.parent.hitReliability != null &&
      Number.isFinite(opts.parent.hitReliability)
        ? opts.parent.hitReliability
        : null,
    sport: opts.parent.sport ?? null,
    marketKey: opts.identity.marketKey,
    athleteId: opts.identity.athleteId,
    eventId: opts.identity.eventId,
    side: opts.identity.side,
    line: opts.identity.line,
    evidenceId,
    derivedFromEvidenceId: parentId,
    rawHitProbability: rawHit,
    hitAdjustment: opts.hitAdjustment,
  };
}

/**
 * Align provenance to a graded/clipped/adjusted hit.
 * Never mutates an existing exact-market stamp in place — mints a derived
 * adjustment that retains original sim lineage. Forged/missing evidence fails
 * closed. Edge/EV/grade/seating must share this returned provenance's hit.
 */
export function alignProvenanceToHit(
  provenance: PropProbabilityProvenance | null | undefined,
  hit: number | null,
  opts?: {
    nullReason?: string | null;
    hitAdjustment?: PropHitAdjustment | null;
  },
): PropProbabilityProvenance {
  if (hit == null || !Number.isFinite(hit)) {
    return insufficientPropProvenance({
      sport: provenance?.sport ?? null,
      marketKey: provenance?.marketKey ?? null,
      nullReason: opts?.nullReason ?? "adjusted_hit_null",
      hitReliability: provenance?.hitReliability ?? null,
      simulations: provenance?.simulations ?? 0,
      athleteId: provenance?.athleteId ?? null,
      eventId: provenance?.eventId ?? null,
      side: provenance?.side ?? null,
      line: provenance?.line ?? null,
    });
  }
  if (!provenance) {
    return insufficientPropProvenance({
      nullReason: opts?.nullReason ?? "missing_provenance",
    });
  }
  if (
    propProvenanceAllowsSeating(provenance) &&
    provenance.hitProbability === hit
  ) {
    return provenance;
  }
  if (provenance.source === "exact_market_10k") {
    const trusted = provenance.evidenceId
      ? trustedExactEvidence.get(provenance.evidenceId)
      : undefined;
    const identity = resolveExactMarketIdentity({
      athleteId: provenance.athleteId ?? trusted?.athleteId,
      eventId: provenance.eventId ?? trusted?.eventId,
      propMarketKey: provenance.marketKey ?? trusted?.marketKey,
      propSide: provenance.side ?? trusted?.side,
      propLine: provenance.line ?? trusted?.line,
    });
    if (!trusted || !identity || !identitiesMatch(identity, trusted)) {
      return insufficientPropProvenance({
        sport: provenance.sport,
        marketKey: provenance.marketKey,
        nullReason: opts?.nullReason ?? "untrusted_exact_adjustment",
        hitReliability: provenance.hitReliability,
        simulations: provenance.simulations,
        athleteId: provenance.athleteId,
        eventId: provenance.eventId,
        side: provenance.side,
        line: provenance.line,
      });
    }
    return mintAdjustedExactEvidence({
      parent: provenance,
      trusted,
      identity,
      adjustedHit: hit,
      hitAdjustment: opts?.hitAdjustment ?? "aligned",
    });
  }
  if (provenance.source === "validated_historical_model") {
    return historicalModelProvenance({
      hitProbability: hit,
      sport: provenance.sport,
      marketKey: provenance.marketKey,
      hitReliability: provenance.hitReliability,
      nullReason: opts?.nullReason,
      athleteId: provenance.athleteId,
      eventId: provenance.eventId,
      side: provenance.side,
      line: provenance.line,
    });
  }
  return insufficientPropProvenance({
    sport: provenance.sport,
    marketKey: provenance.marketKey,
    nullReason:
      provenance.nullReason ?? opts?.nullReason ?? "insufficient_evidence",
    hitReliability: provenance.hitReliability,
    simulations: provenance.simulations,
    athleteId: provenance.athleteId,
    eventId: provenance.eventId,
    side: provenance.side,
    line: provenance.line,
  });
}

/**
 * Prefer stronger authorized provenance. Never promote insufficient over a
 * valid exact/historical stamp. Never invent hits.
 */
export function preferPropProvenance(
  current: PropProbabilityProvenance | null | undefined,
  incoming: PropProbabilityProvenance | null | undefined,
  candidate?: ExactMarketCandidate | null,
): PropProbabilityProvenance {
  if (!incoming) {
    return current ?? insufficientPropProvenance({});
  }
  if (!current) return incoming;
  if (
    propProvenanceAllowsSeating(current, candidate) &&
    !propProvenanceAllowsSeating(incoming, candidate)
  ) {
    return current;
  }
  if (
    !propProvenanceAllowsSeating(current, candidate) &&
    propProvenanceAllowsSeating(incoming, candidate)
  ) {
    return incoming;
  }
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
 * Test / fixture helper — registers trusted exact 10k via the real factory.
 * Requires athleteId + eventId on the pick (fail closed otherwise).
 */
export function withExactMarket10kProvenance<
  T extends ExactMarketCandidate & {
    isProp?: boolean | null;
    sport?: string | null;
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
    athleteId: pick.athleteId,
    eventId: pick.eventId,
    side: pick.propSide ?? pick.side,
    line: pick.propLine ?? pick.line,
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

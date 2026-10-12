/**
 * Opportunity Shift engine — sync, in-memory, once per team/game.
 * Family-specific multipliers only; no player-wide mult; no I/O.
 */

import { aggregateFamilyMultiplier } from "./aggregate.js";
import {
  getOpportunityAdapter,
  confidenceWeightForVacancy,
  isLowConfidenceVacancy,
  type SportOpportunityAdapter,
} from "./adapters.js";
import { normalizeUsageWeights } from "./channelUsageFromHistory.js";
import {
  beneficiaryId,
  classifyVacancyConfirmation,
  normName,
  teamMatch,
  vacancyFingerprint,
  vacancyFractionForConfirmation,
} from "./confirmation.js";
import { explainFamilyShift } from "./explain.js";
import { isFamilyShiftAllowed, opportunityMarketFamily } from "./marketFamily.js";
import type {
  BeneficiaryUsageInput,
  ChannelContribution,
  FamilyShiftRow,
  InjuryVacancyInput,
  OpportunityShiftLookup,
  OpportunityShiftTable,
  VacancyRecord,
  WorkloadChannel,
} from "./types.js";

export type BuildOpportunityShiftOpts = {
  sport: string;
  gameKey: string;
  team: string;
  injuries: readonly InjuryVacancyInput[];
  beneficiaries: readonly BeneficiaryUsageInput[];
  /** Optional clock for tests. */
  nowMs?: number;
};

function emptyTable(
  sport: string,
  gameKey: string,
  team: string,
  nowMs: number,
): OpportunityShiftTable {
  return {
    sport,
    gameKey,
    team,
    builtAtMs: nowMs,
    vacancies: [],
    byBeneficiaryFamily: new Map(),
    suppressOwnInjuryFingerprints: new Set(),
    tableFingerprint: "none",
  };
}

function shareWeights(
  candidates: BeneficiaryUsageInput[],
  channel: WorkloadChannel,
  adapter: SportOpportunityAdapter,
): Map<string, number> {
  const allowed = adapter.beneficiaryRoles(channel);
  const roleCompatible = candidates.filter((b) =>
    allowed.includes(adapter.roleOf(b.position)),
  );
  // Prefer role-compatible beneficiaries. Only fall back to unknowns when
  // no role match exists (avoids kicking carries to PK/CB/etc.).
  const pool =
    roleCompatible.length > 0
      ? roleCompatible
      : candidates.filter((b) => {
          const role = adapter.roleOf(b.position);
          return role === "unknown" || allowed.includes(role);
        });

  if (!pool.length) return new Map();

  // Grounded hierarchy: weight_i = usage_i / Σ usage (with missing prior + caps).
  // Equal split only when no reliable usage exists on the pool.
  return normalizeUsageWeights(
    pool.map((b) => ({
      id: beneficiaryId(b.player, b.athleteId),
      usage: b.channelUsage?.[channel] ?? null,
      sampleSize: b.channelUsageSamples?.[channel] ?? 0,
    })),
  );
}

/** Normalize vacated units into a relative volume delta share for a beneficiary. */
function volumeDeltaFromShare(
  vacatedUnits: number,
  share: number,
  beneficiaryBaseline: number,
  leakage: number,
): number {
  if (vacatedUnits <= 0 || share <= 0) return 0;
  const gain = vacatedUnits * share * (1 - leakage);
  const base = Math.max(beneficiaryBaseline, vacatedUnits * 0.15, 0.5);
  // Relative volume increase; soft-cap raw before family aggregation.
  return Math.min(0.55, gain / base);
}

export function buildOpportunityShiftTable(
  opts: BuildOpportunityShiftOpts,
): OpportunityShiftTable {
  const sport = String(opts.sport ?? "").toLowerCase();
  const nowMs = opts.nowMs ?? Date.now();
  const adapter = getOpportunityAdapter(sport);
  if (adapter.noShift) {
    const t = emptyTable(sport, opts.gameKey, opts.team, nowMs);
    t.tableFingerprint = `no_shift:${sport}`;
    return t;
  }

  const teamBeneficiaries = opts.beneficiaries.filter((b) =>
    teamMatch(b.team, opts.team),
  );
  const teamInjuries = opts.injuries.filter((i) => teamMatch(i.team, opts.team));

  const vacancies: VacancyRecord[] = [];
  for (const inj of teamInjuries) {
    const confirmation = classifyVacancyConfirmation(inj.status);
    const frac = vacancyFractionForConfirmation(confirmation);
    if (frac <= 0) continue; // questionable / unknown / probable → no redistribution
    const role = adapter.roleOf(inj.position);
    // Prefer usage from matching beneficiary row (same player) when present.
    const self = teamBeneficiaries.find(
      (b) =>
        normName(b.player) === normName(inj.player) ||
        (b.athleteId && inj.athleteId && b.athleteId === inj.athleteId),
    );
    const channels = adapter.vacancyChannels(role, self?.channelUsage);
    const keys = Object.keys(channels) as WorkloadChannel[];
    if (!keys.length) continue;
    // Scale channel units by vacancy fraction.
    const scaled: Partial<Record<WorkloadChannel, number>> = {};
    for (const k of keys) {
      scaled[k] = (channels[k] ?? 0) * frac;
    }
    const fp = vacancyFingerprint({
      sport,
      gameKey: opts.gameKey,
      player: inj.player,
      athleteId: inj.athleteId,
      confirmation,
      channels: keys,
    });
    vacancies.push({
      fingerprint: fp,
      player: inj.player,
      athleteId: inj.athleteId ?? null,
      team: inj.team,
      position: inj.position ?? null,
      confirmation,
      vacancyFraction: frac,
      channels: scaled,
    });
  }

  if (!vacancies.length) {
    const t = emptyTable(sport, opts.gameKey, opts.team, nowMs);
    t.tableFingerprint = "empty";
    return t;
  }

  // Exclude confirmed-unavailable players from beneficiaries — even when their
  // role produces no vacancy channels (e.g. LB/DE/S). Otherwise IR/Out
  // non-skill players incorrectly absorb RB carry shares.
  const unavailable = new Set<string>();
  for (const inj of teamInjuries) {
    const frac = vacancyFractionForConfirmation(
      classifyVacancyConfirmation(inj.status),
    );
    if (frac > 0) unavailable.add(normName(inj.player));
  }
  const activeBeneficiaries = teamBeneficiaries.filter((b) => {
    if (unavailable.has(normName(b.player))) return false;
    const out = vacancies.some(
      (v) =>
        normName(v.player) === normName(b.player) ||
        (v.athleteId && b.athleteId && v.athleteId === b.athleteId),
    );
    return !out;
  });

  type Acc = {
    beneficiary: BeneficiaryUsageInput;
    family: string;
    contributions: ChannelContribution[];
    absent: Set<string>;
    teamScalar: boolean;
    lowConfidence: boolean;
  };
  const acc = new Map<string, Acc>(); // key = beneficiaryId|family

  const LEAKAGE = 0.18;

  for (const vac of vacancies) {
    const hasChannelMass = Object.values(vac.channels).some(
      (u) => u != null && u > 0,
    );
    // Real usage on the absent player row = grounded. Adapter fallback channel
    // mass alone stays low-confidence (±8% band) by design.
    const selfUsage = teamBeneficiaries.find(
      (b) => normName(b.player) === normName(vac.player),
    )?.channelUsage;
    const grounded = !!(selfUsage && Object.keys(selfUsage).length);
    const confW = confidenceWeightForVacancy(
      vac.confirmation === "out" ? "Out" : vac.confirmation,
      grounded || hasChannelMass,
    );
    const lowConf = isLowConfidenceVacancy(
      vac.confirmation === "out" ? "Out" : vac.confirmation,
      grounded,
    );

    for (const [channel, units] of Object.entries(vac.channels) as Array<
      [WorkloadChannel, number]
    >) {
      if (!units || units <= 0) continue;
      const shares = shareWeights(activeBeneficiaries, channel, adapter);
      const rules = adapter.familyRules(channel);
      const teamScalar = adapter.isTeamScalarChannel(channel);

      for (const b of activeBeneficiaries) {
        const bid = beneficiaryId(b.player, b.athleteId);
        const share = shares.get(bid) ?? 0;
        if (share <= 0) continue;
        const baseline = b.channelUsage?.[channel] ?? units * 0.35;
        const volDelta = volumeDeltaFromShare(units, share, baseline, LEAKAGE);
        if (Math.abs(volDelta) < 1e-6) continue;
        const pricedIn = Math.max(0, Math.min(1, b.pricedInFactor ?? 0));

        for (const rule of rules) {
          if (rule.kind === "X") continue;
          if (!isFamilyShiftAllowed(rule.family, sport)) continue;
          const key = `${bid}|${rule.family}`;
          let row = acc.get(key);
          if (!row) {
            row = {
              beneficiary: b,
              family: rule.family,
              contributions: [],
              absent: new Set(),
              teamScalar: false,
              lowConfidence: false,
            };
            acc.set(key, row);
          }
          row.absent.add(vac.player);
          row.teamScalar = row.teamScalar || teamScalar;
          row.lowConfidence = row.lowConfidence || lowConf;
          row.contributions.push({
            channel,
            volumeDelta: volDelta,
            elasticity: rule.elasticity,
            confidenceWeight: confW,
            pricedInFactor: pricedIn,
            vacancyFingerprint: vac.fingerprint,
            kind: rule.kind,
          });
        }
      }
    }
  }

  const byBeneficiaryFamily = new Map<string, Map<string, FamilyShiftRow>>();
  const suppress = new Set<string>();

  for (const row of acc.values()) {
    const agg = aggregateFamilyMultiplier(row.contributions, {
      lowConfidence: row.lowConfidence,
      teamScalar: row.teamScalar,
      vacancyCount: vacancies.length,
      family: row.family,
    });
    if (Math.abs(agg.multiplier - 1) < 0.005) continue;

    const bid = beneficiaryId(row.beneficiary.player, row.beneficiary.athleteId);
    const explanation = explainFamilyShift({
      absentPlayers: [...row.absent],
      beneficiaryName: row.beneficiary.player,
      family: row.family,
      multiplier: agg.multiplier,
      contributions: row.contributions,
    });

    const primaryFp =
      row.contributions[0]?.vacancyFingerprint ??
      vacancies[0]?.fingerprint ??
      "unknown";

    const out: FamilyShiftRow = {
      vacancyFingerprint: primaryFp,
      beneficiaryId: bid,
      beneficiaryName: row.beneficiary.player,
      family: row.family,
      volumeDelta: agg.volumeDelta,
      elasticity: agg.elasticity,
      confidenceWeight: agg.confidenceWeight,
      pricedInFactor: row.contributions[0]?.pricedInFactor ?? 0,
      finalFamilyMultiplier: agg.multiplier,
      explanation,
      contributions: row.contributions,
    };

    let famMap = byBeneficiaryFamily.get(bid);
    if (!famMap) {
      famMap = new Map();
      byBeneficiaryFamily.set(bid, famMap);
    }
    famMap.set(row.family, out);

    for (const c of row.contributions) {
      if ((1 - c.pricedInFactor) * Math.abs(c.volumeDelta) > 0.01) {
        suppress.add(c.vacancyFingerprint);
      }
    }
  }

  // Compact table fingerprint for shared-dist keys.
  const parts: string[] = [];
  for (const [bid, fams] of byBeneficiaryFamily) {
    for (const [fam, r] of fams) {
      parts.push(`${bid}:${fam}:${r.finalFamilyMultiplier.toFixed(3)}`);
    }
  }
  parts.sort();

  return {
    sport,
    gameKey: opts.gameKey,
    team: opts.team,
    builtAtMs: nowMs,
    vacancies,
    byBeneficiaryFamily,
    suppressOwnInjuryFingerprints: suppress,
    tableFingerprint: parts.length ? parts.join(";") : "empty",
  };
}

/** Merge home/away team tables for one game (reuse across candidates). */
export function mergeOpportunityShiftTables(
  tables: readonly OpportunityShiftTable[],
): OpportunityShiftTable {
  if (!tables.length) {
    return emptyTable("", "", "", Date.now());
  }
  if (tables.length === 1) return tables[0]!;
  const base = tables[0]!;
  const byBeneficiaryFamily = new Map<string, Map<string, FamilyShiftRow>>();
  const suppress = new Set<string>();
  const vacancies: VacancyRecord[] = [];
  const fpParts: string[] = [];

  for (const t of tables) {
    for (const v of t.vacancies) vacancies.push(v);
    for (const fp of t.suppressOwnInjuryFingerprints) suppress.add(fp);
    for (const [bid, fams] of t.byBeneficiaryFamily) {
      let m = byBeneficiaryFamily.get(bid);
      if (!m) {
        m = new Map();
        byBeneficiaryFamily.set(bid, m);
      }
      for (const [fam, row] of fams) {
        m.set(fam, row);
        fpParts.push(`${bid}:${fam}:${row.finalFamilyMultiplier.toFixed(3)}`);
      }
    }
  }
  fpParts.sort();
  return {
    sport: base.sport,
    gameKey: base.gameKey,
    team: "both",
    builtAtMs: base.builtAtMs,
    vacancies,
    byBeneficiaryFamily,
    suppressOwnInjuryFingerprints: suppress,
    tableFingerprint: fpParts.length ? fpParts.join(";") : "empty",
  };
}

export function lookupOpportunityShift(
  table: OpportunityShiftTable | null | undefined,
  opts: {
    player: string;
    athleteId?: string | null;
    market: string;
    sport?: string | null;
  },
): OpportunityShiftLookup {
  if (!table || table.tableFingerprint === "no_shift:" + String(opts.sport ?? table.sport).toLowerCase()) {
    if (table?.tableFingerprint?.startsWith("no_shift:")) {
      return {
        multiplier: 1,
        explanation: null,
        family: null,
        suppressOwnKeyInjuries: false,
        tableFingerprint: table.tableFingerprint,
      };
    }
  }
  if (!table || !table.byBeneficiaryFamily.size) {
    return {
      multiplier: 1,
      explanation: null,
      family: null,
      suppressOwnKeyInjuries: false,
      tableFingerprint: table?.tableFingerprint ?? "none",
    };
  }

  const family = opportunityMarketFamily(opts.market, opts.sport ?? table.sport);
  if (!family || !isFamilyShiftAllowed(family, opts.sport ?? table.sport)) {
    return {
      multiplier: 1,
      explanation: null,
      family,
      suppressOwnKeyInjuries: false,
      tableFingerprint: table.tableFingerprint,
    };
  }

  const bid = beneficiaryId(opts.player, opts.athleteId);
  let row = table.byBeneficiaryFamily.get(bid)?.get(family);
  if (!row) {
    // Name fallback when athleteId missing on one side.
    for (const [id, fams] of table.byBeneficiaryFamily) {
      if (id.startsWith("name:") && id === `name:${normName(opts.player)}`) {
        row = fams.get(family);
        break;
      }
      const sample = fams.values().next().value as FamilyShiftRow | undefined;
      if (sample && normName(sample.beneficiaryName) === normName(opts.player)) {
        row = fams.get(family);
        break;
      }
    }
  }
  if (!row) {
    return {
      multiplier: 1,
      explanation: null,
      family,
      suppressOwnKeyInjuries: false,
      tableFingerprint: table.tableFingerprint,
    };
  }

  return {
    multiplier: row.finalFamilyMultiplier,
    explanation: row.explanation,
    family,
    suppressOwnKeyInjuries: table.suppressOwnInjuryFingerprints.has(row.vacancyFingerprint),
    tableFingerprint: table.tableFingerprint,
  };
}

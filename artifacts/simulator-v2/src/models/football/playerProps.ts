/**
 * Phase C.2 / C.2.2 / C.2.3 — joint football player props with shared team budgets,
 * participation/injury grounding, DST + Q/H stats where provider markets exist.
 * Shadow-only; production serve remains off.
 *
 * C.2.2 calibration: multiplicative yard-budget shock (σ≈0.12) + val-fold
 * mean scales for pass/rush/rec after named-player OOS (proxy identity was
 * primary eval defect; holdout never used for coefficient fitting).
 *
 * C.2.3: role-aware anytime-TD intensity multipliers (qb/rb/wr/te), fitted on
 * chrono val only. Usage remains the snap / red-zone proxy when pregame
 * snap/RZ fields are absent. Bump FOOTBALL_PROP_MODEL_VERSION to 0.3.3 only
 * after frozen holdout improves any_td ECE+Brier+LogLoss without pass_yds
 * regression — otherwise keep 0.3.2 + identity multipliers.
 *
 * `propCalibrationProfile` selects prior (v0.2) vs current (v0.3.2) means/shock
 * for shadow A/B holdout only — default remains 0.3.2 yard means/shock.
 */

import type { SimV2ScenarioTensor } from "../../schemas/scenarioTensor.js";
import { createSeededRng, fingerprintPayload } from "../../seed/mulberry32.js";
import { poissonSample } from "./jointFootball.js";

/** Bump when prop generative assumptions change incompatibly for OOS. */
export const FOOTBALL_PROP_MODEL_VERSION = "0.3.3" as const;
/** Per-draw lognormal σ on pass/rush/rec team yard budgets (v0.3.2 profile). */
export const FOOTBALL_PROP_YARD_BUDGET_SHOCK_SIGMA = 0.12 as const;
/** Multiplier on generative TD intensities (pass/rush/rec → any_td). Default 1. */
export const FOOTBALL_PROP_TD_RATE_TEMPER = 1.0 as const;

/** Roles that receive anytime-TD intensity reweighting. */
export type FootballRoleTdKey = "qb" | "rb" | "wr" | "te" | "flex";

export type FootballRoleTdMultipliers = Record<FootballRoleTdKey, number>;

/** Identity = 0.3.2 generative TD rates (no role reweight) — shadow A/B baseline. */
export const FOOTBALL_PROP_ROLE_TD_MULTIPLIERS_IDENTITY: FootballRoleTdMultipliers = {
  qb: 1,
  rb: 1,
  wr: 1,
  te: 1,
  flex: 1,
};

/**
 * C.2.3 default role-TD intensity multipliers (val-fold fit, chronoSplits val only).
 * NFL 2023 + NCAAF 2024 w1–7 pooled; TE/flex inherit WR. Clamped [0.45, 1.85].
 */
export const FOOTBALL_PROP_ROLE_TD_MULTIPLIERS: FootballRoleTdMultipliers = {
  qb: 0.756,
  rb: 0.569,
  wr: 1.249,
  te: 1.249,
  flex: 1.249,
};

/** Clamp bounds so multipliers cannot invent missing-data extremes. */
export const FOOTBALL_PROP_ROLE_TD_MULT_MIN = 0.45 as const;
export const FOOTBALL_PROP_ROLE_TD_MULT_MAX = 1.85 as const;
/** Min role-n on val before fitting a multiplier (else leave 1). */
export const FOOTBALL_PROP_ROLE_TD_FIT_MIN_N = 40 as const;
/** Shrink fitted mult toward 1 to limit val overfit. */
export const FOOTBALL_PROP_ROLE_TD_FIT_SHRINK = 0.85 as const;

/** Shadow A/B prior (v0.2) vs calibrated (v0.3.2) yard-budget profile. */
export type PropCalibrationProfile = "v0.2" | "v0.3.2";

/**
 * Shadow-only generative overrides for val-fold probes (never fit on holdout).
 * Production path leaves these unset — defaults match 0.3.2.
 */
export type FootballPropEvalKnobs = {
  yardBudgetShockSigma?: number;
  /** Scale Poisson/Bernoulli TD intensities before any_td. */
  tdRateTemper?: number;
  /**
   * Role-aware anytime-TD intensity multipliers (C.2.3 shadow).
   * Partial overrides merge onto identity; unset roles stay 1.
   */
  roleTdMultipliers?: Partial<FootballRoleTdMultipliers>;
};

export function footballPropModelVersionForProfile(
  profile: PropCalibrationProfile = "v0.3.2",
): "0.2.0" | typeof FOOTBALL_PROP_MODEL_VERSION {
  // Calibrated yard profile (v0.3.2 means/shock) reports current prop model version.
  return profile === "v0.2" ? "0.2.0" : FOOTBALL_PROP_MODEL_VERSION;
}

/**
 * Fit a Bernoulli/Poisson-occurrence intensity multiplier so
 * P'≈1−(1−sim)^m ≈ actual. Returns 1 when n or rates are insufficient.
 */
export function fitRoleTdMultiplier(args: {
  simRate: number;
  actualRate: number;
  n: number;
  minN?: number;
  shrink?: number;
  minMult?: number;
  maxMult?: number;
}): number {
  const minN = args.minN ?? FOOTBALL_PROP_ROLE_TD_FIT_MIN_N;
  const shrink = args.shrink ?? FOOTBALL_PROP_ROLE_TD_FIT_SHRINK;
  const minMult = args.minMult ?? FOOTBALL_PROP_ROLE_TD_MULT_MIN;
  const maxMult = args.maxMult ?? FOOTBALL_PROP_ROLE_TD_MULT_MAX;
  if (args.n < minN) return 1;
  const s = args.simRate;
  const a = args.actualRate;
  if (!(s > 0.02 && s < 0.98 && a > 0.02 && a < 0.98)) return 1;
  // Avoid log(0) / log(1) pathologies.
  if (Math.abs(Math.log(1 - s)) < 1e-9) return 1;
  const raw = Math.log(1 - a) / Math.log(1 - s);
  if (!Number.isFinite(raw) || raw <= 0) return 1;
  const shrunk = 1 + shrink * (raw - 1);
  return Math.max(minMult, Math.min(maxMult, shrunk));
}

/** Pool role occurrence rates (e.g. NFL+NCAAF val) then fit multipliers. */
export function fitRoleTdMultipliersFromRoleRates(
  roles: Array<{ role: string; n: number; simMeanRate: number; actualOccurrenceRate: number }>,
): FootballRoleTdMultipliers {
  const pool = new Map<string, { n: number; simN: number; actN: number }>();
  for (const r of roles) {
    const key = r.role === "te" || r.role === "flex" ? "wr" : r.role;
    if (key !== "qb" && key !== "rb" && key !== "wr") continue;
    const cur = pool.get(key) ?? { n: 0, simN: 0, actN: 0 };
    cur.n += r.n;
    cur.simN += r.simMeanRate * r.n;
    cur.actN += r.actualOccurrenceRate * r.n;
    pool.set(key, cur);
  }
  const qb = pool.get("qb");
  const rb = pool.get("rb");
  const wr = pool.get("wr");
  const qbM = qb
    ? fitRoleTdMultiplier({
        simRate: qb.simN / qb.n,
        actualRate: qb.actN / qb.n,
        n: qb.n,
      })
    : 1;
  const rbM = rb
    ? fitRoleTdMultiplier({
        simRate: rb.simN / rb.n,
        actualRate: rb.actN / rb.n,
        n: rb.n,
      })
    : 1;
  const wrM = wr
    ? fitRoleTdMultiplier({
        simRate: wr.simN / wr.n,
        actualRate: wr.actN / wr.n,
        n: wr.n,
      })
    : 1;
  return { qb: qbM, rb: rbM, wr: wrM, te: wrM, flex: wrM };
}

export function resolveRoleTdMultipliers(
  knobs?: FootballPropEvalKnobs,
): FootballRoleTdMultipliers {
  const base = { ...FOOTBALL_PROP_ROLE_TD_MULTIPLIERS };
  if (!knobs?.roleTdMultipliers) return base;
  return {
    qb: knobs.roleTdMultipliers.qb ?? base.qb,
    rb: knobs.roleTdMultipliers.rb ?? base.rb,
    wr: knobs.roleTdMultipliers.wr ?? base.wr,
    te: knobs.roleTdMultipliers.te ?? base.te,
    flex: knobs.roleTdMultipliers.flex ?? base.flex,
  };
}

function roleTdIntensityScale(
  role: FootballPropRole,
  table: FootballRoleTdMultipliers,
): number {
  if (role === "qb" || role === "rb" || role === "wr" || role === "te" || role === "flex") {
    return table[role];
  }
  return 1;
}

function roleTdTableFingerprint(table: FootballRoleTdMultipliers): string {
  return `qb${table.qb.toFixed(3)}_rb${table.rb.toFixed(3)}_wr${table.wr.toFixed(3)}_te${table.te.toFixed(3)}_fx${table.flex.toFixed(3)}`;
}

function roleTdTableIsIdentity(table: FootballRoleTdMultipliers): boolean {
  return (
    table.qb === 1 &&
    table.rb === 1 &&
    table.wr === 1 &&
    table.te === 1 &&
    table.flex === 1
  );
}

export const FOOTBALL_PROP_STAT_KEYS = [
  "pass_yds",
  "pass_attempts",
  "pass_completions",
  "pass_tds",
  "rush_yds",
  "rush_attempts",
  "rush_tds",
  "rec_yds",
  "receptions",
  "reception_tds",
  "any_td",
  "kicking_points",
  "tackles_assists",
  "solo_tackles",
  "defensive_interceptions",
  // Period slices (provider QH keys) — joint with quarter team points.
  "pass_yds_q1",
  "pass_yds_h1",
  "rush_yds_q1",
  "rush_yds_h1",
  "rec_yds_q1",
  "rec_yds_h1",
  "pass_tds_q1",
] as const;

export type FootballPropStatKeyC2 = (typeof FOOTBALL_PROP_STAT_KEYS)[number];

export type FootballPropRole =
  | "qb"
  | "rb"
  | "wr"
  | "te"
  | "flex"
  | "k"
  | "dst_lb"
  | "dst_db";

export type FootballParticipationStatus =
  | "out"
  | "doubtful"
  | "questionable"
  | "probable"
  | "active"
  | "confirmed_starter";

export type FootballPropPlayerInput = {
  playerId: string;
  teamSide: "home" | "away";
  role: FootballPropRole;
  /** 0–1 share of team skill volume for this player's primary stat. */
  usage: number;
  /** Explicit participation; overrides role default when set. */
  participateProb?: number;
  /** Injury / roster grounding — OUT rejects settlement for this player. */
  participationStatus?: FootballParticipationStatus;
};

export type AttachFootballPlayerPropsInput = {
  tensor: SimV2ScenarioTensor;
  players: FootballPropPlayerInput[];
  propSeedSuffix?: string;
  /**
   * Yard-budget mean/shock profile for shadow A/B.
   * Default `"v0.3.2"` (current). `"v0.2"` restores pre-shock coeffs.
   */
  propCalibrationProfile?: PropCalibrationProfile;
  /** Val-fold / diagnose-only generative knobs (shadow). */
  propEvalKnobs?: FootballPropEvalKnobs;
};

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

function statusToParticipateProb(
  status: FootballParticipationStatus | undefined,
  fallback: number,
): number {
  switch (status) {
    case "out":
      return 0;
    case "doubtful":
      return 0.15;
    case "questionable":
      return 0.45;
    case "probable":
      return 0.8;
    case "confirmed_starter":
      return 0.97;
    case "active":
      return 0.92;
    default:
      return fallback;
  }
}

function teamYardBudget(
  points: number,
  kind: "pass" | "rush" | "rec",
  profile: PropCalibrationProfile,
): number {
  const pts = Math.max(0, points);
  if (profile === "v0.2") {
    // Pre-calibration C.1 / early C.2 means (no yard-budget shock).
    if (kind === "pass") return 8.5 * pts + 120;
    if (kind === "rush") return 3.2 * pts + 60;
    return 5.5 * pts + 80;
  }
  // C.2.2: val-fold mean scales (holdout unused). Pass slightly lower than C.1;
  // rush/rec scaled so game-leader means track ESPN leaders (shared-budget starters).
  if (kind === "pass") return 5.8 * pts + 90;
  if (kind === "rush") return 2.0 * pts + 40;
  return 3.6 * pts + 55;
}

/** Lognormal shock with E[m]≈1 so mean budget is preserved while variance rises. */
function yardBudgetShock(next: () => number, sigma: number = FOOTBALL_PROP_YARD_BUDGET_SHOCK_SIGMA): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = next();
  while (v === 0) v = next();
  const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  return Math.exp(sigma * z - 0.5 * sigma * sigma);
}

function emptyStats(n: number): Record<string, Float64Array> {
  const out: Record<string, Float64Array> = {};
  for (const k of FOOTBALL_PROP_STAT_KEYS) out[k] = new Float64Array(n);
  return out;
}

/**
 * Attach joint player props. Same-team skill players share pass/rush budgets
 * per draw so related outcomes stay correlated (no independent paste-on).
 */
export function attachFootballPlayerProps(input: AttachFootballPlayerPropsInput): SimV2ScenarioTensor {
  const base = input.tensor;
  const n = base.meta.nDraws;
  const profile: PropCalibrationProfile = input.propCalibrationProfile ?? "v0.3.2";
  // Yard means/shock stay on the 0.3.2 profile; version string may be 0.3.3 after C.2.3 promote.
  const modelVersion =
    profile === "v0.2" ? "0.2.0" : FOOTBALL_PROP_MODEL_VERSION;
  const useShock = profile === "v0.3.2";
  const shockSigma =
    input.propEvalKnobs?.yardBudgetShockSigma ?? FOOTBALL_PROP_YARD_BUDGET_SHOCK_SIGMA;
  const tdTemper = Math.max(
    0,
    input.propEvalKnobs?.tdRateTemper ?? FOOTBALL_PROP_TD_RATE_TEMPER,
  );
  const roleTdTable = resolveRoleTdMultipliers(input.propEvalKnobs);
  const roleTdFp = roleTdTableFingerprint(roleTdTable);
  const roleTdNonIdentity = !roleTdTableIsIdentity(roleTdTable);
  const knobsDiffer =
    shockSigma !== FOOTBALL_PROP_YARD_BUDGET_SHOCK_SIGMA ||
    tdTemper !== FOOTBALL_PROP_TD_RATE_TEMPER ||
    roleTdNonIdentity ||
    (input.propEvalKnobs?.roleTdMultipliers != null &&
      !roleTdTableIsIdentity(resolveRoleTdMultipliers(input.propEvalKnobs)));
  // Keep default seed stable so holdout A/B remains comparable; knob probes get a suffix.
  const seed = knobsDiffer
    ? `${base.meta.seed}|props|${input.propSeedSuffix ?? "c2.2"}|${profile}|s${shockSigma}|td${tdTemper}|rtd${roleTdFp}`
    : `${base.meta.seed}|props|${input.propSeedSuffix ?? "c2.2"}|${profile}`;
  const { next } = createSeededRng(seed);

  const players: SimV2ScenarioTensor["players"] = { ...base.players };
  const warnings = [
    ...base.meta.quality.warnings,
    "phase_c2_player_props_shadow",
    "shared_team_skill_budgets",
    `prop_calibration_profile_${profile}`,
    `football_prop_model_${modelVersion}`,
  ];
  if (useShock) {
    warnings.push(`prop_yard_budget_shock_${shockSigma}`);
  } else {
    warnings.push("prop_yard_budget_shock_none");
  }
  if (tdTemper !== FOOTBALL_PROP_TD_RATE_TEMPER) {
    warnings.push(`prop_td_rate_temper_${tdTemper}`);
  }
  if (roleTdNonIdentity) {
    warnings.push(`prop_role_td_mult_${roleTdFp}`);
  }
  const outPlayerIds: string[] = [];

  const bySide = {
    home: input.players.filter((p) => p.teamSide === "home"),
    away: input.players.filter((p) => p.teamSide === "away"),
  };

  for (const side of ["home", "away"] as const) {
    const roster = bySide[side];
    if (!roster.length) continue;

    const prepared = roster.map((p) => {
      const partP = statusToParticipateProb(
        p.participationStatus,
        clamp01(p.participateProb ?? (p.role.startsWith("dst") || p.role === "k" ? 0.95 : 0.92)),
      );
      if (p.participationStatus === "out") outPlayerIds.push(p.playerId);
      return {
        p,
        usage: clamp01(p.usage),
        partP,
        participated: new Uint8Array(n),
        stats: emptyStats(n),
      };
    });

    for (let i = 0; i < n; i++) {
      const teamPts = side === "home" ? base.team.homeFg[i]! : base.team.awayFg[i]!;
      const q1 = side === "home" ? base.team.homeByPeriod.q1![i]! : base.team.awayByPeriod.q1![i]!;
      const h1 = side === "home" ? base.team.homeByPeriod.h1![i]! : base.team.awayByPeriod.h1![i]!;
      const qShare = teamPts > 0 ? q1 / teamPts : 0.25;
      const hShare = teamPts > 0 ? h1 / teamPts : 0.5;

      const passShock = useShock ? yardBudgetShock(next, shockSigma) : 1;
      const rushShock = useShock ? yardBudgetShock(next, shockSigma) : 1;
      const recShock = useShock ? yardBudgetShock(next, shockSigma) : 1;
      const passBud = teamYardBudget(teamPts, "pass", profile) * passShock;
      const rushBud = teamYardBudget(teamPts, "rush", profile) * rushShock;
      const recBud = teamYardBudget(teamPts, "rec", profile) * recShock;

      // Participation draws first.
      for (const row of prepared) {
        row.participated[i] = row.partP > 0 && next() < row.partP ? 1 : 0;
      }

      const activeSkill = prepared.filter(
        (r) =>
          r.participated[i] &&
          (r.p.role === "qb" ||
            r.p.role === "rb" ||
            r.p.role === "wr" ||
            r.p.role === "te" ||
            r.p.role === "flex"),
      );
      const passUsageSum = Math.max(
        1e-6,
        activeSkill.filter((r) => r.p.role === "qb").reduce((s, r) => s + r.usage, 0),
      );
      const rushUsageSum = Math.max(
        1e-6,
        activeSkill
          .filter((r) => r.p.role === "rb" || r.p.role === "qb")
          .reduce((s, r) => s + r.usage * (r.p.role === "qb" ? 0.15 : 1), 0),
      );
      const recUsageSum = Math.max(
        1e-6,
        activeSkill
          .filter((r) => r.p.role === "wr" || r.p.role === "te" || r.p.role === "flex" || r.p.role === "rb")
          .reduce((s, r) => s + r.usage * (r.p.role === "rb" ? 0.35 : 1), 0),
      );

      // Sample team totals once, then allocate — joint correlation.
      const teamPassYds = poissonSample(passBud, next);
      const teamRushYds = poissonSample(rushBud, next);
      const teamRecYds = poissonSample(recBud, next);

      for (const row of prepared) {
        if (!row.participated[i]) continue;
        const { p, usage, stats } = row;
        // usage = snap / red-zone volume proxy when pregame RZ fields absent.
        const tdScale = tdTemper * roleTdIntensityScale(p.role, roleTdTable);

        if (p.role === "qb") {
          const share = usage / passUsageSum;
          stats.pass_yds[i] = Math.round(teamPassYds * share);
          stats.pass_attempts[i] = poissonSample(22 * usage + 8, next);
          stats.pass_completions[i] = Math.min(
            stats.pass_attempts[i]!,
            poissonSample(stats.pass_attempts[i]! * 0.64, next),
          );
          stats.pass_tds[i] = poissonSample(0.12 * teamPts * usage * tdScale, next);
          const rushShare = (usage * 0.15) / rushUsageSum;
          stats.rush_yds[i] = Math.round(teamRushYds * rushShare);
          stats.rush_attempts[i] = poissonSample(3 * usage, next);
          stats.any_td[i] =
            stats.pass_tds[i]! + stats.rush_tds[i]! > 0 ||
            next() < clamp01(0.03 * teamPts * usage * tdScale)
              ? 1
              : 0;
          stats.pass_yds_q1[i] = Math.round(stats.pass_yds[i]! * qShare);
          stats.pass_yds_h1[i] = Math.round(stats.pass_yds[i]! * hShare);
          stats.pass_tds_q1[i] = next() < qShare * clamp01(stats.pass_tds[i]! > 0 ? 0.7 : 0.05) ? 1 : 0;
          stats.rush_yds_q1[i] = Math.round(stats.rush_yds[i]! * qShare);
          stats.rush_yds_h1[i] = Math.round(stats.rush_yds[i]! * hShare);
        } else if (p.role === "rb") {
          const rushShare = usage / rushUsageSum;
          const recShare = (usage * 0.35) / recUsageSum;
          stats.rush_yds[i] = Math.round(teamRushYds * rushShare);
          stats.rush_attempts[i] = poissonSample(12 * usage + 4, next);
          stats.rush_tds[i] = poissonSample(0.08 * teamPts * usage * tdScale, next);
          stats.rec_yds[i] = Math.round(teamRecYds * recShare);
          stats.receptions[i] = poissonSample(2.2 * usage, next);
          stats.reception_tds[i] = next() < 0.04 * usage * teamPts * tdScale ? 1 : 0;
          stats.any_td[i] = stats.rush_tds[i]! + stats.reception_tds[i]! > 0 ? 1 : 0;
          stats.rush_yds_q1[i] = Math.round(stats.rush_yds[i]! * qShare);
          stats.rush_yds_h1[i] = Math.round(stats.rush_yds[i]! * hShare);
          stats.rec_yds_q1[i] = Math.round(stats.rec_yds[i]! * qShare);
          stats.rec_yds_h1[i] = Math.round(stats.rec_yds[i]! * hShare);
        } else if (p.role === "wr" || p.role === "te" || p.role === "flex") {
          const recShare = usage / recUsageSum;
          stats.rec_yds[i] = Math.round(teamRecYds * recShare);
          stats.receptions[i] = poissonSample(3.5 * usage, next);
          stats.reception_tds[i] = next() < 0.05 * usage * teamPts * tdScale ? 1 : 0;
          stats.rush_yds[i] = Math.round(teamRushYds * ((usage * 0.05) / rushUsageSum));
          stats.any_td[i] = stats.reception_tds[i]! > 0 ? 1 : 0;
          stats.rec_yds_q1[i] = Math.round(stats.rec_yds[i]! * qShare);
          stats.rec_yds_h1[i] = Math.round(stats.rec_yds[i]! * hShare);
          stats.rush_yds_q1[i] = Math.round(stats.rush_yds[i]! * qShare);
          stats.rush_yds_h1[i] = Math.round(stats.rush_yds[i]! * hShare);
        } else if (p.role === "k") {
          // NFL DST batch: player_kicking_points
          stats.kicking_points[i] = poissonSample(6 + 0.15 * teamPts, next);
        } else if (p.role === "dst_lb") {
          stats.tackles_assists[i] = poissonSample(6 + usage * 4, next);
          stats.solo_tackles[i] = poissonSample(3 + usage * 3, next);
        } else if (p.role === "dst_db") {
          stats.solo_tackles[i] = poissonSample(2 + usage * 2, next);
          stats.defensive_interceptions[i] = next() < 0.12 * usage ? 1 : 0;
          stats.tackles_assists[i] = poissonSample(3 + usage * 2, next);
        }
      }
    }

    for (const row of prepared) {
      players[row.p.playerId] = {
        participated: row.participated,
        stats: row.stats,
      };
    }
  }

  const dataFingerprint = fingerprintPayload(
    [
      base.meta.dataFingerprint,
      "football_props_c2_3",
      modelVersion,
      profile,
      useShock ? shockSigma : 0,
      tdTemper,
      roleTdFp,
      input.players,
      seed,
    ],
  );

  return {
    ...base,
    meta: {
      ...base.meta,
      dataFingerprint,
      playerStatKeys: [...FOOTBALL_PROP_STAT_KEYS],
      quality: {
        ...base.meta.quality,
        // Per-player OUT is handled at settle time — do not fail the whole tensor.
        participationReady: input.players.length > 0,
        warnings: [
          ...warnings,
          ...outPlayerIds.map((id) => `player_out_excluded:${id}`),
        ],
      },
    },
    players,
  };
}

/** True when player is roster-grounded for settlement (not OUT). */
export function playerSettlementAllowed(
  player: FootballPropPlayerInput | { participationStatus?: FootballParticipationStatus },
): boolean {
  return player.participationStatus !== "out";
}

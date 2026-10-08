/**
 * Phase C.2 / C.2.2 — joint football player props with shared team budgets,
 * participation/injury grounding, DST + Q/H stats where provider markets exist.
 * Shadow-only; production serve remains off.
 *
 * C.2.2 calibration: multiplicative yard-budget shock (σ≈0.12) + val-fold
 * mean scales for pass/rush/rec after named-player OOS (proxy identity was
 * primary eval defect; holdout never used for coefficient fitting).
 *
 * `propCalibrationProfile` selects prior (v0.2) vs current (v0.3.2) means/shock
 * for shadow A/B holdout only — default remains 0.3.2.
 */

import type { SimV2ScenarioTensor } from "../../schemas/scenarioTensor.js";
import { createSeededRng, fingerprintPayload } from "../../seed/mulberry32.js";
import { poissonSample } from "./jointFootball.js";

/** Bump when prop generative assumptions change incompatibly for OOS. */
export const FOOTBALL_PROP_MODEL_VERSION = "0.3.2" as const;
/** Per-draw lognormal σ on pass/rush/rec team yard budgets (v0.3.2 profile). */
export const FOOTBALL_PROP_YARD_BUDGET_SHOCK_SIGMA = 0.12 as const;
/** Multiplier on generative TD intensities (pass/rush/rec → any_td). Default 1. */
export const FOOTBALL_PROP_TD_RATE_TEMPER = 1.0 as const;

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
};

export function footballPropModelVersionForProfile(
  profile: PropCalibrationProfile = "v0.3.2",
): "0.2.0" | "0.3.2" {
  return profile === "v0.2" ? "0.2.0" : "0.3.2";
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
  const modelVersion = footballPropModelVersionForProfile(profile);
  const useShock = profile === "v0.3.2";
  const shockSigma =
    input.propEvalKnobs?.yardBudgetShockSigma ?? FOOTBALL_PROP_YARD_BUDGET_SHOCK_SIGMA;
  const tdTemper = Math.max(
    0,
    input.propEvalKnobs?.tdRateTemper ?? FOOTBALL_PROP_TD_RATE_TEMPER,
  );
  const knobsDiffer =
    shockSigma !== FOOTBALL_PROP_YARD_BUDGET_SHOCK_SIGMA ||
    tdTemper !== FOOTBALL_PROP_TD_RATE_TEMPER;
  // Keep default seed stable so holdout A/B remains comparable; knob probes get a suffix.
  const seed = knobsDiffer
    ? `${base.meta.seed}|props|${input.propSeedSuffix ?? "c2.2"}|${profile}|s${shockSigma}|td${tdTemper}`
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

        if (p.role === "qb") {
          const share = usage / passUsageSum;
          stats.pass_yds[i] = Math.round(teamPassYds * share);
          stats.pass_attempts[i] = poissonSample(22 * usage + 8, next);
          stats.pass_completions[i] = Math.min(
            stats.pass_attempts[i]!,
            poissonSample(stats.pass_attempts[i]! * 0.64, next),
          );
          stats.pass_tds[i] = poissonSample(0.12 * teamPts * usage * tdTemper, next);
          const rushShare = (usage * 0.15) / rushUsageSum;
          stats.rush_yds[i] = Math.round(teamRushYds * rushShare);
          stats.rush_attempts[i] = poissonSample(3 * usage, next);
          stats.any_td[i] =
            stats.pass_tds[i]! + stats.rush_tds[i]! > 0 ||
            next() < clamp01(0.03 * teamPts * usage * tdTemper)
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
          stats.rush_tds[i] = poissonSample(0.08 * teamPts * usage * tdTemper, next);
          stats.rec_yds[i] = Math.round(teamRecYds * recShare);
          stats.receptions[i] = poissonSample(2.2 * usage, next);
          stats.reception_tds[i] = next() < 0.04 * usage * teamPts * tdTemper ? 1 : 0;
          stats.any_td[i] = stats.rush_tds[i]! + stats.reception_tds[i]! > 0 ? 1 : 0;
          stats.rush_yds_q1[i] = Math.round(stats.rush_yds[i]! * qShare);
          stats.rush_yds_h1[i] = Math.round(stats.rush_yds[i]! * hShare);
          stats.rec_yds_q1[i] = Math.round(stats.rec_yds[i]! * qShare);
          stats.rec_yds_h1[i] = Math.round(stats.rec_yds[i]! * hShare);
        } else if (p.role === "wr" || p.role === "te" || p.role === "flex") {
          const recShare = usage / recUsageSum;
          stats.rec_yds[i] = Math.round(teamRecYds * recShare);
          stats.receptions[i] = poissonSample(3.5 * usage, next);
          stats.reception_tds[i] = next() < 0.05 * usage * teamPts * tdTemper ? 1 : 0;
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
    knobsDiffer
      ? [
          base.meta.dataFingerprint,
          "football_props_c2_2",
          modelVersion,
          profile,
          useShock ? shockSigma : 0,
          tdTemper,
          input.players,
          seed,
        ]
      : [
          base.meta.dataFingerprint,
          "football_props_c2_2",
          modelVersion,
          profile,
          useShock ? FOOTBALL_PROP_YARD_BUDGET_SHOCK_SIGMA : 0,
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

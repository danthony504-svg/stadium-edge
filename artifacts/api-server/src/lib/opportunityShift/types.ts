/**
 * Opportunity Shift — pre-sim workload redistribution types.
 * Family-specific only; never a player-wide multiplier.
 */

export const OPP_SHIFT_CAPS = {
  /** Normal beneficiary family uplift. */
  normalMax: 1.22,
  /** Absolute hard ceiling after aggregation. */
  absoluteMax: 1.28,
  /** Negative floor (usage stolen / demoted). */
  floor: 0.82,
  /** Low-confidence vacancy band (±8% → mult in [0.92, 1.08]). */
  lowConfidenceMaxDelta: 0.08,
  /** Team / OL / QB / pitcher scalars. */
  teamScalarMaxDelta: 0.12,
  /** Dampen when ≥2 simultaneous vacancies on same team. */
  multiVacancyDamp: 0.7,
  /**
   * Anytime TD with red-zone / goal-line channel support — still tighter than
   * yards so backups cannot become 70%+ scorers from vacancy alone.
   */
  anytimeTdWithRzMax: 1.1,
  /** Anytime TD without RZ/GL channels (targets/carries/designed-run only). */
  anytimeTdNoRzMax: 1.06,
} as const;

/** Injury confirmation for redistribution. */
export type VacancyConfirmation =
  | "out"
  | "doubtful"
  | "questionable"
  | "probable"
  | "unknown";

export type WorkloadChannel =
  // Football
  | "carries"
  | "rz_carries"
  | "gl_carries"
  | "targets"
  | "routes"
  | "pass_pro_snaps"
  | "pass_attempts"
  | "designed_runs"
  | "scramble_rate"
  | "pressure_allowed"
  // Basketball
  | "minutes"
  | "usage"
  | "fga"
  | "ast_opps"
  | "reb_opps"
  | "touch_share"
  // MLB
  | "pa"
  | "rbi_opps"
  | "run_opps"
  | "sb_opps"
  | "bf"
  | "ip"
  // NHL
  | "toi"
  | "pp_toi"
  | "line_role"
  | "shot_share"
  | "point_opps"
  | "opp_shot_volume"
  // Soccer
  | "shot_opps"
  | "sot_opps"
  | "set_piece_share"
  | "pk_duty";

/** How a channel feeds a market family. */
export type ChannelApplyKind = "V" | "E" | "X";

export type ChannelFamilyRule = {
  family: string;
  kind: ChannelApplyKind;
  /** Elasticity for E (and soft V→mean). Ignored when kind=X. */
  elasticity: number;
};

export type InjuryVacancyInput = {
  player: string;
  athleteId?: string | null;
  team: string;
  position?: string | null;
  status: string;
};

export type BeneficiaryUsageInput = {
  player: string;
  athleteId?: string | null;
  team: string;
  position?: string | null;
  /** Recent per-channel usage when known (from already-loaded history). */
  channelUsage?: Partial<Record<WorkloadChannel, number>>;
  /** Sample sizes (games count) parallel to channelUsage — for weak-evidence caps. */
  channelUsageSamples?: Partial<Record<WorkloadChannel, number>>;
  minutesL5?: number | null;
  minutesSeason?: number | null;
  /**
   * 0..1 — how much this absence is already priced into recent baseline.
   * 1 = fully priced-in (zero incremental redistribution).
   */
  pricedInFactor?: number;
};

export type VacancyRecord = {
  fingerprint: string;
  player: string;
  athleteId: string | null;
  team: string;
  position: string | null;
  confirmation: VacancyConfirmation;
  /** 1.0 out, 0.75 doubtful, 0 questionable+. */
  vacancyFraction: number;
  channels: Partial<Record<WorkloadChannel, number>>;
};

export type ChannelContribution = {
  channel: WorkloadChannel;
  volumeDelta: number;
  elasticity: number;
  confidenceWeight: number;
  pricedInFactor: number;
  vacancyFingerprint: string;
  kind: ChannelApplyKind;
};

export type FamilyShiftRow = {
  vacancyFingerprint: string;
  beneficiaryId: string;
  beneficiaryName: string;
  family: string;
  volumeDelta: number;
  elasticity: number;
  confidenceWeight: number;
  pricedInFactor: number;
  finalFamilyMultiplier: number;
  explanation: string;
  contributions: ChannelContribution[];
};

export type OpportunityShiftTable = {
  sport: string;
  gameKey: string;
  team: string;
  builtAtMs: number;
  vacancies: VacancyRecord[];
  /** beneficiaryId → family → row */
  byBeneficiaryFamily: Map<string, Map<string, FamilyShiftRow>>;
  /** Fingerprints that suppress own-team injury scalar. */
  suppressOwnInjuryFingerprints: Set<string>;
  /** Compact key for shared-dist cache. */
  tableFingerprint: string;
};

export type OpportunityShiftLookup = {
  multiplier: number;
  explanation: string | null;
  family: string | null;
  suppressOwnKeyInjuries: boolean;
  tableFingerprint: string;
};

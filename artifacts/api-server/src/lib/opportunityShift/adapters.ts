/**
 * Per-sport Opportunity Shift adapters.
 * Tennis / UFC return no_shift. Unsupported families stay X via marketFamily gate.
 */

import type { ChannelFamilyRule, WorkloadChannel } from "./types.js";
import type { InjuryVacancyInput, BeneficiaryUsageInput } from "./types.js";
import { classifyVacancyConfirmation, vacancyFractionForConfirmation } from "./confirmation.js";

export type RoleBucket =
  | "rb"
  | "wr"
  | "te"
  | "qb"
  | "ol"
  | "guard"
  | "wing"
  | "big"
  | "batter"
  | "pitcher"
  | "forward"
  | "defense"
  | "goalie"
  | "attacker"
  | "midfielder"
  | "unknown";

export type SportOpportunityAdapter = {
  sport: string;
  /** When true, engine always returns empty table (no_shift). */
  noShift: boolean;
  roleOf(position: string | null | undefined): RoleBucket;
  /** Vacated channel mass for a confirmed vacancy (before vacancyFraction). */
  vacancyChannels(
    role: RoleBucket,
    usage: Partial<Record<WorkloadChannel, number>> | undefined,
  ): Partial<Record<WorkloadChannel, number>>;
  /** Which roles can receive a channel. */
  beneficiaryRoles(channel: WorkloadChannel): RoleBucket[];
  /** Channel → family rules (V/E/X + elasticity). */
  familyRules(channel: WorkloadChannel): ChannelFamilyRule[];
  /** Team-level scalar channels (OL / pitcher staff). */
  isTeamScalarChannel(channel: WorkloadChannel): boolean;
};

function rules(rows: Array<[string, "V" | "E" | "X", number]>): ChannelFamilyRule[] {
  return rows.map(([family, kind, elasticity]) => ({ family, kind, elasticity }));
}

function baseUsage(
  usage: Partial<Record<WorkloadChannel, number>> | undefined,
  channel: WorkloadChannel,
  fallback: number,
): number {
  const v = usage?.[channel];
  return v != null && Number.isFinite(v) && v > 0 ? v : fallback;
}

const FOOTBALL_SHARED = {
  roleOf(position: string | null | undefined): RoleBucket {
    const p = String(position ?? "").toUpperCase();
    if (p === "QB") return "qb";
    if (p === "RB" || p === "FB" || p === "HB") return "rb";
    if (p === "WR") return "wr";
    if (p === "TE") return "te";
    if (["C", "G", "T", "OL", "OT", "OG", "LT", "RT", "LG", "RG"].includes(p)) return "ol";
    return "unknown";
  },
  vacancyChannels(
    role: RoleBucket,
    usage: Partial<Record<WorkloadChannel, number>> | undefined,
  ): Partial<Record<WorkloadChannel, number>> {
    if (role === "rb") {
      return {
        carries: baseUsage(usage, "carries", 14),
        rz_carries: baseUsage(usage, "rz_carries", 2.5),
        gl_carries: baseUsage(usage, "gl_carries", 1.2),
        targets: baseUsage(usage, "targets", 3),
        routes: baseUsage(usage, "routes", 18),
        pass_pro_snaps: baseUsage(usage, "pass_pro_snaps", 8),
      };
    }
    if (role === "wr" || role === "te") {
      return {
        targets: baseUsage(usage, "targets", role === "te" ? 5 : 7),
        routes: baseUsage(usage, "routes", role === "te" ? 22 : 28),
      };
    }
    if (role === "qb") {
      return {
        pass_attempts: baseUsage(usage, "pass_attempts", 32),
        designed_runs: baseUsage(usage, "designed_runs", 3),
        scramble_rate: baseUsage(usage, "scramble_rate", 0.08),
      };
    }
    if (role === "ol") {
      return { pressure_allowed: 1 };
    }
    return {};
  },
  beneficiaryRoles(channel: WorkloadChannel): RoleBucket[] {
    switch (channel) {
      case "carries":
        return ["rb"];
      case "rz_carries":
      case "gl_carries":
        return ["rb", "qb"];
      case "targets":
      case "routes":
        return ["rb", "wr", "te"];
      case "pass_pro_snaps":
        return ["rb", "te"];
      case "pass_attempts":
        return ["qb"];
      case "designed_runs":
      case "scramble_rate":
        return ["qb"];
      case "pressure_allowed":
        return ["qb", "rb"]; // team scalar applied via isTeamScalarChannel
      default:
        return [];
    }
  },
  familyRules(channel: WorkloadChannel): ChannelFamilyRule[] {
    switch (channel) {
      case "carries":
        return rules([
          ["rush_attempts", "V", 1],
          ["rush_yds", "E", 0.7],
          ["rush_longest", "E", 0.15],
          ["rush_reception_yds", "E", 0.35],
        ]);
      case "rz_carries":
      case "gl_carries":
        return rules([
          ["rush_attempts", "V", 0.35],
          ["rush_yds", "E", 0.25],
          ["anytime_td", "E", 0.65],
          ["first_td", "E", 0.55],
        ]);
      case "targets":
        // targets → target volume is internal V; receptions use catch conversion (E)
        return rules([
          ["receptions", "E", 0.75],
          ["rec_yds", "E", 0.65],
          ["rec_longest", "E", 0.15],
          ["anytime_td", "E", 0.25],
          ["rush_reception_yds", "E", 0.4],
        ]);
      case "routes":
        return rules([
          ["receptions", "E", 0.35],
          ["rec_yds", "E", 0.4],
        ]);
      case "pass_attempts":
        return rules([
          ["pass_attempts", "V", 1],
          ["pass_completions", "E", 0.75],
          ["pass_yds", "E", 0.7],
          ["pass_tds", "E", 0.5],
          ["pass_interceptions", "E", 0.4],
          ["rec_yds", "E", 0.25],
          ["receptions", "E", 0.25],
        ]);
      case "designed_runs":
      case "scramble_rate":
        return rules([
          ["rush_attempts", "V", 0.85],
          ["rush_yds", "E", 0.65],
          ["anytime_td", "E", 0.45],
          ["pass_yds", "E", -0.08],
          ["pass_attempts", "E", -0.08],
        ]);
      case "pressure_allowed":
        return rules([
          ["pass_yds", "E", -0.35],
          ["pass_completions", "E", -0.3],
          ["pass_tds", "E", -0.25],
          ["pass_interceptions", "E", 0.2],
          ["sacks", "E", 0.35],
          ["rush_yds", "E", -0.2],
          ["rush_attempts", "E", -0.15],
        ]);
      case "pass_pro_snaps":
        return rules([
          ["sacks", "E", -0.1],
        ]);
      default:
        return [];
    }
  },
  isTeamScalarChannel(channel: WorkloadChannel): boolean {
    return channel === "pressure_allowed";
  },
} satisfies Omit<SportOpportunityAdapter, "sport" | "noShift">;

export const nflAdapter: SportOpportunityAdapter = {
  sport: "nfl",
  noShift: false,
  ...FOOTBALL_SHARED,
};

export const ncaafAdapter: SportOpportunityAdapter = {
  sport: "ncaaf",
  noShift: false,
  ...FOOTBALL_SHARED,
  familyRules(channel: WorkloadChannel): ChannelFamilyRule[] {
    // Strip sacks (non-seatable on NCAAF).
    return FOOTBALL_SHARED.familyRules(channel).filter((r) => r.family !== "sacks");
  },
};

const BASKETBALL_SHARED = {
  roleOf(position: string | null | undefined): RoleBucket {
    const p = String(position ?? "").toUpperCase();
    if (["C", "PF", "F-C", "C-F"].includes(p)) return "big";
    if (["SF", "GF", "F", "F-G"].includes(p)) return "wing";
    if (["PG", "SG", "G", "G-F"].includes(p)) return "guard";
    return "unknown";
  },
  vacancyChannels(
    role: RoleBucket,
    usage: Partial<Record<WorkloadChannel, number>> | undefined,
  ): Partial<Record<WorkloadChannel, number>> {
    const minutes = baseUsage(usage, "minutes", role === "big" ? 28 : 30);
    const out: Partial<Record<WorkloadChannel, number>> = {
      minutes,
      usage: baseUsage(usage, "usage", 0.22),
      fga: baseUsage(usage, "fga", 12),
      touch_share: baseUsage(usage, "touch_share", 0.18),
    };
    if (role === "big") {
      out.reb_opps = baseUsage(usage, "reb_opps", 8);
      out.ast_opps = baseUsage(usage, "ast_opps", 2);
    } else if (role === "guard") {
      out.ast_opps = baseUsage(usage, "ast_opps", 6);
      out.reb_opps = baseUsage(usage, "reb_opps", 3);
    } else {
      out.ast_opps = baseUsage(usage, "ast_opps", 3);
      out.reb_opps = baseUsage(usage, "reb_opps", 5);
    }
    return out;
  },
  beneficiaryRoles(channel: WorkloadChannel): RoleBucket[] {
    switch (channel) {
      case "reb_opps":
        return ["big", "wing"];
      case "ast_opps":
        return ["guard", "wing"];
      case "minutes":
      case "usage":
      case "fga":
      case "touch_share":
        return ["guard", "wing", "big"];
      default:
        return [];
    }
  },
  familyRules(channel: WorkloadChannel): ChannelFamilyRule[] {
    switch (channel) {
      case "minutes":
        return rules([
          ["points", "E", 0.55],
          ["threes", "E", 0.45],
          ["rebounds", "E", 0.5],
          ["assists", "E", 0.45],
          ["blocks", "E", 0.4],
          ["steals", "E", 0.4],
          ["turnovers", "E", 0.45],
          ["pra", "E", 0.5],
          ["pr", "E", 0.5],
          ["pa", "E", 0.5],
          ["ra", "E", 0.45],
          ["double_double", "E", 0.35],
        ]);
      case "usage":
      case "fga":
        return rules([
          ["points", "E", 0.7],
          ["threes", "E", 0.6],
          ["pra", "E", 0.45],
          ["pr", "E", 0.4],
          ["pa", "E", 0.4],
          ["turnovers", "E", 0.2],
          ["double_double", "E", 0.25],
        ]);
      case "ast_opps":
        return rules([
          ["assists", "E", 0.8],
          ["pa", "E", 0.45],
          ["ra", "E", 0.4],
          ["pra", "E", 0.35],
          ["double_double", "E", 0.25],
        ]);
      case "reb_opps":
        return rules([
          ["rebounds", "E", 0.8],
          ["pr", "E", 0.45],
          ["ra", "E", 0.4],
          ["pra", "E", 0.35],
          ["double_double", "E", 0.3],
        ]);
      case "touch_share":
        return rules([
          ["points", "E", 0.35],
          ["threes", "E", 0.25],
          ["assists", "E", 0.3],
        ]);
      default:
        return [];
    }
  },
  isTeamScalarChannel(): boolean {
    return false;
  },
} satisfies Omit<SportOpportunityAdapter, "sport" | "noShift">;

export const nbaAdapter: SportOpportunityAdapter = {
  sport: "nba",
  noShift: false,
  ...BASKETBALL_SHARED,
};

export const wnbaAdapter: SportOpportunityAdapter = {
  sport: "wnba",
  noShift: false,
  ...BASKETBALL_SHARED,
};

export const mlbAdapter: SportOpportunityAdapter = {
  sport: "mlb",
  noShift: false,
  roleOf(position: string | null | undefined): RoleBucket {
    const p = String(position ?? "").toUpperCase();
    if (["SP", "RP", "CP", "CL", "P"].includes(p)) return "pitcher";
    return "batter";
  },
  vacancyChannels(role, usage) {
    if (role === "pitcher") {
      return {
        bf: baseUsage(usage, "bf", 22),
        ip: baseUsage(usage, "ip", 5.5),
      };
    }
    return {
      pa: baseUsage(usage, "pa", 4.2),
      rbi_opps: baseUsage(usage, "rbi_opps", 0.6),
      run_opps: baseUsage(usage, "run_opps", 0.55),
      sb_opps: baseUsage(usage, "sb_opps", 0.15),
    };
  },
  beneficiaryRoles(channel) {
    if (channel === "bf" || channel === "ip") return ["pitcher"];
    return ["batter"];
  },
  familyRules(channel) {
    switch (channel) {
      case "pa":
        return rules([
          ["hits", "E", 0.55],
          ["total_bases", "E", 0.5],
          ["home_runs", "E", 0.35],
          ["rbis", "E", 0.4],
          ["runs", "E", 0.45],
          ["hits_runs_rbis", "E", 0.45],
          ["stolen_bases", "E", 0.3],
        ]);
      case "rbi_opps":
        return rules([
          ["rbis", "E", 0.7],
          ["hits_runs_rbis", "E", 0.4],
          ["home_runs", "E", 0.15],
        ]);
      case "run_opps":
        return rules([
          ["runs", "E", 0.7],
          ["hits_runs_rbis", "E", 0.4],
        ]);
      case "sb_opps":
        return rules([["stolen_bases", "E", 0.85]]);
      case "bf":
      case "ip":
        return rules([
          ["strikeouts", "E", 0.75],
          ["outs", "E", 0.85],
        ]);
      default:
        return [];
    }
  },
  isTeamScalarChannel(channel) {
    return channel === "bf" || channel === "ip";
  },
};

export const nhlAdapter: SportOpportunityAdapter = {
  sport: "nhl",
  noShift: false,
  roleOf(position) {
    const p = String(position ?? "").toUpperCase();
    if (p === "G") return "goalie";
    if (["D", "LD", "RD"].includes(p)) return "defense";
    return "forward";
  },
  vacancyChannels(role, usage) {
    if (role === "goalie") {
      // Saves require opp shot volume — not teammate vacancy redistribution.
      return {};
    }
    return {
      toi: baseUsage(usage, "toi", role === "defense" ? 20 : 16),
      pp_toi: baseUsage(usage, "pp_toi", 2.2),
      line_role: 1,
      shot_share: baseUsage(usage, "shot_share", 2.5),
      point_opps: baseUsage(usage, "point_opps", 0.7),
    };
  },
  beneficiaryRoles(channel) {
    if (channel === "opp_shot_volume") return ["goalie"];
    return ["forward", "defense"];
  },
  familyRules(channel) {
    switch (channel) {
      case "toi":
        return rules([
          ["shots_on_goal", "E", 0.6],
          ["goals", "E", 0.4],
          ["assists", "E", 0.4],
          ["points", "E", 0.45],
        ]);
      case "pp_toi":
        return rules([
          ["shots_on_goal", "E", 0.35],
          ["goals", "E", 0.55],
          ["assists", "E", 0.5],
          ["points", "E", 0.5],
        ]);
      case "line_role":
        return rules([
          ["shots_on_goal", "E", 0.3],
          ["goals", "E", 0.3],
          ["assists", "E", 0.3],
          ["points", "E", 0.35],
        ]);
      case "shot_share":
        return rules([
          ["shots_on_goal", "E", 0.85],
          ["goals", "E", 0.45],
          ["points", "E", 0.25],
        ]);
      case "point_opps":
        return rules([
          ["goals", "E", 0.5],
          ["assists", "E", 0.55],
          ["points", "E", 0.55],
        ]);
      case "opp_shot_volume":
        // saves non-seatable → no rules that pass the gate
        return rules([["saves", "X", 0]]);
      default:
        return [];
    }
  },
  isTeamScalarChannel(): boolean {
    return false;
  },
};

export const soccerAdapter: SportOpportunityAdapter = {
  sport: "soccer",
  noShift: false,
  roleOf(position) {
    const p = String(position ?? "").toUpperCase();
    if (p === "G" || p === "GK") return "goalie";
    if (["D", "DF", "CB", "LB", "RB"].includes(p)) return "defense";
    if (["M", "MF", "CM", "CDM", "CAM", "LM", "RM"].includes(p)) return "midfielder";
    return "attacker";
  },
  vacancyChannels(role, usage) {
    if (role === "goalie") return {};
    return {
      minutes: baseUsage(usage, "minutes", 75),
      shot_opps: baseUsage(usage, "shot_opps", role === "attacker" ? 2.5 : 1),
      sot_opps: baseUsage(usage, "sot_opps", role === "attacker" ? 1.1 : 0.4),
      set_piece_share: baseUsage(usage, "set_piece_share", 0.15),
    };
  },
  beneficiaryRoles(channel) {
    if (channel === "pk_duty") return ["attacker", "midfielder"];
    return ["attacker", "midfielder", "defense"];
  },
  familyRules(channel) {
    switch (channel) {
      case "minutes":
        return rules([
          ["shots", "E", 0.55],
          ["shots_on_target", "E", 0.5],
          ["anytime_goal", "E", 0.4],
          ["first_goal", "E", 0.35],
        ]);
      case "shot_opps":
        return rules([
          ["shots", "V", 1],
          ["shots_on_target", "E", 0.7],
          ["anytime_goal", "E", 0.45],
          ["first_goal", "E", 0.4],
        ]);
      case "sot_opps":
        return rules([
          ["shots_on_target", "V", 1],
          ["anytime_goal", "E", 0.55],
          ["first_goal", "E", 0.45],
        ]);
      case "set_piece_share":
        return rules([
          ["shots", "E", 0.3],
          ["shots_on_target", "E", 0.3],
          ["anytime_goal", "E", 0.5],
        ]);
      case "pk_duty":
        return rules([
          ["anytime_goal", "E", 0.4],
          ["first_goal", "E", 0.35],
        ]);
      default:
        return [];
    }
  },
  isTeamScalarChannel(): boolean {
    return false;
  },
};

export const tennisAdapter: SportOpportunityAdapter = {
  sport: "tennis",
  noShift: true,
  roleOf: () => "unknown",
  vacancyChannels: () => ({}),
  beneficiaryRoles: () => [],
  familyRules: () => [],
  isTeamScalarChannel: () => false,
};

export const ufcAdapter: SportOpportunityAdapter = {
  sport: "ufc",
  noShift: true,
  roleOf: () => "unknown",
  vacancyChannels: () => ({}),
  beneficiaryRoles: () => [],
  familyRules: () => [],
  isTeamScalarChannel: () => false,
};

const ADAPTERS: Record<string, SportOpportunityAdapter> = {
  nfl: nflAdapter,
  ncaaf: ncaafAdapter,
  nba: nbaAdapter,
  wnba: wnbaAdapter,
  mlb: mlbAdapter,
  nhl: nhlAdapter,
  soccer: soccerAdapter,
  tennis: tennisAdapter,
  ufc: ufcAdapter,
  mma: { ...ufcAdapter, sport: "mma" },
};

export function getOpportunityAdapter(sport: string | null | undefined): SportOpportunityAdapter {
  const s = String(sport ?? "").toLowerCase();
  return ADAPTERS[s] ?? {
    sport: s || "unknown",
    noShift: true,
    roleOf: () => "unknown",
    vacancyChannels: () => ({}),
    beneficiaryRoles: () => [],
    familyRules: () => [],
    isTeamScalarChannel: () => false,
  };
}

/** Confidence weight from confirmation + whether usage was grounded. */
export function confidenceWeightForVacancy(
  status: string,
  hasGroundedUsage: boolean,
): number {
  const conf = classifyVacancyConfirmation(status);
  const frac = vacancyFractionForConfirmation(conf);
  if (frac <= 0) return 0;
  let w = conf === "out" ? 1 : 0.75;
  if (!hasGroundedUsage) w *= 0.55; // low-confidence vacancy
  return w;
}

export function isLowConfidenceVacancy(
  status: string,
  hasGroundedUsage: boolean,
): boolean {
  return confidenceWeightForVacancy(status, hasGroundedUsage) < 0.7;
}

/** Export for tests — detect vacancies without building full table. */
export function detectVacancyFraction(status: string): number {
  return vacancyFractionForConfirmation(classifyVacancyConfirmation(status));
}

export type { InjuryVacancyInput, BeneficiaryUsageInput };

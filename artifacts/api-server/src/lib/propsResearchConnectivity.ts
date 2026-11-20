/**
 * Evidence-backed connectivity of Coach player-prop research inputs.
 * Status describes the LIVE sim → grade → seating path — not whether data is fetched.
 */
export type ResearchConnectivity =
  | "connected"
  | "partial"
  | "missing"
  | "unavailable"
  | "shadow_only";

export type PropsResearchPriorityItem = {
  id: number;
  name: string;
  status: ResearchConnectivity;
  /** Source → normalized → simulation → grade → Coach selection */
  path: string;
  notes: string;
  sports: string[];
  providerAccess: string[];
  predictiveValidationRequired: boolean;
};

export const PROPS_RESEARCH_PRIORITIES: readonly PropsResearchPriorityItem[] = [
  {
    id: 1,
    name: "Playing opportunity",
    status: "partial",
    path:
      "ESPN gamelog → channelUsage/Opp Shift + enrichment minutesTrend → MC mean (usage) / holistic playingTime → Coach seat",
    notes:
      "Carries/targets/routes/TOI/FGA feed Opportunity Shift when ESPN labels exist. minutesTrend reaches holistic grading and playerHistories but is stripped from toPropSimHistoryShape so MC minutes multipliers stay off. Snaps often empty; expectedTargets null on hot path.",
    sports: ["nfl", "ncaaf", "nba", "wnba", "nhl", "mlb", "soccer"],
    providerAccess: ["ESPN public game logs"],
    predictiveValidationRequired: true,
  },
  {
    id: 2,
    name: "Injuries",
    status: "connected",
    path:
      "ESPN injuries → confirmed OUT null-row + team injury weights + Opp Shift redistribution → MC mean / availability gate → Coach seat",
    notes:
      "Confirmed absences null the prop. Soft own/opp injury weights nudge means. Doubtful/questionable are not treated as OUT. Redistribution only when vacancy confirmation + same-family usage exist.",
    sports: ["nfl", "ncaaf", "nba", "wnba", "nhl", "mlb", "soccer"],
    providerAccess: ["ESPN injuries feed"],
    predictiveValidationRequired: false,
  },
  {
    id: 3,
    name: "Opponents (role defense / pace)",
    status: "partial",
    path:
      "StatMuse pace (NBA/WNBA) + vs-opp series + optional defenseIndexByFamily → MC matchup/pace → grade → Coach",
    notes:
      "Pace connected for NBA/WNBA. Defense packs map to defenseIndexByFamily but Coach deep seating does not send them (Stage-4 shadow only). Live falls back to vs-opp n≥3 or 1.0.",
    sports: ["nba", "wnba", "nfl", "ncaaf", "nhl", "mlb"],
    providerAccess: ["StatMuse pace", "internal defense packs", "ESPN vs-opponent samples"],
    predictiveValidationRequired: true,
  },
  {
    id: 4,
    name: "Role changes",
    status: "partial",
    path:
      "Prepared lineups (MLB/soccer) + Opp Shift workload → availability / MC → Coach",
    notes:
      "MLB/soccer confirmed nonstarters gated when lineup complete. NFL depth charts are prepared but unused for prop availability. No snap-share upgrade model for football.",
    sports: ["mlb", "soccer", "nfl", "ncaaf", "nba", "wnba"],
    providerAccess: ["ESPN lineups / depth charts"],
    predictiveValidationRequired: true,
  },
  {
    id: 5,
    name: "Prices (book / market / side / line / odds / timestamp)",
    status: "connected",
    path:
      "The Odds API → props catalog stamps over/under book + sourceUpdatedAt → seating identity / provenance (not MC feature) → Coach",
    notes:
      "Exact sportsbook, market, side, line, odds, and source update timestamps are required for seating/provenance. They do not enter buildProjectionMean.",
    sports: ["nfl", "ncaaf", "nba", "wnba", "ncaab", "mlb", "nhl", "soccer"],
    providerAccess: ["The Odds API (paid credits)"],
    predictiveValidationRequired: false,
  },
  {
    id: 6,
    name: "Game environment (spread / total / blowout / script)",
    status: "missing",
    path: "Odds game lines exist for board markets → NOT wired into PropSimulationContext",
    notes:
      "No spread/total/blowout/gameScript fields on prop MC. Blowout caution exists in chat prompts only.",
    sports: ["nfl", "ncaaf", "nba", "wnba", "mlb", "nhl"],
    providerAccess: ["The Odds API game lines"],
    predictiveValidationRequired: true,
  },
  {
    id: 7,
    name: "Advanced matchups (depth / coverage / assignments)",
    status: "partial",
    path:
      "Prepared depthCharts + vs-opp + QB←WR coupling → depth unused in availability; coupling → MC → Coach",
    notes:
      "Coverage schemes and defender assignments unavailable. Depth charts are evidence-only until confirmation rules exist — never invent workload from depth order.",
    sports: ["nfl", "ncaaf", "nba", "mlb"],
    providerAccess: ["ESPN depth charts"],
    predictiveValidationRequired: true,
  },
  {
    id: 8,
    name: "Rest / venue / travel / weather",
    status: "partial",
    path:
      "Home/away series → venueShift → MC; OpenWeather prepared env → holistic weather score; MC weatherImpact only if request supplies or holdout apply flag",
    notes:
      "Venue shift connected. Rest/B2B/travel missing. Prepared weather was fetched but not mapped into prop MC; shadow mapper now attaches evidence without enabling for subscribers by default.",
    sports: ["mlb", "nfl", "ncaaf", "soccer", "tennis", "nba", "wnba", "nhl"],
    providerAccess: ["OpenWeatherMap API key", "ESPN venue / home-away splits"],
    predictiveValidationRequired: true,
  },
  {
    id: 9,
    name: "Prop-specific volume inputs",
    status: "partial",
    path:
      "ESPN labels → propStatValue / channelUsage → MC mean + Opp Shift → grade → Coach",
    notes:
      "Markets map when labels exist. Routes/RZ/goal-line often missing. Period series guarded for full-game markets. First TD / first goalscorer blocked without scoring order.",
    sports: ["nfl", "ncaaf", "nba", "wnba", "mlb", "nhl", "soccer"],
    providerAccess: ["ESPN public stats"],
    predictiveValidationRequired: false,
  },
  {
    id: 10,
    name: "Correlation and uncertainty",
    status: "partial",
    path:
      "Ticket correlation penalty + same-game caps → seating; shared-draw fingerprint → MC identity; no joint player-player SGP draw",
    notes:
      "Correlation enforced at ticket layer. Uncertainty via sample-size nulls and confidenceFromHit — no calibrated uncertainty model. Thin/unstable roles fail closed when evidence missing.",
    sports: ["all Coach sports"],
    providerAccess: [],
    predictiveValidationRequired: true,
  },
] as const;

export type PropsResearchRuntimeSnapshot = {
  checkedAt: string;
  researchOnlyFlags: {
    applyPreparedWeatherImpactDefault: false;
    minutesTrendInPropSimShape: false;
    defenseIndexSeating: "shadow_only";
    ncaafReleaseGatesUnchanged: true;
  };
  priorities: readonly PropsResearchPriorityItem[];
  runtime: {
    sport: string;
    weatherImpactApplied: number | null;
    weatherResearchReason: string | null;
    defenseIndexByFamilyKeys: number;
    preparedWeatherPresent: boolean;
    preparedDepthCharts: number;
    preparedLineupsComplete: number;
    opportunityShiftPresent: boolean;
  };
};

export function buildPropsResearchRuntimeSnapshot(input: {
  sport: string;
  weatherImpactApplied: number | null;
  weatherResearchReason?: string | null;
  defenseIndexByFamily?: Record<string, number> | null;
  preparedWeatherPresent?: boolean;
  preparedDepthCharts?: number;
  preparedLineupsComplete?: number;
  opportunityShiftPresent?: boolean;
}): PropsResearchRuntimeSnapshot {
  return {
    checkedAt: new Date().toISOString(),
    researchOnlyFlags: {
      applyPreparedWeatherImpactDefault: false,
      minutesTrendInPropSimShape: false,
      defenseIndexSeating: "shadow_only",
      ncaafReleaseGatesUnchanged: true,
    },
    priorities: PROPS_RESEARCH_PRIORITIES,
    runtime: {
      sport: String(input.sport ?? "").toLowerCase(),
      weatherImpactApplied: input.weatherImpactApplied,
      weatherResearchReason: input.weatherResearchReason ?? null,
      defenseIndexByFamilyKeys: input.defenseIndexByFamily
        ? Object.keys(input.defenseIndexByFamily).length
        : 0,
      preparedWeatherPresent: !!input.preparedWeatherPresent,
      preparedDepthCharts: input.preparedDepthCharts ?? 0,
      preparedLineupsComplete: input.preparedLineupsComplete ?? 0,
      opportunityShiftPresent: !!input.opportunityShiftPresent,
    },
  };
}

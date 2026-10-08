/**
 * Machine-readable all-sports coverage matrix for Simulator V2.
 * Generative models remain fail-closed unless registered in unsupported.ts
 * and accepted via SIM_V2_ACCEPTED_FAMILIES (always empty in production today).
 */
import type { SimV2MarketFamily } from "../schemas/market.js";
import type { SimV2SportId } from "../schemas/sport.js";

export type SimV2RolloutPhase = "B" | "C" | "D" | "E" | "F" | "G" | "H" | "I" | "backlog";

export type SportCoverageRow = {
  sport: SimV2SportId;
  stadiumEdgeAppId: string;
  phase: SimV2RolloutPhase;
  /** Generative model id when present; null = unsupported. */
  scoringModelId: string | null;
  propModelId: string | null;
  periodKeys: string[];
  conservationGroups: string[];
  plannedFamilies: SimV2MarketFamily[];
  /** Families currently allowed through isMarketFamilySupported (still shadow-only). */
  v2SettleFamilies: SimV2MarketFamily[];
  notes: string;
};

/**
 * Coverage registry. Adding a row does NOT enable serve or acceptance.
 * Settlement still goes through isMarketFamilySupported + flags.
 */
export const SPORT_COVERAGE_REGISTRY: readonly SportCoverageRow[] = [
  {
    sport: "nfl",
    stadiumEdgeAppId: "nfl",
    phase: "B",
    scoringModelId: "football.joint.phase_b_correct",
    propModelId: "football.joint.phase_b_correct",
    periodKeys: ["fg", "h1", "h2", "q1", "q2", "q3", "q4"],
    conservationGroups: ["football_quarters", "football_halves"],
    plannedFamilies: ["ml", "spread", "total", "team_total", "player_prop", "race_to"],
    v2SettleFamilies: ["ml", "spread", "total", "team_total", "player_prop"],
    notes: "Phase B correct + C.1 prop attach (shadow).",
  },
  {
    sport: "ncaaf",
    stadiumEdgeAppId: "ncaaf",
    phase: "B",
    scoringModelId: "football.joint.phase_b_correct",
    propModelId: "football.joint.phase_b_correct",
    periodKeys: ["fg", "h1", "h2", "q1", "q2", "q3", "q4"],
    conservationGroups: ["football_quarters", "football_halves"],
    plannedFamilies: ["ml", "spread", "total", "team_total", "player_prop", "race_to"],
    v2SettleFamilies: ["ml", "spread", "total", "team_total", "player_prop"],
    notes: "Separate frozen params from NFL. C.1 props shadow.",
  },
  {
    sport: "nhl",
    stadiumEdgeAppId: "nhl",
    phase: "D",
    scoringModelId: null,
    propModelId: null,
    periodKeys: ["fg", "p1", "p2", "p3"],
    conservationGroups: ["hockey_periods"],
    plannedFamilies: ["ml", "spread", "total", "team_total", "player_prop"],
    v2SettleFamilies: [],
    notes: "Milestone D.1 shadow scaffold. Own generative model — no football reuse.",
  },
  {
    sport: "nba",
    stadiumEdgeAppId: "nba",
    phase: "E",
    scoringModelId: null,
    propModelId: null,
    periodKeys: ["fg", "h1", "h2", "q1", "q2", "q3", "q4"],
    conservationGroups: ["basketball_quarters", "basketball_halves"],
    plannedFamilies: ["ml", "spread", "total", "team_total", "player_prop", "race_to"],
    v2SettleFamilies: [],
    notes: "Milestone E.1 shadow scaffold — prop-first; no football scoring reuse.",
  },
  {
    sport: "wnba",
    stadiumEdgeAppId: "wnba",
    phase: "E",
    scoringModelId: null,
    propModelId: null,
    periodKeys: ["fg", "h1", "h2", "q1", "q2", "q3", "q4"],
    conservationGroups: ["basketball_quarters", "basketball_halves"],
    plannedFamilies: ["ml", "spread", "total", "team_total", "player_prop"],
    v2SettleFamilies: [],
    notes: "Own params/gates; NBA pass does not enable WNBA serve.",
  },
  {
    sport: "ncaab",
    stadiumEdgeAppId: "ncaab",
    phase: "E",
    scoringModelId: null,
    propModelId: null,
    periodKeys: ["fg", "h1", "h2"],
    conservationGroups: ["basketball_halves"],
    plannedFamilies: ["ml", "spread", "total", "team_total", "player_prop"],
    v2SettleFamilies: [],
    notes: "Halves-first milestone; quarter books sparse.",
  },
  {
    sport: "mlb",
    stadiumEdgeAppId: "mlb",
    phase: "F",
    scoringModelId: null,
    propModelId: null,
    periodKeys: ["fg", "f5", "i1"],
    conservationGroups: ["baseball_f5"],
    plannedFamilies: ["ml", "spread", "total", "team_total", "player_prop"],
    v2SettleFamilies: [],
    notes: "Milestone F.1 shadow scaffold — F5 ⊆ FG.",
  },
  {
    sport: "soccer",
    stadiumEdgeAppId: "soccer",
    phase: "G",
    scoringModelId: null,
    propModelId: null,
    periodKeys: ["fg", "h1", "h2"],
    conservationGroups: ["soccer_halves"],
    plannedFamilies: ["ml", "spread", "total", "team_total", "player_prop"],
    v2SettleFamilies: [],
    notes: "Multi-league Odds keys; BTTS/DNB/DC need settlePaths. Periods unsupported in V1 simMarketSupport.",
  },
  {
    sport: "tennis",
    stadiumEdgeAppId: "tennis",
    phase: "G",
    scoringModelId: null,
    propModelId: null,
    periodKeys: ["fg"],
    conservationGroups: ["tennis_sets"],
    plannedFamilies: ["ml", "total", "player_prop"],
    v2SettleFamilies: [],
    notes: "Dynamic tournament Odds keys; set/game coupling.",
  },
  {
    sport: "ufc",
    stadiumEdgeAppId: "ufc",
    phase: "H",
    scoringModelId: null,
    propModelId: null,
    periodKeys: ["fg"],
    conservationGroups: ["combat_method_rounds"],
    plannedFamilies: ["ml", "total", "method", "rounds", "player_prop"],
    v2SettleFamilies: [],
    notes: "Combat joint: winner × method × rounds mutual exclusion.",
  },
  {
    sport: "mma",
    stadiumEdgeAppId: "mma",
    phase: "H",
    scoringModelId: null,
    propModelId: null,
    periodKeys: ["fg"],
    conservationGroups: ["combat_method_rounds"],
    plannedFamilies: ["ml", "total", "method", "rounds", "player_prop"],
    v2SettleFamilies: [],
    notes: "Alias path for Odds mma_mixed_martial_arts non-UFC cards.",
  },
  {
    sport: "boxing",
    stadiumEdgeAppId: "boxing",
    phase: "H",
    scoringModelId: null,
    propModelId: null,
    periodKeys: ["fg"],
    conservationGroups: ["combat_method_rounds"],
    plannedFamilies: ["ml", "total", "method", "rounds"],
    v2SettleFamilies: [],
    notes: "Not yet a first-class app tab; schema reserved for Phase H.",
  },
  {
    sport: "tabletennis",
    stadiumEdgeAppId: "tabletennis",
    phase: "backlog",
    scoringModelId: null,
    propModelId: null,
    periodKeys: ["fg"],
    conservationGroups: [],
    plannedFamilies: ["ml"],
    v2SettleFamilies: [],
    notes: "Bovada ML fallback today; no Odds API key.",
  },
  {
    sport: "cricket",
    stadiumEdgeAppId: "cricket",
    phase: "backlog",
    scoringModelId: null,
    propModelId: null,
    periodKeys: ["fg"],
    conservationGroups: [],
    plannedFamilies: ["ml", "total"],
    v2SettleFamilies: [],
    notes: "Dynamic tournament Odds keys; generative model deferred.",
  },
  {
    sport: "golf",
    stadiumEdgeAppId: "golf",
    phase: "backlog",
    scoringModelId: null,
    propModelId: null,
    periodKeys: ["fg"],
    conservationGroups: ["golf_outright_ranks"],
    plannedFamilies: ["ml"],
    v2SettleFamilies: [],
    notes: "Outrights-only product surface; not game-line Monte Carlo.",
  },
] as const;

export function coverageForSport(sport: SimV2SportId): SportCoverageRow | undefined {
  return SPORT_COVERAGE_REGISTRY.find((r) => r.sport === sport);
}

export function sportsMissingScoringModel(): SimV2SportId[] {
  return SPORT_COVERAGE_REGISTRY.filter((r) => r.scoringModelId == null).map((r) => r.sport);
}

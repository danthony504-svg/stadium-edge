/**
 * Data contract for ncaaf-score-margin-v1-research (M1/M2).
 * Closing prices must never appear on feature / predict inputs.
 */

import type { NcaafCleanEngineStamp } from "./stamp.ts";

export type TeamId = string;

export type Subdivision = "fbs" | "fcs" | "unknown";

export type MatchupScope =
  | "fbs_fbs"
  | "fbs_fcs"
  | "fcs_fcs"
  | "involves_unknown";

export type SeasonTeamIdentity = {
  teamId: TeamId;
  season: number;
  displayName: string;
  subdivision: Subdivision;
  conferenceId?: string | null;
  transition?: "fcs_to_fbs" | "fbs_to_fcs" | null;
};

export type VenueKind = "home" | "neutral" | "unknown";

export type VenueInfo = {
  kind: VenueKind;
  /** Present only when kind === "neutral" after successful recovery. */
  neutralReason?:
    | "bowl"
    | "conference_championship"
    | "neutral_site"
    | "unspecified";
  venueId?: string | null;
  /** How kind was determined. */
  source: "explicit_field" | "recovered" | "unresolved";
};

export type RestInfo = {
  homeDaysRest: number | null;
  awayDaysRest: number | null;
};

export type CleanGamePregame = {
  eventId: string;
  season: number;
  week?: number | null;
  kickoffIso: string;
  home: SeasonTeamIdentity;
  away: SeasonTeamIdentity;
  venue: VenueInfo;
  rest: RestInfo;
  matchupScope: MatchupScope;
};

export type CleanGameResult = {
  eventId: string;
  homeScore: number;
  awayScore: number;
  /** False when cancelled / no usable final. */
  decided: boolean;
  /** True when homeScore === awayScore after a recorded final (invalid for two-way ML). */
  tied: boolean;
};

/** Eval-only — never passed into predict features. */
export type CleanGameCloses = {
  eventId: string;
  closeMlHome?: number | null;
  closeMlAway?: number | null;
  closeSpreadHome?: number | null;
  closeTotal?: number | null;
  closeSnapshotTimestamp?: string | null;
};

export type TeamStrengthState = {
  teamId: TeamId;
  season: number;
  nFbsGames: number;
  offMu: number | null;
  defMu: number | null;
  sosOff: number | null;
  sosDef: number | null;
  uncertainty: number;
  lastUpdatedKickoffIso: string | null;
};

export type MissingInput =
  | "unrated_fbs_side"
  | "fbs_fcs_unsupported_scope"
  | "fcs_fcs_unsupported_scope"
  | "involves_unknown_subdivision"
  | "venue_unknown_material"
  | "injury_unavailable"
  | "qb_availability_unavailable"
  | "insufficient_history"
  | "missing_season"
  | "tied_or_invalid_final";

export type AvailabilitySide = {
  qbStatus: "active" | "out" | "doubtful" | "unknown";
  keyOffenseOut: boolean | null;
  keyDefenseOut: boolean | null;
};

export type AvailabilityInput = {
  eventId: string;
  captureTimestamp: string;
  home: AvailabilitySide;
  away: AvailabilitySide;
};

export type CleanEnginePredictionOk = {
  stamp: NcaafCleanEngineStamp;
  eventId: string;
  ok: true;
  /**
   * Research-only: inputs are complete enough to **evaluate** (supported
   * matchup + resolved venue for HFA protocol). This is NOT production
   * release approval — always pair with productionReleaseApproved=false.
   */
  evaluableSupported: boolean;
  /** Always false on this research stamp until human E6 / product gate. */
  productionReleaseApproved: false;
  homeScoreMean: number;
  awayScoreMean: number;
  marginMean: number;
  marginSd: number;
  totalMean: number;
  totalSd: number;
  /** True only when venue.kind === "home" and HFA was added. */
  hfaApplied: boolean;
  uncertainty: number;
  featuresUsed: string[];
  missingOptional: MissingInput[];
};

export type CleanEnginePredictionFail = {
  stamp: NcaafCleanEngineStamp;
  eventId: string;
  ok: false;
  evaluableSupported: false;
  productionReleaseApproved: false;
  reason: MissingInput;
};

export type CleanEnginePrediction =
  | CleanEnginePredictionOk
  | CleanEnginePredictionFail;

/** Raw fixture row shape used by TUNING / phase-e game archives. */
export type CleanFixtureGameRow = {
  eventId: string;
  season: number;
  week?: number | null;
  kickoffIso: string;
  homeTeamId: string;
  awayTeamId: string;
  homeName?: string;
  awayName?: string;
  homeFg?: number | null;
  awayFg?: number | null;
  /** Optional venue recovery fields (absent on current archives). */
  venueKind?: string | null;
  neutralSite?: boolean | null;
  isNeutral?: boolean | null;
  venueId?: string | null;
  conferenceChampionship?: boolean | null;
  bowl?: boolean | null;
};

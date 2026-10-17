/**
 * Research-only support / Coach-withhold policy for college team-strength.
 *
 * FBS–FCS (and unrated / unknown) matchups are an **unsupported scope** —
 * not a validation failure and not a silent default. Coach must withhold
 * team-strength legs for these matchups (same pattern as unsupported_market).
 *
 * Does NOT flip NCAAF_GAME_LINE_SIM_VALIDATED. Not wired to live product yet.
 */

import {
  classifyMatchupSubdivision,
  type MatchupSubdivision,
} from "./ncaafSubdivision.ts";

export type NcaafTsWithholdReason =
  | "fbs_fcs_unsupported_scope"
  | "fcs_fcs_unsupported_scope"
  | "involves_unknown"
  | "unrated_fbs_side"
  | "missing_season";

export type NcaafTsSupportDecision =
  | {
      supported: true;
      scope: "fbs_fbs";
      coachAction: "allow_when_rated";
    }
  | {
      supported: false;
      scope: Exclude<MatchupSubdivision, "fbs_fbs"> | "unrated_fbs_side";
      reason: NcaafTsWithholdReason;
      coachAction: "withhold";
    };

/**
 * Matchup-level support gate (classification only).
 * Callers that also track ratings must still withhold when either side is unrated.
 */
export function ncaafTeamStrengthMatchupSupport(opts: {
  homeTeamId: string;
  awayTeamId: string;
  season: number;
  homeRated?: boolean;
  awayRated?: boolean;
}): NcaafTsSupportDecision {
  if (!Number.isFinite(opts.season)) {
    return {
      supported: false,
      scope: "involves_unknown",
      reason: "missing_season",
      coachAction: "withhold",
    };
  }
  const matchup = classifyMatchupSubdivision(
    opts.homeTeamId,
    opts.awayTeamId,
    opts.season,
  );
  if (matchup === "fbs_fcs") {
    return {
      supported: false,
      scope: "fbs_fcs",
      reason: "fbs_fcs_unsupported_scope",
      coachAction: "withhold",
    };
  }
  if (matchup === "fcs_fcs") {
    return {
      supported: false,
      scope: "fcs_fcs",
      reason: "fcs_fcs_unsupported_scope",
      coachAction: "withhold",
    };
  }
  if (matchup === "involves_unknown") {
    return {
      supported: false,
      scope: "involves_unknown",
      reason: "involves_unknown",
      coachAction: "withhold",
    };
  }
  // fbs_fbs — still withhold if ratings missing (e.g. transition team pre-first FBS–FBS)
  if (opts.homeRated === false || opts.awayRated === false) {
    return {
      supported: false,
      scope: "unrated_fbs_side",
      reason: "unrated_fbs_side",
      coachAction: "withhold",
    };
  }
  return {
    supported: true,
    scope: "fbs_fbs",
    coachAction: "allow_when_rated",
  };
}

/** Short Coach-facing withhold copy (research policy text; not live-wired). */
export function ncaafTeamStrengthWithholdMessage(
  decision: Extract<NcaafTsSupportDecision, { supported: false }>,
): string {
  switch (decision.reason) {
    case "fbs_fcs_unsupported_scope":
      return "College team-strength does not support FBS–FCS matchups — withholding that leg (unsupported scope, not a model miss).";
    case "fcs_fcs_unsupported_scope":
      return "College team-strength does not support FCS–FCS matchups — withholding that leg.";
    case "involves_unknown":
      return "College team-strength cannot classify one or both teams (unknown subdivision) — withholding that leg.";
    case "unrated_fbs_side":
      return "College team-strength has no FBS rating yet for one or both sides — withholding that leg (no invented defaults).";
    case "missing_season":
      return "College team-strength needs a season to classify the matchup — withholding that leg.";
    default:
      return "College team-strength unsupported for this matchup — withholding that leg.";
  }
}

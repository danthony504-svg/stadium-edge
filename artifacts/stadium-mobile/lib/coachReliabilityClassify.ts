/**
 * Mobile-side mapping of CoachScanFailureCode → reliability event.
 * Mirrors api-server coachReliabilitySanitize.mapScanFailureCode (keep in sync).
 * Observe-only — does not affect selection / grading / simulation.
 */

export type CoachReliabilityMapped = {
  eventType: string;
  failureReason: string;
  alertable: boolean;
};

export function mapScanFailureCode(
  code: string,
): CoachReliabilityMapped | null {
  switch (code) {
    case "TEAM_ID_MAP_EMPTY":
    case "TEAM_IDS_UNRESOLVED":
      return {
        eventType: "coach_grounding_failure",
        failureReason: "grounding_failure",
        alertable: true,
      };
    case "NO_ODDS_GAMES":
      return {
        eventType: "coach_odds_mismatch",
        failureReason: "odds_mismatch",
        alertable: true,
      };
    case "PROP_POOL_EMPTY":
      return {
        eventType: "coach_alt_market_failure",
        failureReason: "alt_market_failure",
        alertable: true,
      };
    case "GAME_SIMS_TIMED_OUT":
    case "GAME_SIMS_FETCH_EMPTY":
    case "GAME_SIMS_ALL_NULL":
    case "GAME_LINES_NO_SIM_GRADE":
    case "PROP_ALL_NO_SIM_GRADE":
      return {
        eventType: "coach_simulation_failure",
        failureReason:
          code === "GAME_SIMS_FETCH_EMPTY" || code === "GAME_SIMS_ALL_NULL"
            ? "missing_sim_output"
            : "simulation_failure",
        alertable: true,
      };
    case "SCAN_THREW":
    case "ABSOLUTE_BUDGET":
    case "PROP_PHASE_INCOMPLETE":
      return {
        eventType: "coach_scan_freeze",
        failureReason: "scan_freeze",
        alertable: true,
      };
    case "QUALITY_BAR_EMPTY":
    case "SCORED_BUT_NOT_STAGED":
      return {
        eventType: "parlay_underfilled",
        failureReason: "legitimate_underfill",
        alertable: false,
      };
    case "P0_UNVALIDATED_MARKETS":
      // Intentional NCAAF / totals P0 gate — digest-visible policy block, not a
      // scan failure, qualification shortfall, or fulfillment miss. Never page.
      return {
        eventType: "parlay_zero_results",
        failureReason: "blocked_unvalidated_market",
        alertable: false,
      };
    default:
      return null;
  }
}

export function classifySportCategoryFromAsk(text: string): string {
  const t = String(text || "").toLowerCase();
  const hits: string[] = [];
  if (/\bnfl\b/.test(t)) hits.push("nfl");
  if (/\bncaaf\b|\bcfb\b|\bcollege\s+football\b/.test(t)) hits.push("ncaaf");
  if (/\bnba\b/.test(t)) hits.push("nba");
  if (/\bwnba\b/.test(t)) hits.push("wnba");
  if (/\bmlb\b|\bbaseball\b/.test(t)) hits.push("mlb");
  if (/\bnhl\b|\bhockey\b/.test(t)) hits.push("nhl");
  if (/\bsoccer\b|\bepl\b|\bmls\b|\buefa\b/.test(t)) hits.push("soccer");
  if (/\bufc\b|\bmma\b/.test(t)) hits.push("ufc");
  if (/\btennis\b/.test(t)) hits.push("tennis");
  const unique = [...new Set(hits)];
  if (unique.length === 0) return "unspecified";
  if (unique.length > 1) return "multi";
  return unique[0]!;
}

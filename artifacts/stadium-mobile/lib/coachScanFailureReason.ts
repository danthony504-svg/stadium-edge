/**
 * Traceable Coach empty-ticket reasons.
 *
 * Phone kept showing a generic "quality bar" empty after #470/#471 while the
 * real failure was upstream (team ids / sims / scan abort). Surface a stable
 * code + detail so we can diagnose without guessing.
 */

export type CoachScanFailureCode =
  | "SCAN_THREW"
  | "NO_ODDS_GAMES"
  | "TEAM_ID_MAP_EMPTY"
  | "TEAM_IDS_UNRESOLVED"
  | "GAME_SIMS_ALL_NULL"
  | "GAME_LINES_NO_SIM_GRADE"
  | "PROP_POOL_EMPTY"
  | "PROP_PHASE_INCOMPLETE"
  | "PROP_ALL_NO_SIM_GRADE"
  | "SCORED_BUT_NOT_STAGED"
  | "ABSOLUTE_BUDGET"
  | "QUALITY_BAR_EMPTY";

export type CoachScanFailureReason = {
  code: CoachScanFailureCode;
  detail: string;
};

export type CoachScanFailureDiagnostics = {
  scanMissing?: boolean;
  timedOut?: boolean;
  oddsGameCount?: number;
  teamIdMapSize?: number;
  gameEntryCount?: number;
  gameSimsLoaded?: number;
  gameLegsScored?: number;
  gameLegsDroppedNoSim?: number;
  propPoolSize?: number;
  propLegsScored?: number;
  propPhaseIncomplete?: boolean;
  scoredBeforeStage?: number;
  stagedPickCount?: number;
};

/** Prefer the earliest structural failure over a generic quality-bar empty. */
export function deriveCoachScanFailureReason(
  d: CoachScanFailureDiagnostics,
): CoachScanFailureReason | null {
  const staged = d.stagedPickCount ?? 0;
  if (staged > 0) return null;

  if (d.scanMissing) {
    return {
      code: "SCAN_THREW",
      detail: "board scan aborted before a result was returned",
    };
  }
  if (d.timedOut && (d.scoredBeforeStage ?? 0) === 0) {
    return {
      code: "ABSOLUTE_BUDGET",
      detail: "delivery budget hit before any AI-backed legs cleared",
    };
  }

  const oddsCount = d.oddsGameCount ?? 0;
  const teamIdCount = d.teamIdMapSize ?? 0;
  const gameCount = d.gameEntryCount ?? 0;
  const simCount = d.gameSimsLoaded ?? 0;
  const gameScoredCount = d.gameLegsScored ?? 0;
  const droppedNoSimCount = d.gameLegsDroppedNoSim ?? 0;
  const propPoolCount = d.propPoolSize ?? 0;
  const propScoredCount = d.propLegsScored ?? 0;
  const scoredCount = d.scoredBeforeStage ?? gameScoredCount + propScoredCount;

  if (oddsCount <= 0 && gameCount <= 0) {
    return { code: "NO_ODDS_GAMES", detail: "no bettable odds games on the loaded board" };
  }
  if (teamIdCount <= 0 && oddsCount > 0) {
    return {
      code: "TEAM_ID_MAP_EMPTY",
      detail:
        "odds board had " +
        oddsCount +
        " game(s) but ESPN team-id map was empty — game sims never ran",
    };
  }
  if (teamIdCount > 0 && gameCount > 0 && simCount <= 0) {
    return {
      code: "TEAM_IDS_UNRESOLVED",
      detail:
        gameCount +
        " odds game(s) on board, " +
        teamIdCount +
        " ESPN id entries, 0 game sims bound — labels did not resolve",
    };
  }
  if (simCount > 0 && gameScoredCount <= 0 && droppedNoSimCount > 0) {
    return {
      code: "GAME_LINES_NO_SIM_GRADE",
      detail:
        simCount +
        " game sim(s) loaded but " +
        droppedNoSimCount +
        " evaluated line(s) dropped without a sim grade",
    };
  }
  if (simCount > 0 && gameScoredCount <= 0) {
    return {
      code: "GAME_SIMS_ALL_NULL",
      detail: simCount + " game sim fetch(es) returned no usable grade for posted lines",
    };
  }
  if (propPoolCount <= 0 && gameScoredCount <= 0) {
    return {
      code: "PROP_POOL_EMPTY",
      detail: "prop/alt pool was empty and no game lines cleared",
    };
  }
  if (propPoolCount > 0 && propScoredCount <= 0 && d.propPhaseIncomplete) {
    return {
      code: "PROP_PHASE_INCOMPLETE",
      detail:
        "prop pool had " +
        propPoolCount +
        " row(s) but prop scoring was cut short before any cleared",
    };
  }
  if (propPoolCount > 0 && propScoredCount <= 0 && gameScoredCount <= 0) {
    return {
      code: "PROP_ALL_NO_SIM_GRADE",
      detail:
        "scanned " +
        propPoolCount +
        " props/alts — none cleared sim grade; game lines also empty",
    };
  }
  if (scoredCount > 0 && staged <= 0) {
    return {
      code: "SCORED_BUT_NOT_STAGED",
      detail: scoredCount + " scored leg(s) existed but staging produced 0 ticket picks",
    };
  }
  return {
    code: "QUALITY_BAR_EMPTY",
    detail: "scan finished and no AI-backed legs cleared the quality bar",
  };
}

export function formatCoachScanFailureTrace(reason: CoachScanFailureReason): string {
  return " [" + reason.code + ": " + reason.detail + "]";
}

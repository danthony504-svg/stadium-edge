/**
 * Traceable Coach empty-ticket reasons.
 *
 * Rebuild (post-#530): TEAM_IDS_UNRESOLVED must mean labels actually failed to
 * bind — never a stand-in for prop-phase starvation, game-sim timeouts, or
 * football prop-mix empties. "10 leg NFL" is requirePropMix: empty tickets are
 * PROP_* (or honest GAME_SIMS_*), never fake TEAM_IDS with a healthy map size.
 */

export type CoachScanFailureCode =
  | "SCAN_THREW"
  | "NO_ODDS_GAMES"
  | "TEAM_ID_MAP_EMPTY"
  | "TEAM_IDS_UNRESOLVED"
  | "GAME_SIMS_TIMED_OUT"
  | "GAME_SIMS_FETCH_EMPTY"
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
  /**
   * Props-only asks skip game-line Monte Carlo entirely. Football prop-mix
   * asks (requirePropMix) still run game sims, but props are the primary
   * delivery path — never misread gameSimsLoaded=0 as TEAM_IDS_UNRESOLVED.
   */
  propsOnly?: boolean;
  requirePropMix?: boolean;
  /** True when the scan actually entered the game-slate sim loop. */
  gameSimsAttempted?: boolean;
  /** Odds labels that failed ESPN id bind after pre-bind + fuzzy resolve. */
  oddsLabelsUnresolved?: number;
  /** Odds labels that successfully bound to ESPN ids before slate fetch. */
  oddsLabelsBound?: number;
  /** Games whose ids resolved but fetch returned null / threw. */
  gameSimsFetchNull?: number;
  /** Games skipped because the game-phase wall clock / batch budget expired. */
  gameSimsTimedOut?: number;
  /** How many prop rows actually entered deep MC (not the full pool size). */
  propSimEvaluated?: number;
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
  const unresolvedLabels = d.oddsLabelsUnresolved ?? 0;
  const boundLabels = d.oddsLabelsBound ?? 0;
  const fetchNull = d.gameSimsFetchNull ?? 0;
  const timedOutSims = d.gameSimsTimedOut ?? 0;
  // Football prop-mix + props-only: props are the delivery contract. Never
  // blame TEAM_IDS when the ask was props-primary (screenshot: 15/60/0).
  const propsPrimary = !!d.propsOnly || !!d.requirePropMix;
  // Game-line sim codes only when we attempted the game slate and props are
  // not the primary delivery path.
  const gameSimsMatter =
    !propsPrimary && d.gameSimsAttempted !== false;

  if (oddsCount <= 0 && gameCount <= 0) {
    return { code: "NO_ODDS_GAMES", detail: "no bettable odds games on the loaded board" };
  }
  if (teamIdCount <= 0 && oddsCount > 0 && gameSimsMatter) {
    return {
      code: "TEAM_ID_MAP_EMPTY",
      detail:
        "odds board had " +
        oddsCount +
        " game(s) but ESPN team-id map was empty — game sims never ran",
    };
  }

  // Honest TEAM_IDS: only when nearly every odds label failed bind AND we
  // cared about game sims. Map size alone proves nothing (one game → many keys).
  if (
    gameSimsMatter &&
    teamIdCount > 0 &&
    gameCount > 0 &&
    simCount <= 0 &&
    unresolvedLabels > 0 &&
    unresolvedLabels >= Math.max(1, gameCount - boundLabels)
  ) {
    return {
      code: "TEAM_IDS_UNRESOLVED",
      detail:
        unresolvedLabels +
        " of " +
        gameCount +
        " odds game label(s) failed ESPN id bind (" +
        teamIdCount +
        " map keys)",
    };
  }

  if (gameSimsMatter && gameCount > 0 && simCount <= 0 && timedOutSims > 0) {
    return {
      code: "GAME_SIMS_TIMED_OUT",
      detail:
        timedOutSims +
        " of " +
        gameCount +
        " game sim(s) hit the phase budget before a draw returned",
    };
  }

  if (
    gameSimsMatter &&
    gameCount > 0 &&
    simCount <= 0 &&
    (fetchNull > 0 || boundLabels > 0)
  ) {
    return {
      code: "GAME_SIMS_FETCH_EMPTY",
      detail:
        (boundLabels || gameCount) +
        " game(s) had ESPN ids but 0 Monte Carlo draws returned usable grades",
    };
  }

  // Legacy: 0 sims with a map, no bind counters (older callers) — still not
  // TEAM_IDS when props-primary.
  if (gameSimsMatter && teamIdCount > 0 && gameCount > 0 && simCount <= 0) {
    return {
      code: "GAME_SIMS_FETCH_EMPTY",
      detail:
        gameCount +
        " odds game(s) on board, " +
        teamIdCount +
        " map keys, 0 game sims loaded — bind/fetch produced nothing",
    };
  }

  if (gameSimsMatter && simCount > 0 && gameScoredCount <= 0 && droppedNoSimCount > 0) {
    return {
      code: "GAME_LINES_NO_SIM_GRADE",
      detail:
        simCount +
        " game sim(s) loaded but " +
        droppedNoSimCount +
        " evaluated line(s) dropped without a sim grade",
    };
  }
  if (gameSimsMatter && simCount > 0 && gameScoredCount <= 0) {
    return {
      code: "GAME_SIMS_ALL_NULL",
      detail: simCount + " game sim fetch(es) returned no usable grade for posted lines",
    };
  }
  if (propPoolCount <= 0 && gameScoredCount <= 0) {
    return {
      code: "PROP_POOL_EMPTY",
      detail: propsPrimary
        ? "football/prop ask had an empty prop pool and no game lines cleared"
        : "prop/alt pool was empty and no game lines cleared",
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
    const simEval = d.propSimEvaluated;
    return {
      code: "PROP_ALL_NO_SIM_GRADE",
      detail:
        simEval != null
          ? "deep-simmed " +
            simEval +
            " of " +
            propPoolCount +
            " props/alts — none cleared sim grade; game lines also empty"
          : "scanned " +
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

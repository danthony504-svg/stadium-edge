/** Mirrors api-server FOOTBALL_DRIVE_ENGINE_VERSION. */
export const COACH_GAME_SIM_ENGINE_VERSION = "ppg-per-drive-v1";

/** Mirrors api-server SPORT_SIM_ENGINE_VERSION. */
export const SPORT_SIM_ENGINE_VERSION = "sport-sim-v1";

/**
 * A draw may be cached or graded only when the server stamped a version this
 * client knows. A missing stamp is an old server response and is rejected.
 */
export function gameDrawEngineAccepted(
  draw: { engineVersion?: unknown; sport?: string | null } | null | undefined,
  sportHint?: string | null,
): boolean {
  if (!draw || typeof draw !== "object") return false;
  const version = typeof draw.engineVersion === "string" ? draw.engineVersion : "";
  const sport = String(sportHint ?? draw.sport ?? "").toLowerCase();
  const football =
    sport === "nfl" ||
    sport === "ncaaf" ||
    sport === "cfb" ||
    sport.includes("ncaaf");
  if (football) return version === COACH_GAME_SIM_ENGINE_VERSION;
  if (!version) return false;
  if (!sport) {
    return version === COACH_GAME_SIM_ENGINE_VERSION || version === SPORT_SIM_ENGINE_VERSION;
  }
  return version === SPORT_SIM_ENGINE_VERSION;
}

export function slateDrawsAccepted(
  gameSimulations: Record<string, { engineVersion?: unknown; sport?: string | null }> | null | undefined,
): boolean {
  if (!gameSimulations) return true;
  return Object.values(gameSimulations).every((sim) => gameDrawEngineAccepted(sim));
}

type StampedSim = { engineVersion?: unknown; sport?: string | null };

function ticketScansAccepted(
  tickets:
    | {
        global?: Record<string, { gameSimulations?: Record<string, StampedSim> | null } | null | undefined> | null;
        bySport?: Record<
          string,
          Record<string, { gameSimulations?: Record<string, StampedSim> | null } | null | undefined> | null | undefined
        > | null;
      }
    | null
    | undefined,
): boolean {
  if (!tickets) return true;
  for (const scan of Object.values(tickets.global ?? {})) {
    if (scan && !slateDrawsAccepted(scan.gameSimulations)) return false;
  }
  for (const byLegs of Object.values(tickets.bySport ?? {})) {
    for (const scan of Object.values(byLegs ?? {})) {
      if (scan && !slateDrawsAccepted(scan.gameSimulations)) return false;
    }
  }
  return true;
}

/**
 * Snapshot may be hydrated only when the writer stamp, the fingerprint
 * prefix, and every stored draw agree. A fingerprint prefix by itself is
 * not enough.
 */
export function slateSnapshotEngineAccepted(
  snapshot:
    | {
        fingerprint?: string;
        simEngineStamp?: string;
        boardScan?: { gameSimulations?: Record<string, StampedSim> | null } | null;
        tickets?: Parameters<typeof ticketScansAccepted>[0];
      }
    | null
    | undefined,
): boolean {
  if (!snapshot) return false;
  if (!String(snapshot.fingerprint ?? "").startsWith(`${COACH_GAME_SIM_ENGINE_VERSION}:`)) return false;
  if (snapshot.simEngineStamp !== COACH_GAME_SIM_ENGINE_VERSION) return false;
  if (!slateDrawsAccepted(snapshot.boardScan?.gameSimulations)) return false;
  return ticketScansAccepted(snapshot.tickets);
}

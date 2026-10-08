/**
 * Named-player identity helpers for football prop OOS / A/B (shadow).
 * Reject synthetic proxies (`home_qb`, …) and missing ids — do not grade.
 */

/** Synthetic role proxies from older OOS — never grade these. */
const PROXY_PLAYER_RE = /^(home|away)_(qb|rb|wr|te|flex|k|dst_lb|dst_db)$/i;

/** True when id looks like a real ESPN athlete.id (numeric, not a role proxy). */
export function isNamedEspnAthleteId(playerId: string | undefined | null): boolean {
  if (playerId == null) return false;
  const id = String(playerId).trim();
  if (!id) return false;
  if (PROXY_PLAYER_RE.test(id)) return false;
  return /^\d{3,}$/.test(id);
}

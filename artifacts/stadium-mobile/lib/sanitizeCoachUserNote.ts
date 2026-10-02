/**
 * Strip machine diagnostics from Coach chat bubbles.
 *
 * Build paths used to append traces like:
 *   [PROP_POOL_EMPTY: football/prop ask had an empty prop pool…]
 *   [PROPS_ONLY_NO_HISTORY: pool=412 cand=48 …]
 *   [POST_FILTER_EMPTY: built=6 afterTeamOrMarketFilter=0]
 *   [PROPS_ASK_GOT_GAME_LINES: propsOnly=false legs=9 …]
 *
 * Those codes stay on scan/failDiag objects for logs — never in user text.
 */

/** SCREAMING_SNAKE code + colon + detail inside brackets. */
const MACHINE_TRACE_RE = /\s*\[([A-Z][A-Z0-9_]{2,})\s*:[^\]]*\]/g;

/**
 * Known Coach failure / mismatch codes that must never appear in chat copy.
 * Kept as a list so tests can assert coverage as new codes land.
 */
export const COACH_MACHINE_TRACE_CODES = [
  // coachScanFailureReason
  "SCAN_THREW",
  "NO_ODDS_GAMES",
  "TEAM_ID_MAP_EMPTY",
  "TEAM_IDS_UNRESOLVED",
  "GAME_SIMS_TIMED_OUT",
  "GAME_SIMS_FETCH_EMPTY",
  "GAME_SIMS_ALL_NULL",
  "GAME_LINES_NO_SIM_GRADE",
  "PROP_POOL_EMPTY",
  "PROP_PHASE_INCOMPLETE",
  "PROP_ALL_NO_SIM_GRADE",
  "SCORED_BUT_NOT_STAGED",
  "ABSOLUTE_BUDGET",
  "QUALITY_BAR_EMPTY",
  // coachPropsOnlyFailReason
  "PROPS_ONLY_POOL_EMPTY",
  "PROPS_ONLY_NO_CANDIDATES",
  "PROPS_ONLY_NO_HISTORY",
  "PROPS_ONLY_NO_GRADE",
  "PROPS_ONLY_ODDS_GATE",
  "PROPS_ONLY_STAGED_SHORT",
  "PROPS_ONLY_EMPTY",
  // ad-hoc buildParlay / parseAsk traces
  "POST_FILTER_EMPTY",
  "PROPS_ONLY_LEAKED_GAME_LINES",
  "PROPS_ASK_GOT_GAME_LINES",
] as const;

export type CoachMachineTraceCode = (typeof COACH_MACHINE_TRACE_CODES)[number];

/** True when text still contains a machine `[CODE: …]` trace. */
export function coachUserNoteHasMachineTrace(text: string | null | undefined): boolean {
  MACHINE_TRACE_RE.lastIndex = 0;
  return MACHINE_TRACE_RE.test(String(text ?? ""));
}

/**
 * Remove every `[CODE: detail]` machine trace from a Coach note.
 * Safe to call on already-clean human copy.
 */
export function sanitizeCoachUserNote(text: string | null | undefined): string {
  const raw = String(text ?? "");
  if (!raw) return "";
  MACHINE_TRACE_RE.lastIndex = 0;
  return raw
    .replace(MACHINE_TRACE_RE, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

/** Pure helpers for tennis / table tennis / cricket browse flows — no React imports. */

export function browseCoachMessage(sportId: string): string {
  if (sportId === "tennis") {
    return "Build me the best tennis parlay for today's board";
  }
  if (sportId === "tabletennis") {
    return "Build me the best table tennis parlay for today's board";
  }
  if (sportId === "cricket") {
    return "Build me the best cricket parlay for today's board";
  }
  return `Build me the best ${sportId.toUpperCase()} parlay for today's board`;
}

/** True when this JS bundle includes table-tennis browse helpers (guards stale OTAs). */
export function browseSportsBundleReady(): boolean {
  try {
    // Fixed bundles use if/else — stale OTAs used BROWSE_COACH_MSG object maps or inline literals.
    const src = browseCoachMessage.toString();
    if (!src.includes('sportId === "tabletennis"')) return false;
    return browseCoachMessage("tabletennis").toLowerCase().includes("table tennis");
  } catch {
    return false;
  }
}

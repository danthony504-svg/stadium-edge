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

/** Hermes errors from mixing stale in-memory JS with a newer OTA download. */
export function isStaleBundleCrashError(message: string): boolean {
  const m = message.toLowerCase();
  if (m.includes("tabletennis")) return true;
  if (m.includes("getoddsselector")) return true;
  if (m.includes("userfound is not a function")) return true;
  if (/property ['"]?tabletennis['"]? doesn't exist/i.test(message)) return true;
  if (/cannot read property ['"]?getoddsselector['"]? of undefined/i.test(message)) return true;
  return false;
}

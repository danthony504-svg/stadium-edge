// Pure helpers for turning a stored bet-slip leg (which keeps only text) back
// into the subject needed to open its full stats sheet. Kept dependency-free so
// the classification/parsing is unit-testable in isolation (no React Native or
// component imports). slip.tsx layers the feed lookups (searchPlayer /
// gameSideFromPick) on top of these.

// A leg whose market is a moneyline / spread / total (or a period variant of
// one) is GAME-LEVEL — it names a team or the whole game; everything else
// (Strikeouts, Hits, Points, …) is a player prop. NOTE: "total" is matched as a
// standalone word and explicitly NOT when followed by "bases", so the MLB prop
// "Total Bases" stays classified as a prop rather than a game total.
const GAME_LEVEL_MARKET = /moneyline|spread|run line|puck line|\btotal\b(?!\s+bases)/i;

export function isGameLevelMarket(market: string): boolean {
  return GAME_LEVEL_MARKET.test(market || "");
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export type ParsedPropLeg = { player: string; side: string; line: number | null };

// Recover the player / side / line from a prop leg's pick string so its stats
// page can fetch the player's REAL game log. "Jameson Taillon Over 3.5
// Strikeouts" → {player:"Jameson Taillon", side:"Over", line:3.5}. Yes/no props
// with no Over/Under ("Aaron Judge Anytime TD") → {player, side:"Yes", line:null}.
// Returns null when no player name survives (fail closed — no guessed subject).
export function parsePropLeg(leg: { market: string; pick: string }): ParsedPropLeg | null {
  const ou = leg.pick.match(/^(.*?)\s+(Over|Under)\s+(\d+(?:\.\d+)?)/i);
  if (ou) {
    const player = ou[1].trim();
    if (!player) return null;
    const side = ou[2][0].toUpperCase() + ou[2].slice(1).toLowerCase();
    const line = Number(ou[3]);
    return { player, side, line: Number.isFinite(line) ? line : null };
  }
  // A bare total ("Over 8" / "Under 2.5") names no player, so it is NOT a prop.
  // Reject up front so a misclassified total can never fabricate a "player".
  if (/^(over|under)\b/i.test(leg.pick.trim())) return null;
  const player = leg.pick
    .replace(new RegExp(escapeRe(leg.market), "ig"), "")
    .replace(/\b(yes|no)\b/gi, "")
    .trim();
  // Require a real name (at least one letter), never a stray number/symbol.
  if (!player || !/[a-z]/i.test(player)) return null;
  return { player, side: "Yes", line: null };
}

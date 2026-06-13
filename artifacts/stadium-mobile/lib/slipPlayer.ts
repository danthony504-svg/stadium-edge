// Pure helpers for reading a slip leg's pick string. Extracted from api.ts so the
// logic can be unit-tested (api.ts pulls in expo/fetch and can't load under
// node --test).

// Extract the player name from a player-prop slip pick string
// ("Stephon Castle Over 3.5 Rebounds" -> "Stephon Castle", "Erling Haaland Yes"
// -> "Erling Haaland"). Returns null for game-level legs (moneyline / spread /
// total), which carry no player before the side token — a spread / ML has no
// Over/Under/Yes/No, and a bare "Over 220.5" has nothing before it. A team total
// ("Lakers Over 110.5") yields the team name, but the downstream active-player /
// whole-word guard then refuses to bind it to an athlete, so no team is ever
// resolved as a player.
export function slipPropPlayerName(pick: string): string | null {
  const m = String(pick).match(/\s(?:over|under|yes|no)\b/i);
  if (!m || m.index == null) return null;
  const name = pick.slice(0, m.index).trim();
  return name || null;
}

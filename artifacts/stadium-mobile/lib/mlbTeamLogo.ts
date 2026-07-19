// Official MLB team logos via ESPN CDN (transparent PNG). Used when the games
// feed omits logo URLs or returns a non-array payload.

const ESPN_LOGO_ABBR: Record<string, string> = {
  AZ: "ari",
  ARI: "ari",
  CWS: "chw",
  CHW: "chw",
  KC: "kc",
  KCR: "kc",
  SF: "sf",
  SFG: "sf",
  TB: "tb",
  TBR: "tb",
  WSH: "wsh",
  WAS: "wsh",
  OAK: "ath",
  ATH: "ath",
};

/** ESPN scoreboard abbreviation → lowercase slug for teamlogos CDN paths. */
export function mlbTeamLogoAbbr(abbr: string): string {
  const key = abbr.trim().toUpperCase();
  return ESPN_LOGO_ABBR[key] ?? key.toLowerCase();
}

/** Official MLB team logo URL (ESPN CDN, 500px transparent PNG). */
export function mlbTeamLogoUrl(abbr: string): string {
  return `https://a.espncdn.com/i/teamlogos/mlb/500/${mlbTeamLogoAbbr(abbr)}.png`;
}

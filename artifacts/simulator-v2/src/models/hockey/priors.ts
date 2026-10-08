export type HockeySport = "nhl";

export function isHockeySport(sport: string): sport is HockeySport {
  return sport === "nhl";
}

/** League prior goals / team / game (regulation). */
export const NHL_TEAM_FG_MEAN = 3.05;
export const NHL_PERIOD_SHARES: [number, number, number] = [0.32, 0.34, 0.34];

export type BaseballSport = "mlb";

export function isBaseballSport(sport: string): sport is BaseballSport {
  return sport === "mlb";
}

export const MLB_TEAM_FG_MEAN = 4.45;

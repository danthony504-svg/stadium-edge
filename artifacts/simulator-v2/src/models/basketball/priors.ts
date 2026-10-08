export type BasketballSport = "nba" | "wnba" | "ncaab";

export function isBasketballSport(sport: string): sport is BasketballSport {
  return sport === "nba" || sport === "wnba" || sport === "ncaab";
}

export const BASKETBALL_FG_MEAN: Record<BasketballSport, number> = {
  nba: 112,
  wnba: 82,
  ncaab: 72,
};

export const BASKETBALL_QUARTER_SHARES: [number, number, number, number] = [
  0.24, 0.25, 0.25, 0.26,
];

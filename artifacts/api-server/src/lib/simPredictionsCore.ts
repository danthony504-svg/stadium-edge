export type SimPredictionInput = {
  sport: string;
  eventId: string;
  game: string;
  homeTeam: string;
  awayTeam: string;
  homeWinProbability: number;
  awayWinProbability: number;
  mostLikelyWinner: "home" | "away";
  simulations: number;
  startsAt?: string | null;
};

export function edgeBandFromWinProbs(homeWin: number, awayWin: number): string {
  const max = Math.max(homeWin, awayWin);
  if (max < 0.55) return "no_edge";
  if (max < 0.6) return "small_edge";
  if (max < 0.65) return "good_edge";
  return "strong_edge";
}

export function predictionId(sport: string, eventId: string, startsAt?: string | null): string {
  const day = startsAt ? startsAt.slice(0, 10) : "nodate";
  return `${sport}|${eventId}|${day}`;
}

export function buildSimPredictionRow(input: SimPredictionInput) {
  const homeWin = input.homeWinProbability;
  const awayWin = input.awayWinProbability;
  const predictedWinner = input.mostLikelyWinner;
  const predictedTeam = predictedWinner === "home" ? input.homeTeam : input.awayTeam;
  return {
    id: predictionId(input.sport, input.eventId, input.startsAt),
    sport: input.sport,
    eventId: input.eventId,
    game: input.game,
    homeTeam: input.homeTeam,
    awayTeam: input.awayTeam,
    predictedWinner,
    predictedTeam,
    homeWinProb: homeWin,
    awayWinProb: awayWin,
    edgeBand: edgeBandFromWinProbs(homeWin, awayWin),
    simulations: input.simulations,
    startsAt: input.startsAt ? new Date(input.startsAt) : null,
    status: "pending" as const,
  };
}

export function gradePredictedWinner(
  predictedWinner: string,
  homeScore: number,
  awayScore: number,
): { status: "correct" | "incorrect" | "push"; actualWinner: string } {
  if (homeScore === awayScore) {
    return { status: "push", actualWinner: "tie" };
  }
  const actualWinner = homeScore > awayScore ? "home" : "away";
  const status = predictedWinner === actualWinner ? "correct" : "incorrect";
  return { status, actualWinner };
}

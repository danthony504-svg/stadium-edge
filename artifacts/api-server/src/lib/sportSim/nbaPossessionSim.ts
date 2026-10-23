// Basketball score model. Inputs are observed points per GAME, not possession
// counts or efficiency ratings. No invented pace, fouls, or league scoring mean.
import { runGameMonteCarlo, type GameSimResult } from "../gameMonteCarlo.js";
import type { SportSimContext } from "./types.js";

export function runBasketballScoreSim(ctx: SportSimContext): GameSimResult | null {
  const validTeam = (team: SportSimContext["home"]) =>
    [team.ptsFor, team.ptsAgainst].every(v => v != null && Number.isFinite(v) && v > 0) &&
    (team.recentScores ?? []).filter(v => Number.isFinite(v) && v >= 0).length >= 5;
  if (!validTeam(ctx.home) || !validTeam(ctx.away)) return null;
  // Existing score sampler preserves the offense/opponent-defense mean and
  // uses observed score variance. This is not a calibrated possession model.
  return runGameMonteCarlo({
    ...ctx,
    home: { ...ctx.home, recentScores: ctx.home.recentScores!.filter(v => Number.isFinite(v) && v >= 0) },
    away: { ...ctx.away, recentScores: ctx.away.recentScores!.filter(v => Number.isFinite(v) && v >= 0) },
  });
}

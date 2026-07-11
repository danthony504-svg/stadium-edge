// Sport-specific game simulation registry — dispatches to the correct engine.

import { runGameMonteCarlo, type GameSimResult } from "../gameMonteCarlo.js";
import type { SportSimContext, SportSimModelId } from "./types.js";
import { MODEL_LABELS } from "./shared.js";
import { runMlbInningSim } from "./mlbInningSim.js";
import { runPossessionSim } from "./nbaPossessionSim.js";
import { runNflDriveSim } from "./nflDriveSim.js";
import { runNhlShiftSim } from "./nhlShiftSim.js";
import { runSoccerXgSim } from "./soccerXgSim.js";

export type { SportSimContext, SportSimModelId };
export { MODEL_LABELS };

export function sportSimModelForSport(sport: string): SportSimModelId {
  const s = sport.toLowerCase();
  if (s === "mlb" || s.startsWith("baseball")) return "mlb-inning";
  if (s === "nba") return "nba-possession";
  if (s === "wnba") return "wnba-possession";
  if (s === "nfl" || s === "ncaaf") return "nfl-drive";
  if (s === "nhl") return "nhl-shift";
  if (s === "soccer") return "soccer-xg";
  if (s === "tennis") return "tennis-point";
  if (s === "ufc" || s === "mma") return "ufc-round";
  return "generic-team";
}

/** Run 10k+ sport-specific game simulation for team sports. */
export function runSportGameMonteCarlo(ctx: SportSimContext): (GameSimResult & { simModel: SportSimModelId; simModelLabel: string }) | null {
  const model = sportSimModelForSport(ctx.sport);
  let result: GameSimResult | null = null;

  switch (model) {
    case "mlb-inning":
      result = runMlbInningSim(ctx);
      break;
    case "nba-possession":
      result = runPossessionSim(ctx, "nba-possession");
      break;
    case "wnba-possession":
      result = runPossessionSim(ctx, "wnba-possession");
      break;
    case "nfl-drive":
      result = runNflDriveSim(ctx);
      break;
    case "nhl-shift":
      result = runNhlShiftSim(ctx);
      break;
    case "soccer-xg":
      result = runSoccerXgSim(ctx);
      break;
    default: {
      const generic = runGameMonteCarlo({
        sport: ctx.sport,
        simulations: ctx.simulations,
        weatherImpact: ctx.weatherImpact,
        coverQueries: ctx.coverQueries,
        retainOutcomes: ctx.retainOutcomes,
        home: ctx.home,
        away: ctx.away,
      });
      if (!generic) return null;
      return {
        ...generic,
        simModel: "generic-team",
        simModelLabel: MODEL_LABELS["generic-team"],
      };
    }
  }

  if (!result) return null;
  return {
    ...result,
    simModel: model,
    simModelLabel: MODEL_LABELS[model],
  };
}

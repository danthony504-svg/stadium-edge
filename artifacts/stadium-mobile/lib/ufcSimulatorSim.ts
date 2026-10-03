// UFC Game Simulator outcome — API first, then on-device fight analysis + 10k MC
// when production /sports/simulate/game-outcome is stale (requires team IDs).

import { getFightAnalysis } from "./api";
import { fetchSimulatorGameOutcome } from "./simulatorApi";
import { fightSimToGameResult } from "./ufcFightSimMap";

export { fightSimToGameResult } from "./ufcFightSimMap";

type UfcSimOpts = {
  sport: string;
  homeTeamId: string;
  awayTeamId: string;
  homeTeam?: string;
  awayTeam?: string;
  simulations?: number;
  weatherImpact?: number | null;
  coverQueries?: Array<{
    id: string;
    kind: "ml" | "spread" | "total" | "teamTotal";
    teamSide?: "home" | "away";
    line?: number;
    totalSide?: "over" | "under";
  }>;
  retainOutcomes?: boolean;
};

/** POST game-outcome; on 400/422 run client fight analysis + Monte Carlo. */
export async function fetchUfcSimulatorGameOutcome(
  opts: UfcSimOpts,
  signal?: AbortSignal,
): Promise<ReturnType<typeof fightSimToGameResult> | null> {
  const api = await fetchSimulatorGameOutcome(opts, signal);
  if (api) return api;

  const away = opts.awayTeam?.trim();
  const home = opts.homeTeam?.trim();
  if (!away || !home) return null;

  const analysis = await getFightAnalysis(away, home, signal);
  if (!analysis?.away || !analysis?.home) {
    const sim = analysis?.simulation;
    if (!sim || (sim.simulations ?? 0) <= 0) return null;
    return fightSimToGameResult(opts.sport || "ufc", sim);
  }

  // Re-run client MC with posted Total cover queries (O/U rounds) — mirrors
  // server /sports/simulate/game-outcome UFC path.
  const { runClientFightMonteCarlo } = await import("./ufcClientSim.ts");
  const sim = runClientFightMonteCarlo({
    away: analysis.away,
    home: analysis.home,
    lean: analysis.lean,
    coverQueries: opts.coverQueries,
    retainOutcomes: opts.retainOutcomes,
    simulations: opts.simulations,
  });
  if ((sim.simulations ?? 0) <= 0) return null;
  return fightSimToGameResult(opts.sport || "ufc", sim);
}

import type { CoachCandidateLeg, CoachSportAdapter } from "@workspace/coach-types";

import { failGate, passGate } from "../helpers";

export function evaluateMarketSimSupportGate(
  candidate: CoachCandidateLeg,
  adapter: CoachSportAdapter,
) {
  if (candidate.kind === "player_prop") {
    const market = adapter.supportedPropMarkets().find((m) => m.marketKey === candidate.marketKey);
    if (!market) {
      return failGate(
        "market_sim_support",
        "market_no_sim_model",
        `No sim model for prop market ${candidate.marketKey}`,
      );
    }
    return passGate("market_sim_support", "Simulation model available", {
      simModel: market.simModel,
      marketKey: candidate.marketKey,
    });
  }

  const market = adapter.supportedGameMarkets().find((m) => m.marketKey === candidate.marketKey);
  if (!market) {
    return failGate(
      "market_sim_support",
      "market_no_sim_model",
      `No sim model for game market ${candidate.marketKey}`,
    );
  }
  return passGate("market_sim_support", "Simulation model available", {
    simModel: market.simModel,
    marketKey: candidate.marketKey,
  });
}

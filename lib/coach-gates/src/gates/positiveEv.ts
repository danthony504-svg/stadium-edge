import type { CoachSimResult } from "@workspace/coach-types";

import { failGate, passGate } from "../helpers";

export function evaluatePositiveEvGate(sim: CoachSimResult | null) {
  if (!sim) {
    return failGate("positive_ev", "ev_not_positive", "No simulation EV");
  }
  if (sim.evPct <= 0) {
    return failGate(
      "positive_ev",
      "ev_not_positive",
      `EV ${sim.evPct.toFixed(1)}%`,
      { evPct: sim.evPct },
    );
  }
  return passGate("positive_ev", `EV +${sim.evPct.toFixed(1)}%`, { evPct: sim.evPct });
}

export function evaluatePositiveEdgeGate(sim: CoachSimResult | null) {
  if (!sim) {
    return failGate("positive_edge", "edge_not_positive", "No simulation edge");
  }
  if (sim.edgePct <= 0) {
    return failGate(
      "positive_edge",
      "edge_not_positive",
      `Edge ${sim.edgePct.toFixed(1)}%`,
      { edgePct: sim.edgePct },
    );
  }
  return passGate("positive_edge", `Edge +${sim.edgePct.toFixed(1)}%`, { edgePct: sim.edgePct });
}

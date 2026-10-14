import {
  COACH_DEEP_SIM_ITERATIONS,
  type CoachSimResult,
} from "@workspace/coach-types";
import { isDeepSimComplete } from "@workspace/coach-sim";

import { failGate, passGate } from "../helpers";

export function evaluateSimulationGate(sim: CoachSimResult | null) {
  if (!sim) {
    return failGate("simulation", "sim_incomplete", "No simulation result");
  }
  if (sim.tier !== "deep") {
    return failGate("simulation", "sim_incomplete", `Simulation tier is ${sim.tier}, deep required`);
  }
  if (sim.iterations < COACH_DEEP_SIM_ITERATIONS) {
    return failGate(
      "simulation",
      "sim_iterations_insufficient",
      `Only ${sim.iterations} iterations (need ${COACH_DEEP_SIM_ITERATIONS})`,
      { iterations: sim.iterations },
    );
  }
  if (!isDeepSimComplete(sim)) {
    return failGate("simulation", "sim_incomplete", "Deep simulation not complete");
  }
  return passGate(
    "simulation",
    `Deep simulation complete (${sim.iterations} iterations)`,
    { iterations: sim.iterations },
  );
}

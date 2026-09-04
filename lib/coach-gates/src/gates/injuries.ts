import { failGate, passGate } from "../helpers";
import { COACH_INJURY_FAIL_FAVOR, type CoachGateInjurySlice } from "../types";

export function evaluateInjuriesGate(injuries: CoachGateInjurySlice | undefined) {
  if (!injuries) {
    return failGate("injuries", "injury_material_absence", "No injury data");
  }

  const favor = injuries.favor;
  if (favor == null || !Number.isFinite(favor)) {
    return failGate("injuries", "injury_material_absence", "Injury picture not groundable");
  }

  if (favor < COACH_INJURY_FAIL_FAVOR) {
    return failGate(
      "injuries",
      "injury_material_absence",
      `Injuries materially against pick (favor ${favor.toFixed(2)})`,
      { favor },
    );
  }

  if (favor < 0) {
    return passGate("injuries", "Minor injury headwinds — within tolerance", { favor });
  }

  return passGate("injuries", "No material injuries", { favor });
}

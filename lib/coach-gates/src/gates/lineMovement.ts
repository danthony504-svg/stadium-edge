import { failGate, passGate } from "../helpers";
import type { CoachGateLineMovementSlice } from "../types";

export function evaluateLineMovementGate(lineMovement: CoachGateLineMovementSlice | undefined) {
  if (!lineMovement) {
    return failGate("line_movement", "line_movement_against_pick", "No line movement data");
  }

  const direction = lineMovement.direction;
  if (direction == null) {
    return failGate("line_movement", "line_movement_against_pick", "Line movement direction unknown");
  }

  if (direction === "against") {
    const mag = lineMovement.magnitudePct ?? 0;
    return failGate(
      "line_movement",
      "line_movement_against_pick",
      `Line moved against pick${mag ? ` (${mag.toFixed(1)}%)` : ""}`,
      { direction, magnitudePct: mag },
    );
  }

  if (direction === "toward") {
    return passGate("line_movement", "Line moved toward pick", {
      direction,
      magnitudePct: lineMovement.magnitudePct,
    });
  }

  return passGate("line_movement", "Line stable", { direction });
}

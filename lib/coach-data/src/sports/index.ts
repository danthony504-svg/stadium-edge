import type { CoachSportAdapter, CoachSportEnumerateInput } from "@workspace/coach-types";

import { toSportEnumerateInput } from "../candidates";
import { createSportRegistry } from "../registry";
import type { CoachNormalizedSlate } from "../context";
import { createMlbAdapter } from "./mlb";

export { createMlbAdapter } from "./mlb";

export function createDefaultSportRegistry(): ReturnType<typeof createSportRegistry> {
  return createSportRegistry([createMlbAdapter()]);
}

export function buildEnumerateInputForSport(
  slate: CoachNormalizedSlate,
  sport: string,
): CoachSportEnumerateInput | null {
  const sportId = sport.toLowerCase().trim();
  const gameLines = slate.gameLines.filter((line) => line.sport.toLowerCase() === sportId);
  const props = slate.props.filter((prop) => prop.sport.toLowerCase() === sportId);
  if (gameLines.length === 0 && props.length === 0) return null;
  return toSportEnumerateInput(sportId, gameLines, props);
}

export function enumerateSportCandidates(
  registry: { get: (sport: string) => CoachSportAdapter | undefined },
  slate: CoachNormalizedSlate,
  sport: string,
) {
  const adapter = registry.get(sport);
  if (!adapter) return [];
  const input = buildEnumerateInputForSport(slate, sport);
  if (!input) return [];
  return adapter.enumerateCandidates(input);
}

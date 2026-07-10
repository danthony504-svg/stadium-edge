import { teamSportPropAdapter } from "./adapters/teamSports.js";
import { tennisPropAdapter } from "./adapters/tennis.js";
import { ufcPropAdapter } from "./adapters/ufc.js";
import type { SportPropAdapter } from "./types.js";

const ADAPTERS: SportPropAdapter[] = [
  teamSportPropAdapter,
  tennisPropAdapter,
  ufcPropAdapter,
];

const BY_SPORT = new Map<string, SportPropAdapter>();
for (const a of ADAPTERS) {
  for (const s of a.sports) BY_SPORT.set(s.toLowerCase(), a);
}

export function getSportAdapter(sport: string): SportPropAdapter | null {
  return BY_SPORT.get(sport.toLowerCase()) ?? null;
}

export function registeredPropEngineSports(): string[] {
  return [...BY_SPORT.keys()];
}

export { ADAPTERS };

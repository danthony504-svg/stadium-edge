import type { CoachCandidateLeg, CoachSportIdOrCustom, CoachSportRegistry } from "@workspace/coach-types";

import type { CoachNormalizedSlate } from "@workspace/coach-data";
import { enumerateSportCandidates } from "@workspace/coach-data/sports";

/** Collect every candidate leg from the slate — never stops early per sport. */
export function enumerateAllCandidates(
  registry: CoachSportRegistry,
  slate: CoachNormalizedSlate,
  sports?: CoachSportIdOrCustom[],
): CoachCandidateLeg[] {
  const sportSet = sports?.map((s) => String(s).toLowerCase()) ?? null;
  const sportIds = new Set<string>();
  for (const line of slate.gameLines) sportIds.add(line.sport.toLowerCase());
  for (const prop of slate.props) sportIds.add(prop.sport.toLowerCase());

  const out: CoachCandidateLeg[] = [];
  for (const sport of sportIds) {
    if (sportSet && !sportSet.includes(sport)) continue;
    if (!registry.has(sport)) continue;
    out.push(...enumerateSportCandidates(registry, slate, sport));
  }
  return out;
}

export function sportsInSlate(slate: CoachNormalizedSlate): CoachSportIdOrCustom[] {
  const ids = new Set<string>();
  for (const line of slate.gameLines) ids.add(line.sport.toLowerCase());
  for (const prop of slate.props) ids.add(prop.sport.toLowerCase());
  return [...ids];
}

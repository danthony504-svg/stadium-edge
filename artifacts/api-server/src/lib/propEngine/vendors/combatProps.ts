// Combat sport (UFC/MMA) prop lines — unified prop odds vendor.

import type { PropLine } from "../types.js";
import { fetchSportPropLines, UFC_PROP_MARKETS } from "./propOdds.js";

export async function fetchCombatPropLines(opts: {
  sport: string;
  away: string;
  home: string;
  eventId?: string;
}): Promise<PropLine[]> {
  return fetchSportPropLines({
    sport: opts.sport,
    away: opts.away,
    home: opts.home,
    eventId: opts.eventId,
    markets: UFC_PROP_MARKETS,
  });
}

import type { ParsedPick } from "../components/PickCard.tsx";
import { withExactMarket10kProvenance } from "../lib/coachPropProbabilityProvenance.ts";

/** Simulation fixture only: model evidence is explicit, never inferred from history. */
export function exactPropFixture<T extends ParsedPick>(pick: T): T {
  if (!pick.isProp) return pick;
  return withExactMarket10kProvenance({
    ...pick,
    athleteId: pick.athleteId ?? `fixture-athlete:${pick.player}`,
    eventId: pick.eventId ?? `fixture-event:${pick.game}`,
    propMarketKey: pick.propMarketKey ?? pick.market,
    propSide: pick.propSide ?? "Over",
    propLine:
      pick.propLine ??
      Number(pick.pick.match(/(?:Over|Under)\s+([\d.]+)/i)?.[1] ?? "1.5"),
  });
}

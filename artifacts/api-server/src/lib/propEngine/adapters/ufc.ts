import type { AnalyzePropsInput, PropLine, PropSimResult, SportPropAdapter } from "../types.js";
import { buildUfcFightContext, runUfcPropMonteCarlo } from "./ufcMonteCarlo.js";
import { fetchCombatPropLines } from "../vendors/combatProps.js";

export const ufcPropAdapter: SportPropAdapter = {
  sports: ["ufc", "mma"],

  async fetchLines(input: AnalyzePropsInput): Promise<PropLine[]> {
    return fetchCombatPropLines({
      sport: "ufc",
      away: input.away,
      home: input.home,
      eventId: input.eventId,
    });
  },

  async buildContext(input: AnalyzePropsInput) {
    return buildUfcFightContext(input.away, input.home);
  },

  async simulate(line: PropLine, ctx: unknown, simulations: number): Promise<PropSimResult> {
    return runUfcPropMonteCarlo(line, ctx as Awaited<ReturnType<typeof buildUfcFightContext>>, simulations);
  },

  statsComplete(ctx: unknown): boolean {
    const c = ctx as Awaited<ReturnType<typeof buildUfcFightContext>>;
    if (!c) return false;
    return !!(c.away.record && c.home.record && c.away.stats.strikeLPM != null);
  },
};

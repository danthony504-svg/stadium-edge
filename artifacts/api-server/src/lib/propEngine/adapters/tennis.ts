import type { AnalyzePropsInput, PropLine, PropSimResult, SportPropAdapter } from "../types.js";
import { runTennisPropMonteCarlo } from "../../tennisPropMonteCarlo.js";
import type { TennisMatchPropContext, TennisPropLine } from "../../tennisPropTypes.js";
import { createTennisStatsVendor } from "../../tennisPropVendor.js";
import { fetchSportPropLines, TENNIS_PROP_MARKETS } from "../vendors/propOdds.js";

function toTennisLine(line: PropLine): TennisPropLine {
  return {
    eventId: line.eventId,
    matchLabel: line.matchLabel,
    awayPlayer: line.awayName,
    homePlayer: line.homeName,
    player: line.subject,
    market: line.market as TennisPropLine["market"],
    marketLabel: line.marketLabel,
    line: line.line,
    side: line.side as TennisPropLine["side"],
    odds: line.odds,
    book: line.book,
    alt: line.alt,
    commenceTime: line.commenceTime,
  };
}

export const tennisPropAdapter: SportPropAdapter = {
  sports: ["tennis"],

  async fetchLines(input: AnalyzePropsInput): Promise<PropLine[]> {
    const rows = await fetchSportPropLines({
      sport: "tennis",
      away: input.away,
      home: input.home,
      eventId: input.eventId,
      markets: TENNIS_PROP_MARKETS,
    });
    return rows.map((r) => ({ ...r, sport: "tennis" }));
  },

  async buildContext(input: AnalyzePropsInput): Promise<TennisMatchPropContext | null> {
    const vendor = createTennisStatsVendor();
    return vendor.enrichMatchContext(input.away, input.home);
  },

  async simulate(line: PropLine, ctx: unknown, simulations: number): Promise<PropSimResult> {
    const matchCtx = ctx as TennisMatchPropContext;
    return runTennisPropMonteCarlo(toTennisLine(line), matchCtx, simulations);
  },

  statsComplete(ctx: unknown): boolean {
    const c = ctx as TennisMatchPropContext | null;
    if (!c) return false;
    return (
      c.away.servePct != null ||
      c.home.servePct != null ||
      c.away.recentFormWins + c.away.recentFormLosses >= 3
    );
  },
};

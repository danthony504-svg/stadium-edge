import type { AnalyzePropsInput, PropLine, PropSimResult, SportPropAdapter } from "../types.js";
import { runTennisPropMonteCarlo } from "../../tennisPropMonteCarlo.js";
import type { TennisMatchPropContext, TennisPropLine } from "../../tennisPropTypes.js";
import {
  createTennisPropVendor,
  createTennisStatsVendor,
} from "../../tennisPropVendor.js";

function toPropLine(row: TennisPropLine, sport: string): PropLine {
  return {
    sport,
    eventId: row.eventId,
    matchLabel: row.matchLabel,
    awayName: row.awayPlayer,
    homeName: row.homePlayer,
    subject: row.player,
    market: row.market,
    marketLabel: row.marketLabel,
    line: row.line,
    side: row.side,
    odds: row.odds,
    book: row.book,
    alt: row.alt,
    commenceTime: row.commenceTime,
  };
}

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
    const vendor = createTennisPropVendor(async () => input.eventId ?? null);
    const rows = await vendor.fetchPropLines({
      away: input.away,
      home: input.home,
      eventId: input.eventId,
    });
    return rows.map((r) => toPropLine(r, "tennis"));
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

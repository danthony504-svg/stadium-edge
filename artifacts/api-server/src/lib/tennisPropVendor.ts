// Tennis prop + stats vendor abstraction. The engine never fabricates lines or
// stats — when vendors return empty, props stay unavailable (honest null).

import { buildTennisMatchup } from "./tennis.js";
import type {
  TennisMatchPropContext,
  TennisPlayerStatProfile,
  TennisPropLine,
  TennisPropMarketKey,
  TennisSurface,
} from "./tennisPropTypes.js";

export type TennisPropVendor = {
  name: string;
  fetchPropLines(match: {
    away: string;
    home: string;
    eventId?: string;
  }): Promise<TennisPropLine[]>;
};

export type TennisStatsVendor = {
  name: string;
  enrichMatchContext(away: string, home: string): Promise<TennisMatchPropContext | null>;
};

const EMPTY_PROFILE = (name: string): TennisPlayerStatProfile => ({
  name,
  resolvedName: null,
  athleteId: null,
  rank: null,
  surfaceWinPct: {},
  recentFormWins: 0,
  recentFormLosses: 0,
  servePct: null,
  firstServeWonPct: null,
  secondServeWonPct: null,
  returnPtsWonPct: null,
  acesPerMatch: null,
  doubleFaultsPerMatch: null,
  breakPtsSavedPct: null,
  breakPtsConvertedPct: null,
  tiebreakWinPct: null,
  matchesLast14Days: null,
  hoursPlayedLast14Days: null,
  daysSinceLastMatch: null,
  injuryFlag: null,
  indoorWinPct: null,
  outdoorWinPct: null,
});

function inferSurface(tournament: string | null): TennisSurface {
  const t = String(tournament ?? "").toLowerCase();
  if (/roland|french|garros|clay|madrid|rome|monte carlo/.test(t)) return "clay";
  if (/wimbledon|grass|queen|halle|eastbourne/.test(t)) return "grass";
  if (/indoor|paris masters|basel|vienna|atp finals/.test(t)) return "indoor_hard";
  if (t) return "hard";
  return "unknown";
}

/** ESPN-backed stats vendor — ranking, form, H2H today; serve stats when vendor URL set. */
export class EspnTennisStatsVendor implements TennisStatsVendor {
  name = "espn";

  async enrichMatchContext(away: string, home: string): Promise<TennisMatchPropContext | null> {
    const matchup = await buildTennisMatchup(away, home);
    const surface = inferSurface(matchup.tournament);
    const toProfile = (p: typeof matchup.away): TennisPlayerStatProfile => ({
      name: p.name,
      resolvedName: p.resolvedName,
      athleteId: p.athleteId,
      rank: p.rank,
      surfaceWinPct: {},
      recentFormWins: p.formSummary?.wins ?? 0,
      recentFormLosses: p.formSummary?.losses ?? 0,
      servePct: null,
      firstServeWonPct: null,
      secondServeWonPct: null,
      returnPtsWonPct: null,
      acesPerMatch: null,
      doubleFaultsPerMatch: null,
      breakPtsSavedPct: null,
      breakPtsConvertedPct: null,
      tiebreakWinPct: null,
      matchesLast14Days: p.recentForm.length || null,
      hoursPlayedLast14Days: null,
      daysSinceLastMatch: p.recentForm[0]?.date
        ? Math.max(
            0,
            Math.floor(
              (Date.now() - Date.parse(p.recentForm[0].date)) / (24 * 60 * 60 * 1000),
            ),
          )
        : null,
      injuryFlag: null,
      indoorWinPct: null,
      outdoorWinPct: null,
    });

    return {
      matchLabel: `${away} @ ${home}`,
      awayPlayer: away,
      homePlayer: home,
      surface,
      indoor: surface === "indoor_hard" ? true : surface === "unknown" ? null : false,
      tournament: matchup.tournament,
      round: matchup.round,
      away: toProfile(matchup.away),
      home: toProfile(matchup.home),
      h2hAwayWins: matchup.h2h?.awayWins ?? null,
      h2hHomeWins: matchup.h2h?.homeWins ?? null,
      weatherWindMph: null,
      weatherHeatIndex: null,
      weatherHumidityPct: null,
    };
  }
}

/** Optional HTTP stats overlay — merges serve/return rates from a partner feed. */
export class HttpTennisStatsVendor implements TennisStatsVendor {
  name = "http-stats";
  constructor(private baseUrl: string) {}

  async enrichMatchContext(away: string, home: string): Promise<TennisMatchPropContext | null> {
    const espn = new EspnTennisStatsVendor();
    const base = await espn.enrichMatchContext(away, home);
    if (!base) return null;
    try {
      const url = `${this.baseUrl.replace(/\/$/, "")}/match?away=${encodeURIComponent(away)}&home=${encodeURIComponent(home)}`;
      const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (!r.ok) return base;
      const data = (await r.json()) as Partial<TennisMatchPropContext>;
      return {
        ...base,
        ...data,
        away: { ...base.away, ...(data.away ?? {}) },
        home: { ...base.home, ...(data.home ?? {}) },
      };
    } catch {
      return base;
    }
  }
}

// Odds API tennis player-prop keys to probe when vendor is enabled.
const TENNIS_PROP_MARKET_KEYS: TennisPropMarketKey[] = [
  "player_aces",
  "player_games_won",
  "player_total_games",
  "player_double_faults",
];

/** Attempts Odds API tennis player markets; returns [] when unsupported (422). */
export class OddsApiTennisPropVendor implements TennisPropVendor {
  name = "odds-api";

  constructor(
    private apiKey: string,
    private resolveEventId: (away: string, home: string) => Promise<string | null>,
  ) {}

  async fetchPropLines(match: {
    away: string;
    home: string;
    eventId?: string;
  }): Promise<TennisPropLine[]> {
    if (!this.apiKey) return [];
    const eventId = match.eventId ?? (await this.resolveEventId(match.away, match.home));
    if (!eventId) return [];

    const lines: TennisPropLine[] = [];
    for (const market of TENNIS_PROP_MARKET_KEYS) {
      const url =
        `https://api.the-odds-api.com/v4/sports/tennis_atp_french_open/odds` +
        `?apiKey=${encodeURIComponent(this.apiKey)}` +
        `&regions=us&markets=${encodeURIComponent(market)}` +
        `&oddsFormat=american&eventIds=${encodeURIComponent(eventId)}`;
      try {
        const r = await fetch(url, { signal: AbortSignal.timeout(10000) });
        if (!r.ok) continue;
        const events = (await r.json()) as Array<{
          id?: string;
          commence_time?: string;
          bookmakers?: Array<{
            title?: string;
            markets?: Array<{
              key: string;
              outcomes?: Array<{
                name: string;
                description?: string;
                price: number;
                point?: number;
              }>;
            }>;
          }>;
        }>;
        for (const ev of events) {
          for (const bm of ev.bookmakers ?? []) {
            for (const mkt of bm.markets ?? []) {
              for (const o of mkt.outcomes ?? []) {
                const player = String(o.description ?? o.name ?? "").trim();
                if (!player) continue;
                const side = /under/i.test(o.name)
                  ? "Under"
                  : /over/i.test(o.name)
                    ? "Over"
                    : /no/i.test(o.name)
                      ? "No"
                      : "Yes";
                lines.push({
                  eventId: ev.id ?? eventId,
                  matchLabel: `${match.away} @ ${match.home}`,
                  awayPlayer: match.away,
                  homePlayer: match.home,
                  player,
                  market: market as TennisPropMarketKey,
                  marketLabel: market.replace(/^player_/, "").replace(/_/g, " "),
                  line: o.point ?? null,
                  side,
                  odds: o.price,
                  book: bm.title ?? "unknown",
                  alt: false,
                  commenceTime: ev.commence_time ?? null,
                });
              }
            }
          }
        }
      } catch {
        // Market unsupported or timeout — skip honestly.
      }
    }
    return lines;
  }
}

/** Returns empty — used when no prop vendor is configured. */
export class StubTennisPropVendor implements TennisPropVendor {
  name = "stub";
  async fetchPropLines(): Promise<TennisPropLine[]> {
    return [];
  }
}

export function createTennisStatsVendor(): TennisStatsVendor {
  const url = process.env.TENNIS_STATS_VENDOR_URL?.trim();
  if (url) return new HttpTennisStatsVendor(url);
  return new EspnTennisStatsVendor();
}

export function createTennisPropVendor(
  resolveEventId: (away: string, home: string) => Promise<string | null>,
): TennisPropVendor {
  if (!tennisPropsFeatureEnabled()) return new StubTennisPropVendor();
  const key = process.env.ODDS_API_KEY?.trim() ?? "";
  if (!key) return new StubTennisPropVendor();
  return new OddsApiTennisPropVendor(key, resolveEventId);
}

export function tennisPropsFeatureEnabled(): boolean {
  return process.env.PROP_ENGINE_ENABLED === "1" || process.env.TENNIS_PROPS_ENABLED === "1";
}

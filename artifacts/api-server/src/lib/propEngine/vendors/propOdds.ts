// Unified prop odds vendor — HTTP overlay first, then Odds API market probes.

import { ODDS_SPORT_KEYS, resolveOddsKeys } from "../../sports.js";
import type { PropLine } from "../types.js";

export const TENNIS_PROP_MARKETS = [
  "player_aces",
  "player_games_won",
  "player_total_games",
  "player_double_faults",
  "player_break_points",
];

export const UFC_PROP_MARKETS = [
  "fighter_method_of_victory",
  "fighter_round_betting",
  "fighter_significant_strikes",
  "fighter_takedowns",
];

async function fetchHttpPropLines(
  baseUrl: string,
  opts: { sport: string; away: string; home: string; eventId?: string },
): Promise<PropLine[]> {
  try {
    const q = new URLSearchParams({
      sport: opts.sport,
      away: opts.away,
      home: opts.home,
    });
    if (opts.eventId) q.set("eventId", opts.eventId);
    const r = await fetch(`${baseUrl.replace(/\/$/, "")}/props?${q}`, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!r.ok) return [];
    const data = (await r.json()) as { lines?: PropLine[] };
    return data.lines ?? [];
  } catch {
    return [];
  }
}

async function probeOddsApiMarket(
  apiKey: string,
  sportKey: string,
  eventId: string,
  market: string,
  matchLabel: string,
  away: string,
  home: string,
  sport: string,
): Promise<PropLine[]> {
  const url =
    `https://api.the-odds-api.com/v4/sports/${sportKey}/odds` +
    `?apiKey=${encodeURIComponent(apiKey)}&regions=us&markets=${encodeURIComponent(market)}` +
    `&oddsFormat=american&eventIds=${encodeURIComponent(eventId)}`;
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!r.ok) return [];
    const events = (await r.json()) as Array<{
      id?: string;
      commence_time?: string;
      bookmakers?: Array<{
        title?: string;
        markets?: Array<{
          key: string;
          outcomes?: Array<{ name: string; description?: string; price: number; point?: number }>;
        }>;
      }>;
    }>;
    const lines: PropLine[] = [];
    for (const ev of events) {
      for (const bm of ev.bookmakers ?? []) {
        for (const mkt of bm.markets ?? []) {
          for (const o of mkt.outcomes ?? []) {
            const subject = String(o.description ?? o.name ?? "").trim();
            if (!subject) continue;
            const sideRaw = o.name.toLowerCase();
            const side =
              /under/i.test(sideRaw) ? "Under" : /over/i.test(sideRaw) ? "Over" : /no/i.test(sideRaw) ? "No" : "Yes";
            lines.push({
              sport,
              eventId: ev.id ?? eventId,
              matchLabel,
              awayName: away,
              homeName: home,
              subject,
              market: mkt.key,
              marketLabel: mkt.key.replace(/_/g, " "),
              line: o.point ?? null,
              side,
              odds: Math.round(o.price),
              book: bm.title ?? "?",
              alt: false,
              commenceTime: ev.commence_time ?? null,
            });
          }
        }
      }
    }
    return lines;
  } catch {
    return [];
  }
}

async function resolveSportKeys(sport: string): Promise<string[]> {
  if (sport === "tennis") return resolveOddsKeys("tennis");
  if (sport === "ufc" || sport === "mma") {
    return [ODDS_SPORT_KEYS.ufc ?? "mma_mixed_martial_arts"];
  }
  return [];
}

/** Fetch all posted prop lines for a single event (main + alt when vendor supplies them). */
export async function fetchSportPropLines(opts: {
  sport: string;
  away: string;
  home: string;
  eventId?: string;
  markets: string[];
}): Promise<PropLine[]> {
  const httpUrl = process.env.PROP_ODDS_VENDOR_URL?.trim();
  if (httpUrl) {
    const httpLines = await fetchHttpPropLines(httpUrl, opts);
    if (httpLines.length > 0) return httpLines;
  }

  const apiKey = process.env.ODDS_API_KEY?.trim() ?? "";
  const eventId = opts.eventId;
  if (!apiKey || !eventId) return [];

  const matchLabel = `${opts.away} @ ${opts.home}`;
  const sportKeys = await resolveSportKeys(opts.sport);
  const lines: PropLine[] = [];
  for (const sportKey of sportKeys) {
    for (const market of opts.markets) {
      const batch = await probeOddsApiMarket(
        apiKey,
        sportKey,
        eventId,
        market,
        matchLabel,
        opts.away,
        opts.home,
        opts.sport,
      );
      lines.push(...batch);
    }
  }
  return lines;
}

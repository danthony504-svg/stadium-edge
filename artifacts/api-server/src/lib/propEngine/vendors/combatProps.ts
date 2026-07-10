// Combat sport (UFC/MMA) prop lines from Odds API + optional HTTP prop vendor.

import { ODDS_SPORT_KEYS } from "../../sports.js";
import type { PropLine } from "../types.js";

const UFC_PROP_MARKETS = [
  "fighter_method_of_victory",
  "fighter_round_betting",
  "fighter_significant_strikes",
  "fighter_takedowns",
];

async function fetchHttpCombatProps(baseUrl: string, opts: {
  sport: string;
  away: string;
  home: string;
  eventId?: string;
}): Promise<PropLine[]> {
  try {
    const q = new URLSearchParams({
      sport: opts.sport,
      away: opts.away,
      home: opts.home,
    });
    if (opts.eventId) q.set("eventId", opts.eventId);
    const r = await fetch(`${baseUrl.replace(/\/$/, "")}/props?${q}`, {
      signal: AbortSignal.timeout(10000),
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
  eventId: string,
  market: string,
  matchLabel: string,
  away: string,
  home: string,
  sport: string,
): Promise<PropLine[]> {
  const oddsKey = ODDS_SPORT_KEYS.ufc ?? "mma_mixed_martial_arts";
  const url =
    `https://api.the-odds-api.com/v4/sports/${oddsKey}/odds` +
    `?apiKey=${encodeURIComponent(apiKey)}&regions=us&markets=${encodeURIComponent(market)}` +
    `&oddsFormat=american&eventIds=${encodeURIComponent(eventId)}`;
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!r.ok) return [];
    const events = (await r.json()) as Array<{
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
              eventId,
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

export async function fetchCombatPropLines(opts: {
  sport: string;
  away: string;
  home: string;
  eventId?: string;
}): Promise<PropLine[]> {
  const httpUrl = process.env.PROP_ODDS_VENDOR_URL?.trim();
  if (httpUrl) {
    const httpLines = await fetchHttpCombatProps(httpUrl, opts);
    if (httpLines.length > 0) return httpLines;
  }

  const apiKey = process.env.ODDS_API_KEY?.trim() ?? "";
  const eventId = opts.eventId;
  if (!apiKey || !eventId) return [];

  const matchLabel = `${opts.away} @ ${opts.home}`;
  const lines: PropLine[] = [];
  for (const m of UFC_PROP_MARKETS) {
    const batch = await probeOddsApiMarket(
      apiKey,
      eventId,
      m,
      matchLabel,
      opts.away,
      opts.home,
      opts.sport,
    );
    lines.push(...batch);
  }
  return lines;
}

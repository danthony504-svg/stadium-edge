// Fetch prop lines for team sports via Odds API + convert to universal PropLine shape.

import { MARKETS_BY_SPORT, ALT_MARKETS_BY_SPORT } from "../../routes/props.js";
import type { PropLine } from "../types.js";

const americanToProb = (a: number) => (a > 0 ? 100 / (a + 100) : -a / (-a + 100));
const americanToDecimal = (a: number) => (a > 0 ? a / 100 + 1 : 100 / -a + 1);

type RawOutcome = { name: string; description?: string; price: number; point?: number };

async function fetchOddsMarket(
  apiKey: string,
  oddsSportKey: string,
  eventId: string,
  market: string,
  isAlt: boolean,
): Promise<RawOutcome[]> {
  const url =
    `https://api.the-odds-api.com/v4/sports/${encodeURIComponent(oddsSportKey)}/odds` +
    `?apiKey=${encodeURIComponent(apiKey)}&regions=us&markets=${encodeURIComponent(market)}` +
    `&oddsFormat=american&eventIds=${encodeURIComponent(eventId)}`;
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(12000) });
    if (!r.ok) return [];
    const events = (await r.json()) as Array<{
      bookmakers?: Array<{
        title?: string;
        markets?: Array<{ key: string; outcomes?: RawOutcome[] }>;
      }>;
    }>;
    const out: Array<RawOutcome & { book: string; marketKey: string }> = [];
    for (const ev of events) {
      for (const bm of ev.bookmakers ?? []) {
        for (const mkt of bm.markets ?? []) {
          const key = isAlt ? mkt.key.replace(/_alternate$/, "") : mkt.key;
          for (const o of mkt.outcomes ?? []) {
            out.push({ ...o, book: bm.title ?? "?", marketKey: key });
          }
        }
      }
    }
    return out;
  } catch {
    return [];
  }
}

export async function fetchTeamSportPropLines(opts: {
  sport: string;
  eventId: string;
  away: string;
  home: string;
  oddsSportKey: string;
}): Promise<PropLine[]> {
  const apiKey = process.env.ODDS_API_KEY?.trim() ?? "";
  if (!apiKey || !opts.eventId) return [];

  const markets = MARKETS_BY_SPORT[opts.sport] ?? [];
  const altMarkets = ALT_MARKETS_BY_SPORT[opts.sport] ?? [];
  if (!markets.length) return [];

  const matchLabel = `${opts.away} @ ${opts.home}`;
  const lines: PropLine[] = [];

  const ingest = (outcomes: Array<RawOutcome & { book?: string; marketKey?: string }>, alt: boolean) => {
    for (const o of outcomes) {
      const player = String(o.description ?? o.name ?? "").trim();
      if (!player || player === "—") continue;
      const sideRaw = o.name.toLowerCase();
      const side =
        sideRaw === "over" || sideRaw === "yes"
          ? ("Over" as const)
          : sideRaw === "under" || sideRaw === "no"
            ? ("Under" as const)
            : null;
      if (!side) continue;
      lines.push({
        sport: opts.sport,
        eventId: opts.eventId,
        matchLabel,
        awayName: opts.away,
        homeName: opts.home,
        subject: player,
        market: o.marketKey ?? "unknown",
        marketLabel: (o.marketKey ?? "prop").replace(/_/g, " "),
        line: o.point ?? null,
        side,
        odds: Math.round(o.price),
        book: (o as { book?: string }).book ?? "?",
        alt,
      });
    }
  };

  for (const m of markets) {
    const outcomes = await fetchOddsMarket(apiKey, opts.oddsSportKey, opts.eventId, m, false);
    ingest(outcomes.map((o) => ({ ...o, marketKey: m })), false);
  }
  for (const m of altMarkets) {
    const outcomes = await fetchOddsMarket(apiKey, opts.oddsSportKey, opts.eventId, m, true);
    ingest(
      outcomes.map((o) => ({ ...o, marketKey: m.replace(/_alternate$/, "") })),
      true,
    );
  }

  return lines;
}

/** Attach de-vig fair prob per (player, market, line, side) for mains. */
export function attachFairProbs(lines: PropLine[]): PropLine[] {
  const byKey = new Map<string, PropLine[]>();
  for (const l of lines) {
    if (l.alt) continue;
    const k = `${l.subject}|${l.market}|${l.line ?? "_"}`;
    const arr = byKey.get(k) ?? [];
    arr.push(l);
    byKey.set(k, arr);
  }

  for (const group of byKey.values()) {
    const overs = group.filter((l) => l.side === "Over" || l.side === "Yes");
    const unders = group.filter((l) => l.side === "Under" || l.side === "No");
    if (!overs.length || !unders.length) continue;
    const over = overs[0];
    const under = unders[0];
    const oi = americanToProb(over.odds);
    const ui = americanToProb(under.odds);
    const tot = oi + ui;
    if (tot <= 0) continue;
    const fairOver = oi / tot;
    const fairUnder = ui / tot;
    for (const l of overs) {
      l.fairProb = fairOver;
      l.evPct = Math.round((fairOver * americanToDecimal(l.odds) - 1) * 1000) / 10;
      l.edgePct = Math.round((fairOver - americanToProb(l.odds)) * 1000) / 10;
    }
    for (const l of unders) {
      l.fairProb = fairUnder;
      l.evPct = Math.round((fairUnder * americanToDecimal(l.odds) - 1) * 1000) / 10;
      l.edgePct = Math.round((fairUnder - americanToProb(l.odds)) * 1000) / 10;
    }
  }
  return lines;
}

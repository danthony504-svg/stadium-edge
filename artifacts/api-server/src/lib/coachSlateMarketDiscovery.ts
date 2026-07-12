// Discover every sportsbook-posted game-line outcome — alt spreads/totals,
// team totals, period markets, and any new market key the feed adds.

export type RealOddsEntry = {
  sport: string;
  game: string;
  market: string;
  pick: string;
  odds: number;
  startsAt?: string;
  noVigFair?: number | null;
  edge?: number | null;
  bookSpread?: number | null;
};

const EVAL_ALT_MAX_JUICE = -1000;

type OddsOutcome = {
  name: string;
  price: number;
  point?: number | null;
  noVigFair?: number | null;
  edge?: number | null;
  bookSpread?: number | null;
};

export type OddsGameForDiscovery = {
  sport: string;
  awayTeam: string;
  homeTeam: string;
  commenceTime: string;
  markets?: Array<{ key: string; outcomes?: OddsOutcome[] }>;
};

const nickname = (full: string) => (full || "").split(/\s+/).filter(Boolean).pop() || full;

const PERIOD_SUFFIX: Record<string, string> = {
  h1: "1H",
  h2: "2H",
  q1: "Q1",
  q2: "Q2",
  q3: "Q3",
  q4: "Q4",
  p1: "1P",
  p2: "2P",
  p3: "3P",
  "1st_5_innings": "F5",
  "1st_1_innings": "1st Inning",
};

type Decoded = {
  base: "h2h" | "spreads" | "totals" | "other";
  period: string;
  alt: boolean;
  rawKey: string;
};

function evalPriceOk(price: number | null | undefined): boolean {
  return price != null && price > EVAL_ALT_MAX_JUICE;
}

function decodeMarketKey(key: string): Decoded | null {
  if (!key) return null;
  if (key === "h2h" || key === "spreads" || key === "totals") {
    return { base: key, period: "", alt: false, rawKey: key };
  }
  if (key === "alternate_spreads") return { base: "spreads", period: "", alt: true, rawKey: key };
  if (key === "alternate_totals") return { base: "totals", period: "", alt: true, rawKey: key };

  let m = key.match(/^alternate_(spreads|totals)_(h1|h2|q1|q2|q3|q4|p1|p2|p3)$/);
  if (m) {
    return {
      base: m[1] as "spreads" | "totals",
      period: PERIOD_SUFFIX[m[2]!] ?? m[2]!.toUpperCase(),
      alt: true,
      rawKey: key,
    };
  }

  m = key.match(/^(h2h|spreads|totals)_(h1|h2|q1|q2|q3|q4|p1|p2|p3|1st_5_innings|1st_1_innings)$/);
  if (m) {
    const suffix = m[2]!;
    const period =
      suffix === "1st_5_innings" ? "F5" : suffix === "1st_1_innings" ? "1st Inning" : PERIOD_SUFFIX[suffix] ?? suffix.toUpperCase();
    return { base: m[1] as Decoded["base"], period, alt: false, rawKey: key };
  }

  if (/^team_totals?$/i.test(key)) return { base: "totals", period: "", alt: false, rawKey: key };
  if (/^race_to/i.test(key)) return { base: "other", period: "", alt: false, rawKey: key };

  return { base: "other", period: "", alt: false, rawKey: key };
}

function humanizeUnknownKey(key: string): string {
  if (/^race_to/i.test(key)) {
    const tail = key.replace(/^race_to_?/i, "").replace(/_/g, " ").trim();
    return tail ? `Race To ${tail.replace(/\b\w/g, (c) => c.toUpperCase())}` : "Race To";
  }
  return key
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .replace(/\bH2h\b/, "Moneyline")
    .replace(/\bMl\b/, "ML")
    .trim();
}

function marketTitle(d: Decoded): string {
  if (d.base === "other") return humanizeUnknownKey(d.rawKey);
  if (d.rawKey.includes("team_total")) return "Team Total";
  const baseLabel =
    d.base === "h2h"
      ? "Moneyline"
      : d.base === "spreads"
        ? d.period === "F5"
          ? "F5 Run Line"
          : "Spread"
        : d.period === "F5"
          ? "F5 Total"
          : d.period === "1st Inning"
            ? "1st Inning Total"
            : "Total";
  const altPrefix = d.alt ? "Alt " : "";
  const periodPrefix = d.period && d.period !== "F5" && d.period !== "1st Inning" ? `${d.period} ` : d.period === "F5" ? "F5 " : d.period === "1st Inning" ? "" : "";
  if (d.base === "h2h" && d.period === "F5") return "F5 Moneyline";
  if (d.base === "h2h" && d.period) return `${d.period} Moneyline`;
  if (d.base === "spreads" && d.period === "F5") return "F5 Run Line";
  if (d.base === "totals" && d.period === "1st Inning") return "1st Inning Total";
  if (d.period && d.base !== "h2h") return `${periodPrefix}${altPrefix}${baseLabel}`.replace(/\s+/g, " ").trim();
  if (d.period) return `${periodPrefix}${baseLabel}`.trim();
  return `${altPrefix}${baseLabel}`.trim();
}

function pickForOutcome(
  d: Decoded,
  teamLabel: (name: string) => string,
  name: string,
  point: number | null | undefined,
): string {
  if (d.base === "h2h" || (d.base === "other" && /moneyline|h2h/i.test(d.rawKey))) {
    return `${teamLabel(name)} ML`;
  }
  if (d.base === "spreads" || (d.base === "other" && /spread|run_line|run line|handicap/i.test(d.rawKey))) {
    const pt = point == null ? "" : ` ${point > 0 ? "+" : ""}${point}`;
    return `${teamLabel(name)}${pt}`;
  }
  if (d.base === "totals" || d.base === "other") {
    const pt = point == null ? "" : ` ${point}`;
    return `${name}${pt}`.trim();
  }
  const pt = point == null ? "" : ` ${point}`;
  return `${teamLabel(name)}${pt}`.trim();
}

const scoreInputs = (o: OddsOutcome) => ({
  noVigFair: o.noVigFair ?? null,
  edge: o.edge ?? null,
  bookSpread: o.bookSpread ?? null,
});

const entryKey = (e: RealOddsEntry) => `${e.market}|${e.pick}`.toLowerCase();

/** Every posted game-line outcome on this event (all market keys, all rungs). */
export function discoverAllPostedGameLines(g: OddsGameForDiscovery): RealOddsEntry[] {
  if (!g?.markets?.length) return [];
  const game = `${g.awayTeam} @ ${g.homeTeam}`;
  const base = { sport: g.sport, game, startsAt: g.commenceTime };
  const isSoccer = g.sport === "soccer";
  const teamLabel = (name: string) => (isSoccer ? name : nickname(name));
  const out: RealOddsEntry[] = [];
  const seen = new Set<string>();

  for (const market of g.markets) {
    const decoded = decodeMarketKey(market.key);
    if (!decoded) continue;
    const title = marketTitle(decoded);
    for (const o of market.outcomes ?? []) {
      if (!evalPriceOk(o.price)) continue;
      const pick = pickForOutcome(decoded, teamLabel, o.name, o.point);
      const row: RealOddsEntry = { ...base, market: title, pick, odds: o.price, ...scoreInputs(o) };
      const k = entryKey(row);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(row);
    }
  }

  return out;
}

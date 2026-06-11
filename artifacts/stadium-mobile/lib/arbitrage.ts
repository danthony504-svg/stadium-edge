// Pure arbitrage detection from REAL bookmaker odds.
//
// No expo / network imports so this runs under `node --test` (see
// arbitrage.test.ts). Every input is a real posted price from the odds feed; an
// arbitrage is only emitted when two (or three) mutually-exclusive sides, each
// taken at its BEST available sportsbook, have combined implied probability
// < 100% — a genuine risk-free edge. Nothing here invents a price or a book, and
// a side with no named book is skipped (we can't tell the user where to bet it).

// ---- Structural input shapes (compatible with lib/api.ts OddsGame/PlayerProp).
// Defined locally so this file has zero runtime dependency on api.ts.
export type ArbBookPrice = { book: string; price: number; point?: number | null };
export type ArbOutcome = { name: string; price: number; point?: number | null; books?: ArbBookPrice[] };
export type ArbMarket = { key: string; outcomes: ArbOutcome[] };
export type ArbGame = {
  id: string;
  sport: string;
  homeTeam: string;
  awayTeam: string;
  commenceTime: string;
  markets: ArbMarket[];
};

export type ArbPropInput = {
  player: string;
  market: string;
  line: number | null;
  overPrice: number | null;
  underPrice: number | null;
  overBook?: string | null;
  underBook?: string | null;
  alt?: boolean;
};
export type ArbPropGame = {
  game: string;
  sport: string;
  startsAt?: string | null;
  props: ArbPropInput[];
};

export type ArbLeg = {
  label: string; // "Over 20.5", "Lakers ML", "Yes"
  book: string; // sportsbook to place this leg at
  price: number; // American odds
  impliedProb: number; // 0-1, from this price
};

export type ArbOpportunity = {
  id: string;
  sport: string;
  game: string; // "Away @ Home"
  marketKey: string; // raw key: h2h | spreads | totals | player_points | ...
  kind: "game" | "prop";
  player?: string | null;
  startsAt?: string | null;
  profitPct: number; // guaranteed return on total stake, in %
  legs: ArbLeg[];
};

// Extreme "arbs" are almost always a stale or mismatched line on one book, not a
// real risk-free bet — surfacing them as guaranteed money would be dishonest. We
// require a real positive edge and cap it to a believable ceiling.
export const MIN_ARB_PCT = 0.1;
export const MAX_ARB_PCT = 30;

const GAME_ARB_MARKETS = new Set(["h2h", "spreads", "totals"]);

export function impliedProb(american: number): number {
  return american > 0 ? 100 / (american + 100) : -american / (-american + 100);
}

export function americanToDecimal(american: number): number {
  return american > 0 ? american / 100 + 1 : 100 / -american + 1;
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const round2 = (n: number) => Math.round(n * 100) / 100;

// Combined no-vig check for a set of mutually-exclusive best prices. Returns the
// RAW (unrounded) guaranteed profit % and each side's implied prob, or null when
// there is no arb. Callers enforce MIN/MAX against the raw value so boundary
// artifacts can't slip through rounding, then round only for display.
export function computeArb(prices: number[]): { profitPct: number; impl: number[] } | null {
  if (prices.length < 2) return null;
  const impl = prices.map(impliedProb);
  const sum = impl.reduce((a, b) => a + b, 0);
  if (!(sum > 0) || sum >= 1) return null;
  return { profitPct: (1 / sum - 1) * 100, impl };
}

// Shared honesty gate: a real arb needs a positive edge inside the believable
// band AND every side placed at a DISTINCT sportsbook (a single book pricing a
// guaranteed loss against itself is a stale-line/palpable-error artifact, not a
// risk-free bet — and the product promise is "bet each side at a different
// book"). Returns the rounded display profit, or null to reject.
function acceptArb(rawProfitPct: number, books: string[]): number | null {
  if (rawProfitPct < MIN_ARB_PCT || rawProfitPct > MAX_ARB_PCT) return null;
  const named = books.map((b) => b.trim().toLowerCase());
  if (named.some((b) => b.length === 0)) return null;
  if (new Set(named).size !== named.length) return null;
  return round1(rawProfitPct);
}

// Split a total stake across the legs so every outcome returns the same amount
// (the defining property of an arbitrage). Stake_i = total * impliedProb_i / Σ.
export function computeStakes(impl: number[], total: number): number[] {
  const sum = impl.reduce((a, b) => a + b, 0);
  if (!(sum > 0)) return impl.map(() => 0);
  return impl.map((p) => round2((total * p) / sum));
}

// The guaranteed payout (same regardless of result) for a given total stake.
export function guaranteedReturn(impl: number[], total: number): number {
  const sum = impl.reduce((a, b) => a + b, 0);
  return sum > 0 ? round2(total / sum) : total;
}

function bestBook(o: ArbOutcome): ArbBookPrice | null {
  const books = o.books;
  if (!books || books.length === 0) return null; // no named book → can't place it
  let best = books[0];
  for (const b of books) {
    if (impliedProb(b.price) < impliedProb(best.price)) best = b;
  }
  return best;
}

// True only when a candidate group is a set of genuinely opposite, mutually-
// exclusive sides — guards against upstream mislabeling producing a "group" that
// isn't actually arbitrageable (e.g. two Overs, two same-sign spreads, or two
// outcomes naming the same team).
function isOppositeSides(key: string, g: ArbOutcome[]): boolean {
  const names = g.map((o) => o.name.trim().toLowerCase());
  if (names.some((n) => n.length === 0)) return false;
  if (new Set(names).size !== names.length) return false; // distinct sides only
  if (key === "h2h") return g.length >= 2;
  if (key === "totals") {
    if (g.length !== 2) return false;
    const overs = names.filter((n) => n.includes("over")).length;
    const unders = names.filter((n) => n.includes("under")).length;
    return overs === 1 && unders === 1;
  }
  if (key === "spreads") {
    if (g.length !== 2) return false;
    const [a, b] = g;
    // mirrored handicap: opposite signs, equal magnitude.
    return (a.point ?? 0) * (b.point ?? 0) < 0;
  }
  return false;
}

// Group a market's outcomes into mutually-exclusive sets:
//  - h2h: all outcomes are one set (2-way, or 3-way incl. Draw)
//  - totals: Over/Under sharing the same line (grouped by point)
//  - spreads: the two team sides at a mirrored line (grouped by |point|)
function mutexGroups(m: ArbMarket): ArbOutcome[][] {
  const outcomes = m.outcomes ?? [];
  let groups: ArbOutcome[][];
  if (m.key === "h2h") {
    groups = outcomes.length >= 2 ? [outcomes] : [];
  } else {
    const by = new Map<string, ArbOutcome[]>();
    for (const o of outcomes) {
      const key = m.key === "spreads" ? String(Math.abs(o.point ?? 0)) : String(o.point ?? "");
      const arr = by.get(key) ?? [];
      arr.push(o);
      by.set(key, arr);
    }
    // Only genuine two-sided groups can be arbed.
    groups = Array.from(by.values()).filter((g) => g.length === 2);
  }
  return groups.filter((g) => isOppositeSides(m.key, g));
}

function gameLegLabel(key: string, o: ArbOutcome): string {
  if (key === "totals") return `${o.name} ${o.point ?? ""}`.trim();
  if (key === "spreads") {
    const p = o.point ?? 0;
    return `${o.name} ${p > 0 ? "+" : ""}${p}`;
  }
  return `${o.name} ML`;
}

export function findGameLineArbs(games: ArbGame[]): ArbOpportunity[] {
  const out: ArbOpportunity[] = [];
  for (const g of games ?? []) {
    const gameLabel = `${g.awayTeam} @ ${g.homeTeam}`;
    for (const m of g.markets ?? []) {
      if (!GAME_ARB_MARKETS.has(m.key)) continue;
      for (const group of mutexGroups(m)) {
        const picks = group.map((o) => ({ o, b: bestBook(o) }));
        if (picks.some((p) => !p.b)) continue;
        const arb = computeArb(picks.map((p) => p.b!.price));
        if (!arb) continue;
        const profitPct = acceptArb(arb.profitPct, picks.map((p) => p.b!.book));
        if (profitPct == null) continue;
        const legs: ArbLeg[] = picks.map((p, i) => ({
          label: gameLegLabel(m.key, p.o),
          book: p.b!.book,
          price: p.b!.price,
          impliedProb: arb.impl[i],
        }));
        out.push({
          id: `${g.id}|${m.key}|${group.map((o) => `${o.name}${o.point ?? ""}`).join("/")}`,
          sport: g.sport,
          game: gameLabel,
          marketKey: m.key,
          kind: "game",
          startsAt: g.commenceTime,
          profitPct,
          legs,
        });
      }
    }
  }
  return out;
}

export function findPropArbs(games: ArbPropGame[]): ArbOpportunity[] {
  const out: ArbOpportunity[] = [];
  for (const g of games ?? []) {
    for (const p of g.props ?? []) {
      if (p.overPrice == null || p.underPrice == null) continue;
      if (!p.overBook || !p.underBook) continue; // need a real book for each side
      const arb = computeArb([p.overPrice, p.underPrice]);
      if (!arb) continue;
      const profitPct = acceptArb(arb.profitPct, [p.overBook, p.underBook]);
      if (profitPct == null) continue; // also rejects same-book both sides
      const yesNo = p.line == null;
      out.push({
        id: `${g.game}|${p.player}|${p.market}|${p.line ?? "_"}`,
        sport: g.sport,
        game: g.game,
        marketKey: p.market,
        kind: "prop",
        player: p.player,
        startsAt: g.startsAt ?? null,
        profitPct,
        legs: [
          {
            label: yesNo ? "Yes" : `Over ${p.line}`,
            book: p.overBook,
            price: p.overPrice,
            impliedProb: arb.impl[0],
          },
          {
            label: yesNo ? "No" : `Under ${p.line}`,
            book: p.underBook,
            price: p.underPrice,
            impliedProb: arb.impl[1],
          },
        ],
      });
    }
  }
  return out;
}

// Server mirror of stadium-mobile/lib/arbitrage.ts — the SAME edge-detection
// engine the in-app "Edge Lock" screen runs, ported verbatim so the daily push
// notification surfaces exactly what the screen shows. Keep the two in sync.
//
// Two flavours of edge from REAL bookmaker odds:
//   1. Arbitrage (guaranteed): two (or three) mutually-exclusive sides, each
//      taken at its BEST available sportsbook, with combined implied probability
//      < 100% — a genuine risk-free edge.
//   2. Value bets (higher upside, NOT guaranteed): a single REAL price that
//      beats the market's no-vig consensus fair value (positive expected value).
//
// Every input is a real posted price from the odds/props feeds. Nothing here
// invents a price or a book, and a side with no named book is skipped (we can't
// tell the user where to bet it). Pure — no db/network imports.

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
  // Server-computed cross-book +EV signal (REAL or absent — never fabricated).
  ev?: number | null;
  evSide?: "Over" | "Under" | null;
  fairProb?: number | null;
  edge?: number | null;
  books?: number;
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
// risk-free bet). Returns the rounded display profit, or null to reject.
function acceptArb(rawProfitPct: number, books: string[]): number | null {
  if (rawProfitPct < MIN_ARB_PCT || rawProfitPct > MAX_ARB_PCT) return null;
  const named = books.map((b) => b.trim().toLowerCase());
  if (named.some((b) => b.length === 0)) return null;
  if (new Set(named).size !== named.length) return null;
  return round1(rawProfitPct);
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
// isn't actually arbitrageable (e.g. two Overs, two same-sign spreads).
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

// Group a market's outcomes into mutually-exclusive sets.
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

// ---------------------------------------------------------------------------
// Value bets: a single REAL price that beats the market's no-vig consensus fair
// value (positive expected value). Higher upside than an arb, but NOT guaranteed.
// ---------------------------------------------------------------------------
export const MIN_VALUE_PCT = 2;
export const MAX_VALUE_PCT = 12;
export const MIN_VALUE_BOOKS = 3;

export type ValueBet = {
  id: string;
  sport: string;
  game: string; // "Away @ Home"
  marketKey: string;
  kind: "game" | "prop";
  player?: string | null;
  startsAt?: string | null;
  label: string; // the single side to bet, e.g. "Lakers ML", "Over 20.5"
  book: string; // best sportsbook for this price
  price: number; // American odds of the bet
  fairProb: number; // 0-1 no-vig consensus win prob for this side
  edgePct: number; // EV% = (fairProb * decimalOdds - 1) * 100
  books: number; // # of books in the consensus
};

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const n = s.length;
  if (n === 0) return NaN;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}

// Game-line value: for each mutually-exclusive group, build a no-vig fair line
// from the per-book consensus (robust median per side, normalised to sum to 1),
// then surface the single side whose BEST available price most beats fair value.
export function findGameLineValueBets(games: ArbGame[]): ValueBet[] {
  const out: ValueBet[] = [];
  for (const g of games ?? []) {
    const gameLabel = `${g.awayTeam} @ ${g.homeTeam}`;
    for (const m of g.markets ?? []) {
      if (!GAME_ARB_MARKETS.has(m.key)) continue;
      for (const group of mutexGroups(m)) {
        const perSide = group.map((o) => {
          const books = (o.books ?? []).filter((b) => b.book && b.book.trim().length > 0);
          let best = books[0] ?? null;
          for (const b of books) if (best && impliedProb(b.price) < impliedProb(best.price)) best = b;
          return { o, books, med: median(books.map((b) => impliedProb(b.price))), best };
        });
        // Need a credible consensus on every side, a named best price, and sane
        // medians — otherwise we can't trust the fair line.
        if (perSide.some((s) => s.books.length < MIN_VALUE_BOOKS || !s.best)) continue;
        if (perSide.some((s) => !Number.isFinite(s.med) || s.med <= 0)) continue;
        const sum = perSide.reduce((a, s) => a + s.med, 0);
        if (!(sum > 0)) continue;

        let bestSide: ValueBet | null = null;
        for (const s of perSide) {
          const fair = s.med / sum; // no-vig consensus prob for this side
          const best = s.best!;
          const edgePct = (fair * americanToDecimal(best.price) - 1) * 100;
          if (edgePct < MIN_VALUE_PCT || edgePct > MAX_VALUE_PCT) continue;
          const vb: ValueBet = {
            id: `v|${g.id}|${m.key}|${s.o.name}${s.o.point ?? ""}`,
            sport: g.sport,
            game: gameLabel,
            marketKey: m.key,
            kind: "game",
            startsAt: g.commenceTime,
            label: gameLegLabel(m.key, s.o),
            book: best.book,
            price: best.price,
            fairProb: fair,
            edgePct: round1(edgePct),
            books: s.books.length,
          };
          if (!bestSide || vb.edgePct > bestSide.edgePct) bestSide = vb;
        }
        if (bestSide) out.push(bestSide);
      }
    }
  }
  return out;
}

// Prop value: reuse the server's cross-book +EV signal (computed in props.ts from
// the no-vig consensus of real book prices). Never recomputed or invented — only
// surfaced when it clears the same believable band and has enough books and a
// real price+book on the value side.
export function findPropValueBets(games: ArbPropGame[]): ValueBet[] {
  const out: ValueBet[] = [];
  for (const g of games ?? []) {
    for (const p of g.props ?? []) {
      const ev = p.ev;
      if (ev == null || !p.evSide || p.fairProb == null) continue;
      if (ev < MIN_VALUE_PCT || ev > MAX_VALUE_PCT) continue;
      if ((p.books ?? 0) < MIN_VALUE_BOOKS) continue;
      const isOver = p.evSide === "Over";
      const price = isOver ? p.overPrice : p.underPrice;
      const book = isOver ? p.overBook : p.underBook;
      if (price == null || !book || !book.trim()) continue;
      const yesNo = p.line == null;
      const label = yesNo ? (isOver ? "Yes" : "No") : `${p.evSide} ${p.line}`;
      out.push({
        id: `v|${g.game}|${p.player}|${p.market}|${p.line ?? "_"}`,
        sport: g.sport,
        game: g.game,
        marketKey: p.market,
        kind: "prop",
        player: p.player,
        startsAt: g.startsAt ?? null,
        label,
        book,
        price,
        fairProb: p.fairProb,
        edgePct: round1(ev),
        books: p.books ?? 0,
      });
    }
  }
  return out;
}

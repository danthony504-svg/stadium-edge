import { Router, type IRouter } from "express";
import { cachedJson, rateLimit } from "../lib/sports";

// Golf (PGA majors) OUTRIGHT WINNER betting. The Odds API exposes golf only as
// "outrights" — the field-wide "to win the tournament" market — under a separate
// key PER major (golf_masters_tournament_winner, golf_pga_championship_winner,
// golf_us_open_winner, golf_the_open_championship_winner). Only the keys whose
// tournament is currently on the board come back `active`, so we discover the
// live ones from the Odds API sports list (same pattern tennis uses) rather than
// pinning a hardcoded major that goes empty the moment it ends.
//
// HONESTY: every number here is real bookmaker data. Per golfer we surface the
// BEST available price (line shopping across us + us2 books) plus a no-vig
// CONSENSUS fair win probability derived from the whole field across books — so
// the "value" flag means a real price that beats the market's own consensus, not
// an invented edge. Nothing is fabricated; a golfer with no books simply isn't
// listed.

const router: IRouter = Router();

router.use("/sports/golf", rateLimit({ windowMs: 60_000, max: 60, name: "golf" }));

type RawOutrightEvent = {
  id: string;
  sport_key: string;
  sport_title?: string;
  commence_time: string;
  bookmakers?: Array<{
    key?: string;
    title?: string;
    markets?: Array<{
      key: string;
      outcomes?: Array<{ name: string; price: number }>;
    }>;
  }>;
};

type GolfBookPrice = { book: string; price: number };
type GolfPlayer = {
  name: string;
  price: number; // best available American price
  decimal: number;
  fairProb: number; // no-vig consensus win probability (0..1)
  edgePct: number | null; // (fairProb*decimal - 1)*100, null when too few books
  value: boolean;
  bookCount: number;
  books: GolfBookPrice[];
};
type GolfTournament = {
  key: string;
  title: string;
  eventId: string;
  commenceTime: string;
  bookCount: number;
  field: GolfPlayer[];
};

const americanToDecimal = (a: number): number => (a > 0 ? a / 100 + 1 : 100 / -a + 1);
const americanToProb = (a: number): number => (a < 0 ? -a / (-a + 100) : 100 / (a + 100));
const median = (xs: number[]): number => {
  const s = xs.slice().sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

// A real price counts as "value" only when it clears this no-vig edge AND enough
// books priced the golfer to make the consensus meaningful (a one-book outlier is
// noise, not an edge).
//
// Critically, we DON'T compute an edge for deep longshots. Books slap a ceiling
// price (e.g. +500000) on golfers they haven't seriously priced; the no-vig prob
// of such a golfer is unreliable, so the edge math explodes into nonsense
// (300%+, "Tiger Woods 6607%"). A genuine, tradeable outright edge only exists on
// credibly-priced contenders, and a real cross-book discrepancy is single/low
// double digits — anything beyond VALUE_MAX_PCT is a stale/soft line, not value.
// We still LIST every golfer with their real price; we just don't claim an edge
// we can't honestly stand behind.
const VALUE_MIN_PCT = 3;
const VALUE_MAX_PCT = 40;
const MIN_VALUE_BOOKS = 3;
const MAX_VALUE_DECIMAL = 151; // best price longer than +15000 → no edge claim

// No single golfer in a 100+ player major field is ever a true favorite at these
// odds. Prices implying more than this (e.g. -100000, ~0.999) are placeholder /
// suspended lines a book posts before it sets a real market; treating them as a
// 99.9% win chance corrupts the consensus ("Tiger Woods 29.7% to win"). We drop
// any outcome shorter than -150 (~0.6 implied) outright.
const MAX_PLAUSIBLE_PROB = 0.6;

// Tournament title from the Odds API sport title ("US Open Winner") or, as a
// fallback, the key. We strip the trailing " Winner" the API appends to outright
// markets so the UI shows the clean event name.
function titleFromKey(key: string, apiTitle?: string): string {
  if (apiTitle) return apiTitle.replace(/\s+Winner$/i, "").trim();
  const map: Record<string, string> = {
    golf_masters_tournament_winner: "Masters Tournament",
    golf_pga_championship_winner: "PGA Championship",
    golf_us_open_winner: "US Open",
    golf_the_open_championship_winner: "The Open Championship",
  };
  return map[key] ?? key;
}

// Discover the live golf outright-winner keys (+ their titles) from the Odds API
// sports list. Cached 30 min — the major calendar changes on the order of weeks.
async function activeGolfKeys(apiKey: string): Promise<Array<{ key: string; title: string }>> {
  const list = await cachedJson<Array<{ key?: string; active?: boolean; title?: string }>>(
    "odds:sportslist:v1",
    30 * 60 * 1000,
    async () => {
      const r = await fetch(`https://api.the-odds-api.com/v4/sports/?apiKey=${apiKey}`);
      if (!r.ok) throw new Error(`Odds API sports list ${r.status}`);
      return (await r.json()) as Array<{ key?: string; active?: boolean; title?: string }>;
    },
  );
  return list
    .filter(
      (s) =>
        s.active === true &&
        typeof s.key === "string" &&
        s.key.startsWith("golf_") &&
        s.key.endsWith("_winner"),
    )
    .map((s) => ({ key: s.key as string, title: titleFromKey(s.key as string, s.title) }));
}

function buildField(ev: RawOutrightEvent): GolfPlayer[] {
  // Collect every book's price per golfer, plus each book's full set of field
  // probabilities so we can strip the vig (the overround) per book.
  const byPlayer = new Map<string, GolfBookPrice[]>();
  const bookProbs: Array<Map<string, number>> = []; // per book: golfer -> no-vig prob
  for (const b of ev.bookmakers ?? []) {
    const bookName = b.title || b.key || "Book";
    const market = (b.markets ?? []).find((m) => m.key === "outrights");
    if (!market?.outcomes?.length) continue;
    // Raw implied probs for THIS book, then normalize so the field sums to 1 —
    // that removes the book's overround and yields its honest view of each
    // golfer's win chance.
    const raw = new Map<string, number>();
    let sum = 0;
    for (const o of market.outcomes) {
      const p = americanToProb(o.price);
      if (!Number.isFinite(p) || p <= 0) continue;
      // Drop placeholder / suspended lines (e.g. -100000) — they're not a real
      // win probability and would poison the consensus.
      if (p > MAX_PLAUSIBLE_PROB) continue;
      raw.set(o.name, p);
      sum += p;
      let list = byPlayer.get(o.name);
      if (!list) { list = []; byPlayer.set(o.name, list); }
      list.push({ book: bookName, price: Math.round(o.price) });
    }
    if (sum <= 0) continue;
    const novig = new Map<string, number>();
    for (const [name, p] of raw) novig.set(name, p / sum);
    bookProbs.push(novig);
  }

  // Consensus fair prob per golfer = median of the per-book no-vig probs, then
  // renormalize across the field so the consensus itself sums to 1 (medians don't
  // necessarily). This is the market's blended honest win probability.
  const rawFair = new Map<string, number>();
  let fairSum = 0;
  for (const [name] of byPlayer) {
    const probs = bookProbs.map((m) => m.get(name)).filter((x): x is number => x != null);
    if (probs.length === 0) continue;
    const f = median(probs);
    rawFair.set(name, f);
    fairSum += f;
  }

  const field: GolfPlayer[] = [];
  for (const [name, prices] of byPlayer) {
    if (prices.length === 0) continue;
    const books = prices
      .slice()
      .sort((a, b) => americanToProb(a.price) - americanToProb(b.price)) // best price first
      .slice(0, 10);
    const best = books[0];
    if (!best) continue;
    const decimal = americanToDecimal(best.price);
    const rawF = rawFair.get(name);
    const fairProb = rawF != null && fairSum > 0 ? rawF / fairSum : 0;
    // Edge only for credibly-priced contenders with enough books behind the
    // consensus — deep longshots at the book ceiling get no edge claim (null).
    const bookCount = prices.length;
    const credible = bookCount >= MIN_VALUE_BOOKS && fairProb > 0 && decimal <= MAX_VALUE_DECIMAL;
    const edgePct = credible ? Math.round((fairProb * decimal - 1) * 1000) / 10 : null;
    // A believable edge is single/low-double digits; beyond VALUE_MAX_PCT it's a
    // stale/soft line, not real value.
    const value = edgePct != null && edgePct >= VALUE_MIN_PCT && edgePct <= VALUE_MAX_PCT;
    field.push({
      name,
      price: best.price,
      decimal: Math.round(decimal * 100) / 100,
      fairProb: Math.round(fairProb * 10000) / 10000,
      edgePct,
      value,
      bookCount,
      books,
    });
  }
  // Favorites first: highest consensus win probability, then shortest price.
  field.sort(
    (a, b) => b.fairProb - a.fairProb || americanToProb(b.price) - americanToProb(a.price),
  );
  return field;
}

router.get("/sports/golf", async (_req, res): Promise<void> => {
  const apiKey = process.env["ODDS_API_KEY"];
  if (!apiKey) {
    res.status(502).json({ error: "ODDS_API_KEY not configured" });
    return;
  }
  try {
    const keys = await activeGolfKeys(apiKey);
    if (keys.length === 0) {
      res.json([] as GolfTournament[]);
      return;
    }
    // Each active major is fetched + cached independently; one dead key must not
    // wipe the others (best-effort, per-key catch → empty).
    const tournaments = await Promise.all(
      keys.map(({ key, title }) =>
        cachedJson<RawOutrightEvent[]>(
          `golf:${key}:v1`,
          5 * 60 * 1000,
          async () => {
            const url = `https://api.the-odds-api.com/v4/sports/${key}/odds/?apiKey=${apiKey}&regions=us,us2&markets=outrights&oddsFormat=american`;
            const r = await fetch(url);
            if (!r.ok) {
              const text = await r.text();
              throw new Error(`Upstream ${r.status}: ${text.slice(0, 200)}`);
            }
            return (await r.json()) as RawOutrightEvent[];
          },
        )
          .then((events) => ({ key, title, events }))
          .catch(() => ({ key, title, events: [] as RawOutrightEvent[] })),
      ),
    );

    const out: GolfTournament[] = [];
    for (const { key, title, events } of tournaments) {
      // The outrights endpoint returns one event per tournament.
      const ev = events[0];
      if (!ev) continue;
      const field = buildField(ev);
      if (field.length === 0) continue;
      out.push({
        key,
        title,
        eventId: ev.id,
        commenceTime: ev.commence_time,
        bookCount: Math.max(0, ...field.map((p) => p.bookCount)),
        field,
      });
    }
    // Soonest tee-off first.
    out.sort((a, b) => Date.parse(a.commenceTime) - Date.parse(b.commenceTime));
    res.json(out);
  } catch (err) {
    res
      .status(502)
      .json({ error: err instanceof Error ? err.message : "Upstream error" });
  }
});

export default router;

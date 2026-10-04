/**
 * Cross-book preservation + honest no-vig for alt/period Odds API markets.
 *
 * Comparison identity is exact: market key + selection/side + description
 * (when present) + exact point/line. Alternate thresholds are never pooled
 * (Team +6.5 ≠ Team +10.5). Opposing sides are never synthesized.
 */

export type RawAltOutcome = {
  name: string;
  price: number;
  point?: number | null;
  description?: string | null;
};

export type RawAltBookmaker = {
  key?: string;
  title?: string;
  markets?: Array<{
    key: string;
    outcomes?: RawAltOutcome[];
  }>;
};

export type AltBookPrice = {
  book: string;
  price: number;
  point: number | null;
};

export type AltNormalizedOutcome = {
  name: string;
  price: number;
  point: number | null;
  books: AltBookPrice[];
  noVigFair: number | null;
  edge: number | null;
  bookSpread: number | null;
};

const MIN_DEVIG_BOOKS = 3;

export function americanToProb(a: number): number {
  return a < 0 ? -a / (-a + 100) : 100 / (a + 100);
}

function median(arr: number[]): number {
  const s = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/** Exact identity key — point is never rounded/bucketed. */
export function altOutcomeIdentity(
  name: string,
  point: number | null | undefined,
  description?: string | null,
): string {
  const desc = String(description ?? "").trim();
  const nm = String(name ?? "").trim();
  const pt = point == null || Number.isNaN(Number(point)) ? "" : String(Number(point));
  return `${desc}|${nm}|${pt}`;
}

/**
 * Display name: fold Odds API `description` (team) into Over/Under so team
 * totals stay distinguishable after normalization without a schema change.
 */
export function displayAltOutcomeName(name: string, description?: string | null): string {
  const nm = String(name ?? "").trim();
  const desc = String(description ?? "").trim();
  if (!desc) return nm;
  if (/^(over|under)$/i.test(nm)) return `${desc} ${nm}`;
  if (nm.toLowerCase().includes(desc.toLowerCase())) return nm;
  return `${desc} ${nm}`.trim();
}

type Family = "spreads" | "totals" | "h2h" | "btts" | "other";

export function altMarketFamily(marketKey: string): Family {
  const k = String(marketKey ?? "").toLowerCase();
  if (k === "btts" || k.startsWith("btts_")) return "btts";
  if (k.includes("team_total") || k.includes("totals")) return "totals";
  if (k.includes("spreads")) return "spreads";
  if (k.includes("h2h") || k === "draw_no_bet") return "h2h";
  return "other";
}

type Entry = {
  identity: string;
  name: string;
  point: number | null;
  description: string | null;
  books: AltBookPrice[];
};

function parseIdentity(identity: string): { description: string; name: string; point: number | null } {
  const [description = "", name = "", pt = ""] = identity.split("|");
  return {
    description,
    name,
    point: pt === "" ? null : Number(pt),
  };
}

/**
 * Find the real opposing side for no-vig. Returns null when the feed does not
 * contain a comparable opposite (never invents one).
 */
export function findOpposingIdentity(
  marketKey: string,
  identity: string,
  allIdentities: Iterable<string>,
): string | null {
  const family = altMarketFamily(marketKey);
  const self = parseIdentity(identity);
  const pool = Array.from(allIdentities);

  if (family === "spreads") {
    if (self.point == null) return null;
    const wantPoint = -self.point;
    // Exact opposite line + different selection (other team). Same description
    // bucket (usually empty for spreads).
    const hits = pool.filter((id) => {
      if (id === identity) return false;
      const o = parseIdentity(id);
      if (o.point == null) return false;
      if (o.point !== wantPoint) return false;
      if (o.description !== self.description) return false;
      if (o.name === self.name) return false;
      return true;
    });
    return hits.length === 1 ? hits[0]! : null;
  }

  if (family === "totals" || family === "btts") {
    const flip =
      /^over$/i.test(self.name) ? "Under" :
      /^under$/i.test(self.name) ? "Over" :
      /^yes$/i.test(self.name) ? "No" :
      /^no$/i.test(self.name) ? "Yes" :
      null;
    if (!flip) {
      // Name may already be "Team Over" after display fold — try trailing side.
      const m = self.name.match(/^(.*)\s+(Over|Under)$/i);
      if (!m) return null;
      const team = m[1]!.trim();
      const side = /^over$/i.test(m[2]!) ? "Under" : "Over";
      const want = altOutcomeIdentity(`${team} ${side}`, self.point, self.description);
      return pool.includes(want) ? want : null;
    }
    const want = altOutcomeIdentity(flip, self.point, self.description);
    return pool.includes(want) ? want : null;
  }

  if (family === "h2h") {
    // Clean two-way only (no Draw third way). Same point/description (usually null).
    const peers = pool.filter((id) => {
      const o = parseIdentity(id);
      return o.point === self.point && o.description === self.description;
    });
    if (peers.length !== 2) return null;
    return peers.find((id) => id !== identity) ?? null;
  }

  return null;
}

function buildEntries(marketKey: string, bookmakers: RawAltBookmaker[]): Entry[] {
  const byId = new Map<string, Entry>();
  for (const b of bookmakers) {
    const bookName = b.title || b.key || "Book";
    for (const m of b.markets ?? []) {
      if (m.key !== marketKey) continue;
      for (const o of m.outcomes ?? []) {
        const point = o.point == null || Number.isNaN(Number(o.point)) ? null : Number(o.point);
        const description = String(o.description ?? "").trim() || null;
        const rawName = String(o.name ?? "").trim();
        if (!rawName) continue;
        const identity = altOutcomeIdentity(rawName, point, description);
        const displayName = displayAltOutcomeName(rawName, description);
        let entry = byId.get(identity);
        if (!entry) {
          entry = {
            identity,
            name: displayName,
            point,
            description,
            books: [],
          };
          byId.set(identity, entry);
        }
        entry.books.push({
          book: bookName,
          price: Math.round(o.price),
          point,
        });
      }
    }
  }
  return Array.from(byId.values());
}

/**
 * Normalize one alt/period market across bookmakers: keep every real book
 * price for the exact line, then apply cross-book no-vig when a real opposing
 * side exists on ≥ MIN_DEVIG_BOOKS books.
 */
export function normalizeAltPeriodMarket(
  marketKey: string,
  bookmakers: RawAltBookmaker[],
): AltNormalizedOutcome[] {
  const entries = buildEntries(marketKey, bookmakers);
  if (!entries.length) return [];

  const identities = entries.map((e) => e.identity);
  const byId = new Map(entries.map((e) => [e.identity, e]));

  return entries.map((entry) => {
    const books = entry.books
      .slice()
      .sort((a, b) => americanToProb(a.price) - americanToProb(b.price))
      .slice(0, 10);
    const best = books[0];

    let bookSpread: number | null = null;
    if (best && entry.books.length >= 2) {
      const impls = entry.books.map((b) => americanToProb(b.price));
      bookSpread = Math.round((median(impls) - americanToProb(best.price)) * 1000) / 10;
    }

    let noVigFair: number | null = null;
    let edge: number | null = null;
    const oppId = findOpposingIdentity(marketKey, entry.identity, identities);
    const other = oppId ? byId.get(oppId) : null;
    if (best && other) {
      const otherByBook = new Map(other.books.map((b) => [b.book, b.price]));
      const fairs: number[] = [];
      for (const b of entry.books) {
        const op = otherByBook.get(b.book);
        if (op == null) continue;
        const ti = americanToProb(b.price);
        const oi = americanToProb(op);
        const tot = ti + oi;
        if (tot <= 0) continue;
        fairs.push(ti / tot);
      }
      if (fairs.length >= MIN_DEVIG_BOOKS) {
        const fair = median(fairs);
        edge = Math.round((fair - americanToProb(best.price)) * 1000) / 10;
        noVigFair = Math.round(fair * 1000) / 1000;
      }
    }

    return {
      name: entry.name,
      price: best ? best.price : 0,
      point: entry.point,
      books,
      noVigFair,
      edge,
      bookSpread,
    };
  });
}

/**
 * Build alt/period market map from a raw per-event Odds API payload.
 * Keys are market keys; values are normalized outcomes with books[].
 */
export function mergeAltPeriodMarkets(
  bookmakers: RawAltBookmaker[],
  marketKeys: string[],
): Map<string, AltNormalizedOutcome[]> {
  const out = new Map<string, AltNormalizedOutcome[]>();
  const keySet = new Set(marketKeys);
  const present = new Set<string>();
  for (const b of bookmakers) {
    for (const m of b.markets ?? []) {
      if (keySet.has(m.key)) present.add(m.key);
    }
  }
  for (const key of marketKeys) {
    if (!present.has(key)) continue;
    const outcomes = normalizeAltPeriodMarket(key, bookmakers);
    if (outcomes.length) out.set(key, outcomes);
  }
  return out;
}

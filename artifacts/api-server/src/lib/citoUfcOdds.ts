// Cito API UFC prop odds — second provider for method/round props while The Odds
// API continues to serve moneyline, spread, and total rounds. Fail-closed when
// CITO_API_KEY is missing or a bout has no posted prop lines.

import { cachedJson } from "./sports.js";
import { normFighter } from "./ufc.js";

const CITO_BASE = "https://api.citoapi.com/api/v1";
const SEARCH_TTL = 6 * 60 * 60 * 1000;
const ODDS_TTL = 5 * 60 * 1000;

export type UfcPropOutcome = {
  name: string;
  price: number;
  book: string | null;
  point?: number | null;
};

export type UfcFightPropMarket = {
  key: string;
  label: string;
  outcomes: UfcPropOutcome[];
};

export type UfcFightPropsBundle = {
  boutId: string | null;
  provider: "cito" | null;
  markets: UfcFightPropMarket[];
};

export const UFC_PROP_MARKET_LABELS: Record<string, string> = {
  method_of_victory: "Method of Victory",
  goes_distance: "Fight Goes the Distance",
  exact_round: "Exact Round",
  ko_tko: "KO/TKO",
  submission: "Submission",
  decision: "Decision",
};

function citoKey(): string | null {
  const k = process.env["CITO_API_KEY"];
  return k && k.trim() ? k.trim() : null;
}

async function citoFetch(path: string): Promise<unknown> {
  const key = citoKey();
  if (!key) return null;
  const url = path.startsWith("http") ? path : `${CITO_BASE}${path}`;
  const r = await fetch(url, { headers: { "x-api-key": key } });
  if (!r.ok) return null;
  return r.json();
}

function unwrapData(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const o = raw as Record<string, unknown>;
  if (o.data != null) return o.data;
  return raw;
}

function asArray<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

function parseAmerican(v: unknown): number | null {
  const n = typeof v === "string" ? parseFloat(v) : Number(v);
  return Number.isFinite(n) ? n : null;
}

function bookLabel(v: unknown): string | null {
  if (!v) return null;
  if (typeof v === "string") return v;
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    const name = o.name ?? o.key ?? o.slug ?? o.bookmaker ?? o.id;
    return name != null ? String(name) : null;
  }
  return null;
}

function outcomeName(row: Record<string, unknown>): string {
  const parts = [
    row.outcome,
    row.name,
    row.label,
    row.selection,
    row.description,
    row.side,
  ];
  for (const p of parts) {
    if (p != null && String(p).trim()) return String(p).trim();
  }
  const fighter = row.fighter ?? row.competitor;
  const method = row.method ?? row.marketOutcome;
  if (fighter && method) return `${fighter} by ${method}`;
  if (fighter) return String(fighter).trim();
  return "";
}

function parseOutcomeRows(rows: unknown): UfcPropOutcome[] {
  const out: UfcPropOutcome[] = [];
  for (const row of asArray<Record<string, unknown>>(rows)) {
    const name = outcomeName(row);
    const price = parseAmerican(row.odds ?? row.price ?? row.american ?? row.americanOdds);
    if (!name || price == null) continue;
    const book = bookLabel(row.bookmaker ?? row.book ?? row.sportsbook ?? row.source);
    const pointRaw = row.point ?? row.line ?? row.total;
    const point = pointRaw != null && Number.isFinite(Number(pointRaw)) ? Number(pointRaw) : null;
    out.push({ name, price, book, point });
  }
  return out;
}

function dedupeOutcomes(rows: UfcPropOutcome[]): UfcPropOutcome[] {
  const best = new Map<string, UfcPropOutcome>();
  for (const o of rows) {
    const k = `${o.book ?? ""}|${o.name}|${o.point ?? ""}`;
    const cur = best.get(k);
    if (!cur) {
      best.set(k, o);
      continue;
    }
    // Keep the better price for the bettor (higher payout on plus, less juice on minus).
    if (o.price > 0 && (cur.price <= 0 || o.price > cur.price)) best.set(k, o);
    else if (o.price < 0 && (cur.price >= 0 || o.price > cur.price)) best.set(k, o);
  }
  return [...best.values()];
}

function nameTokens(s: string): Set<string> {
  return new Set(normFighter(s).split(" ").filter((t) => t.length > 1));
}

function fightersMatchBout(
  bout: Record<string, unknown>,
  away: string,
  home: string,
): boolean {
  const awayN = normFighter(away);
  const homeN = normFighter(home);
  const names: string[] = [];
  const push = (v: unknown) => {
    if (v != null && String(v).trim()) names.push(String(v).trim());
  };
  push(bout.fighterA);
  push(bout.fighterB);
  push(bout.fighter1);
  push(bout.fighter2);
  push(bout.red);
  push(bout.blue);
  for (const f of asArray<Record<string, unknown>>(bout.fighters)) {
    push(f.name ?? f.displayName ?? f.fullName ?? f.slug);
  }
  const fighters = asArray<unknown>(bout.fighters);
  for (const f of fighters) {
    if (typeof f === "string") push(f);
  }
  if (names.length < 2) {
    const title = String(bout.title ?? bout.matchup ?? bout.label ?? "");
    if (title.includes(" vs ")) {
      const [a, b] = title.split(/\s+vs\s+/i);
      push(a);
      push(b);
    }
  }
  if (names.length < 2) return false;
  const normalized = names.map((n) => normFighter(n));
  const hasAway = normalized.some((n) => n === awayN || n.includes(awayN) || awayN.includes(n));
  const hasHome = normalized.some((n) => n === homeN || n.includes(homeN) || homeN.includes(n));
  return hasAway && hasHome;
}

function boutIdFrom(row: Record<string, unknown>): string | null {
  const id = row.boutId ?? row.id ?? row.fightId ?? row.dataId;
  return id != null ? String(id) : null;
}

async function searchBoutId(away: string, home: string): Promise<string | null> {
  const cacheKey = `cito:bout:${normFighter(away)}|${normFighter(home)}`;
  return cachedJson<string | null>(cacheKey, SEARCH_TTL, async () => {
    const queries = [
      `${away} ${home}`,
      `${away} vs ${home}`,
      away,
      home,
    ];
    for (const q of queries) {
      const raw = await citoFetch(`/ufc/search?q=${encodeURIComponent(q)}`);
      const data = unwrapData(raw);
      const items = asArray<Record<string, unknown>>(data);
      for (const item of items) {
        const type = String(item.type ?? item.kind ?? "").toLowerCase();
        if (type && !type.includes("bout") && !type.includes("fight")) continue;
        if (fightersMatchBout(item, away, home)) {
          const id = boutIdFrom(item);
          if (id) return id;
        }
      }
      // Some search responses nest results.
      if (data && typeof data === "object") {
        const nested = asArray<Record<string, unknown>>((data as Record<string, unknown>).results);
        for (const item of nested) {
          if (fightersMatchBout(item, away, home)) {
            const id = boutIdFrom(item);
            if (id) return id;
          }
        }
      }
    }

    // Walk upcoming events when search misses.
    const upcoming = unwrapData(await citoFetch("/ufc/events/upcoming"));
    const events = asArray<Record<string, unknown>>(upcoming);
    for (const ev of events.slice(0, 8)) {
      const slug = String(ev.slug ?? ev.id ?? ev.eventId ?? "");
      if (!slug) continue;
      const boutsRaw = unwrapData(await citoFetch(`/ufc/events/${encodeURIComponent(slug)}/bouts`));
      const bouts = asArray<Record<string, unknown>>(boutsRaw);
      for (const bout of bouts) {
        if (fightersMatchBout(bout, away, home)) {
          const id = boutIdFrom(bout);
          if (id) return id;
        }
      }
    }
    return null;
  });
}

type RawMarketMap = Record<string, UfcPropOutcome[]>;

function collectMarketsFromNode(node: unknown, into: RawMarketMap) {
  if (!node || typeof node !== "object") return;
  const o = node as Record<string, unknown>;

  const marketKeys = [
    "method_of_victory",
    "exact_round",
    "round_method",
    "fight_total",
    "finish_only_moneyline",
    "goes_distance",
    "goes_the_distance",
    "distance",
  ];

  const marketsObj = o.markets ?? o.odds ?? o.betting ?? o.props;
  if (marketsObj && typeof marketsObj === "object") {
    const m = marketsObj as Record<string, unknown>;
    for (const key of marketKeys) {
      const rows = m[key];
      if (!rows) continue;
      const parsed = parseOutcomeRows(rows);
      if (parsed.length) {
        into[key] = [...(into[key] ?? []), ...parsed];
      }
    }
    // Array-of-markets shape: [{ market: "method_of_victory", outcomes: [...] }]
    if (Array.isArray(marketsObj)) {
      for (const mk of marketsObj as Record<string, unknown>[]) {
        const mkKey = String(mk.market ?? mk.key ?? mk.type ?? "").toLowerCase();
        if (!mkKey) continue;
        const parsed = parseOutcomeRows(mk.outcomes ?? mk.selections ?? mk.lines);
        if (parsed.length) into[mkKey] = [...(into[mkKey] ?? []), ...parsed];
      }
    }
  }

  for (const key of marketKeys) {
    if (o[key]) {
      const parsed = parseOutcomeRows(o[key]);
      if (parsed.length) into[key] = [...(into[key] ?? []), ...parsed];
    }
  }
}

function parseRawOddsPayload(raw: unknown): RawMarketMap {
  const into: RawMarketMap = {};
  const data = unwrapData(raw);
  collectMarketsFromNode(data, into);

  // Event-level payload may nest fights.
  const fights = asArray<Record<string, unknown>>(
    (data as Record<string, unknown> | null)?.fights ??
      (data as Record<string, unknown> | null)?.bouts,
  );
  for (const f of fights) collectMarketsFromNode(f, into);

  for (const k of Object.keys(into)) {
    into[k] = dedupeOutcomes(into[k]!);
  }
  return into;
}

function isDistanceOutcome(name: string): boolean {
  const n = normFighter(name);
  return (
    n.includes("goes distance") ||
    n.includes("go the distance") ||
    n === "yes" ||
    n === "no" ||
    n.includes("to decision")
  );
}

function isKoTkoOutcome(name: string): boolean {
  const n = normFighter(name);
  return n.includes("ko") || n.includes("tko") || n.includes("knockout");
}

function isSubOutcome(name: string): boolean {
  const n = normFighter(name);
  return n.includes("submission") || n.includes(" sub");
}

function isDecisionOutcome(name: string): boolean {
  const n = normFighter(name);
  return n.includes("decision") || n.includes("points");
}

function isExactRoundOutcome(name: string): boolean {
  const n = normFighter(name);
  return /round\s*\d/.test(n) || /^r\d$/.test(n) || /^\d(st|nd|rd|th)\s*round/.test(n);
}

function normalizeMarkets(raw: RawMarketMap, away: string, home: string): UfcFightPropMarket[] {
  const markets: UfcFightPropMarket[] = [];

  const mov = raw.method_of_victory ?? [];
  if (mov.length) {
    markets.push({
      key: "method_of_victory",
      label: UFC_PROP_MARKET_LABELS.method_of_victory,
      outcomes: mov,
    });
  }

  const distanceRows = [
    ...(raw.goes_distance ?? []),
    ...(raw.goes_the_distance ?? []),
    ...(raw.distance ?? []),
    ...(raw.fight_total ?? []).filter((o) => isDistanceOutcome(o.name)),
  ];
  if (distanceRows.length) {
    markets.push({
      key: "goes_distance",
      label: UFC_PROP_MARKET_LABELS.goes_distance,
      outcomes: dedupeOutcomes(distanceRows),
    });
  }

  const exactRows = [
    ...(raw.exact_round ?? []),
    ...(raw.round_method ?? []).filter((o) => isExactRoundOutcome(o.name)),
  ];
  if (exactRows.length) {
    markets.push({
      key: "exact_round",
      label: UFC_PROP_MARKET_LABELS.exact_round,
      outcomes: dedupeOutcomes(exactRows),
    });
  }

  const koRows = mov.filter((o) => isKoTkoOutcome(o.name));
  if (koRows.length) {
    markets.push({
      key: "ko_tko",
      label: UFC_PROP_MARKET_LABELS.ko_tko,
      outcomes: dedupeOutcomes(koRows),
    });
  }

  const subRows = mov.filter((o) => isSubOutcome(o.name));
  if (subRows.length) {
    markets.push({
      key: "submission",
      label: UFC_PROP_MARKET_LABELS.submission,
      outcomes: dedupeOutcomes(subRows),
    });
  }

  const decRows = mov.filter((o) => isDecisionOutcome(o.name));
  if (decRows.length) {
    markets.push({
      key: "decision",
      label: UFC_PROP_MARKET_LABELS.decision,
      outcomes: dedupeOutcomes(decRows),
    });
  }

  // Drop empty markets and markets with no finite prices.
  return markets
    .map((m) => ({
      ...m,
      outcomes: m.outcomes.filter((o) => Number.isFinite(o.price) && o.name.trim()),
    }))
    .filter((m) => m.outcomes.length > 0);
}

export function availableUfcPropKeys(markets: UfcFightPropMarket[]): string[] {
  return markets.map((m) => m.key);
}

export function adjustUnavailableMarkets(
  base: readonly string[],
  availableKeys: string[],
): string[] {
  const has = new Set(availableKeys);
  const dropIf = (label: string, keys: string[]) => {
    if (keys.some((k) => has.has(k))) return true;
    return false;
  };
  return base.filter((label) => {
    if (label === "Method of victory" && dropIf(label, ["method_of_victory", "ko_tko", "submission", "decision"]))
      return false;
    if (
      label === "Fight goes the distance / doesn't go the distance" &&
      dropIf(label, ["goes_distance"])
    )
      return false;
    if (label === "Over/Under rounds" && has.has("exact_round")) return false;
    return true;
  });
}

// Export for unit tests — normalizes a raw Cito fight-odds payload.
export function parseCitoOddsPayload(raw: unknown, away = "", home = ""): UfcFightPropMarket[] {
  const parsed = parseRawOddsPayload(raw);
  return normalizeMarkets(parsed, away, home);
}

export async function fetchUfcFightProps(away: string, home: string): Promise<UfcFightPropsBundle> {
  if (!citoKey()) {
    return { boutId: null, provider: null, markets: [] };
  }
  const boutId = await searchBoutId(away, home);
  if (!boutId) {
    return { boutId: null, provider: null, markets: [] };
  }
  const cacheKey = `cito:odds:${boutId}`;
  const raw = await cachedJson<unknown>(cacheKey, ODDS_TTL, async () =>
    citoFetch(`/ufc/fights/${encodeURIComponent(boutId)}/odds?bookmaker=all`),
  );
  if (!raw) {
    return { boutId, provider: null, markets: [] };
  }
  const parsed = parseRawOddsPayload(raw);
  const markets = normalizeMarkets(parsed, away, home);
  return {
    boutId,
    provider: markets.length ? "cito" : null,
    markets,
  };
}

export function isCitoConfigured(): boolean {
  return !!citoKey();
}

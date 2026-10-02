// Discover every sportsbook-posted game-line outcome on an OddsGame — including
// live boards, race-to markets, team totals, and any new market key the feed
// adds without a client release.

import type { OddsGame, OddsOutcome, RealOddsEntry } from "./api.ts";

const EVAL_ALT_MAX_JUICE = -1000;

const nickname = (full: string) => (full || "").split(/\s+/).filter(Boolean).pop() || full;

/** True when bare nicknames collide across schools / with pro teams. */
function usesFullTeamLabel(sport: string | null | undefined): boolean {
  const s = String(sport ?? "").toLowerCase();
  return (
    s === "ncaaf" ||
    s === "ncaab" ||
    s === "cfb" ||
    s === "cbb" ||
    s === "soccer"
  );
}

/** Pro boards keep short nicknames; college / soccer keep disambiguating names. */
export function gameLineTeamLabel(
  fullName: string,
  sport: string | null | undefined,
): string {
  const name = String(fullName ?? "").trim();
  if (!name) return name;
  if (usesFullTeamLabel(sport)) return name;
  return nickname(name);
}


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
  // Odds API keys are lowercase; display paths sometimes uppercase ("SPREADS_Q2").
  const raw = String(key).trim();
  const k = raw.toLowerCase();
  if (k === "h2h" || k === "spreads" || k === "totals") {
    return { base: k, period: "", alt: false, rawKey: k };
  }
  if (k === "alternate_spreads") return { base: "spreads", period: "", alt: true, rawKey: k };
  if (k === "alternate_totals") return { base: "totals", period: "", alt: true, rawKey: k };

  let m = k.match(/^alternate_(spreads|totals)_(h1|h2|q1|q2|q3|q4|p1|p2|p3)$/);
  if (m) {
    return {
      base: m[1] as "spreads" | "totals",
      period: PERIOD_SUFFIX[m[2]!] ?? m[2]!.toUpperCase(),
      alt: true,
      rawKey: k,
    };
  }

  m = k.match(/^(h2h|spreads|totals)_(h1|h2|q1|q2|q3|q4|p1|p2|p3|1st_5_innings|1st_1_innings)$/);
  if (m) {
    const suffix = m[2]!;
    const period =
      suffix === "1st_5_innings" ? "F5" : suffix === "1st_1_innings" ? "1st Inning" : PERIOD_SUFFIX[suffix] ?? suffix.toUpperCase();
    return { base: m[1] as Decoded["base"], period, alt: false, rawKey: k };
  }

  // Team totals = team props (points O/U) — FanDuel-style college boards lean on
  // these + period spreads, not player yards. Include alt + quarter/half keys.
  m = k.match(/^alternate_team_totals(?:_(h1|h2|q1|q2|q3|q4|p1|p2|p3))?$/);
  if (m) {
    return {
      base: "totals",
      period: m[1] ? PERIOD_SUFFIX[m[1]] ?? m[1].toUpperCase() : "",
      alt: true,
      rawKey: k,
    };
  }
  m = k.match(/^team_totals(?:_(h1|h2|q1|q2|q3|q4|p1|p2|p3))?$/);
  if (m) {
    return {
      base: "totals",
      period: m[1] ? PERIOD_SUFFIX[m[1]] ?? m[1].toUpperCase() : "",
      alt: false,
      rawKey: k,
    };
  }
  if (/^race_to/i.test(k)) return { base: "other", period: "", alt: false, rawKey: k };

  return { base: "other", period: "", alt: false, rawKey: k };
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
  // Team totals are team props (not game totals) — keep "Team Total" in the label.
  if (d.rawKey.includes("team_total")) {
    const altPrefix = d.alt ? "Alt " : "";
    const periodPrefix = d.period ? `${d.period} ` : "";
    return `${periodPrefix}${altPrefix}Team Total`.replace(/\s+/g, " ").trim();
  }
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

/**
 * Odds API key → card label ("spreads_q2" / "SPREADS_Q2" → "Q2 Spread").
 * Already-human labels ("Q2 Spread", "Spread") pass through unchanged.
 */
export function humanizeOddsApiMarketKey(key: string | null | undefined): string {
  const raw = String(key ?? "").trim();
  if (!raw) return "";
  // Already a friendly coach/slip label — don't re-decode.
  if (/\b(spread|total|moneyline|run line|puck line|handicap)\b/i.test(raw) && !/^(h2h|spreads|totals)(_|$)/i.test(raw)) {
    return raw;
  }
  const decoded = decodeMarketKey(raw);
  if (!decoded) return raw;
  // Unknown feed keys that aren't Odds API families — leave humanized unknowns.
  if (decoded.base === "other" && !/^(h2h|spreads|totals|alternate_|team_total|race_to)/i.test(decoded.rawKey)) {
    // If it already looks like a display label (spaces / Title Case), keep it.
    if (/\s/.test(raw) || /[A-Z]/.test(raw.slice(1))) return raw;
  }
  return marketTitle(decoded);
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
  // Team totals: keep school/team + Over/Under so college cards read as team props.
  if (d.rawKey.includes("team_total")) {
    const side = /\bunder\b/i.test(name) ? "Under" : /\bover\b/i.test(name) ? "Over" : null;
    const teamRaw = name.replace(/\s*(over|under)\s*/i, " ").trim();
    const team = teamLabel(teamRaw) || teamLabel(name);
    const pt = point == null ? "" : ` ${point}`;
    if (side && team) return `${team} ${side}${pt}`;
    return `${teamLabel(name)}${pt}`.trim();
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
export function discoverAllPostedGameLines(g: OddsGame): RealOddsEntry[] {
  if (!g?.markets?.length) return [];
  const game = `${g.awayTeam} @ ${g.homeTeam}`;
  const base = { sport: g.sport, game, startsAt: g.commenceTime };
  // College nicknames collide (Tigers/Bulldogs) and with pro boards (49ers).
  // Phone: "7 leg college" showed bare "49ers +27.5" — looked like NFL SF.
  const teamLabel = (name: string) => gameLineTeamLabel(name, g.sport);
  const out: RealOddsEntry[] = [];
  const seen = new Set<string>();

  for (const market of g.markets) {
    const decoded = decodeMarketKey(market.key);
    if (!decoded) continue;
    const title = marketTitle(decoded);
    for (const o of market.outcomes ?? []) {
      if (!evalPriceOk(o.price)) continue;
      const pick = pickForOutcome(decoded, teamLabel, o.name, o.point);
      const row: RealOddsEntry = { ...base, market: title, pick, odds: o.price!, ...scoreInputs(o) };
      const k = entryKey(row);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(row);
    }
  }

  return out;
}

/** Union eval ladder rows with every raw posted line (ladder wins on collision). */
export function mergeEvalLadderWithDiscovered(
  ladder: RealOddsEntry[],
  discovered: RealOddsEntry[],
): RealOddsEntry[] {
  const map = new Map<string, RealOddsEntry>();
  for (const e of discovered) map.set(entryKey(e), e);
  for (const e of ladder) map.set(entryKey(e), e);
  return [...map.values()];
}

export function buildFullEvalLinesForGame(g: OddsGame, ladder: RealOddsEntry[]): RealOddsEntry[] {
  return mergeEvalLadderWithDiscovered(ladder, discoverAllPostedGameLines(g));
}

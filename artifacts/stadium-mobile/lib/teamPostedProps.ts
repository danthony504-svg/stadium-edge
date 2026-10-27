/**
 * Posted TEAM props from the odds feed — team totals / alternate team totals
 * (+ period variants) only. Never moneylines, spreads, or combined game totals.
 *
 * Identity: full-name word-boundary match (teamNameMatches). Outcomes without a
 * clear team token are dropped (fail closed). No invented prices or stats.
 */

import type { OddsGame, OddsOutcome, RealOddsEntry } from "./api.ts";
import { teamNameMatches } from "./injuries.ts";
import {
  gameLineTeamLabel,
  humanizeOddsApiMarketKey,
} from "./postedMarketDiscovery.ts";

const TEAM_TOTAL_KEY =
  /^(?:alternate_)?team_totals(?:_(?:h1|h2|q1|q2|q3|q4|p1|p2|p3))?$/i;

/** True when the Odds API market key is a team-total (team prop) family. */
export function isTeamTotalMarketKey(key: string | null | undefined): boolean {
  return TEAM_TOTAL_KEY.test(String(key ?? "").trim());
}

export type TeamPostedProp = {
  sport: string;
  game: string;
  eventId: string;
  marketKey: string;
  /** Human label, e.g. "Team Total", "Alt Team Total", "Q2 Team Total". */
  market: string;
  pick: string;
  /** Event home/away full name this prop belongs to. */
  team: string;
  side: "Over" | "Under";
  line: number | null;
  odds: number;
  /** Best sportsbook when the feed supplies books[]; otherwise null. */
  sportsbook: string | null;
  /**
   * Quote timestamp when the feed supplies one. Odds outcomes currently omit
   * last_update — always null until the server carries it (never invented).
   */
  quoteUpdatedAt: string | null;
  startsAt?: string;
  books: Array<{ book: string; price: number; point?: number | null }>;
};

export type TeamPostedPropsResult = {
  game: OddsGame;
  rows: TeamPostedProp[];
};

/** Parse Over/Under + remaining team token from an outcome name. Fail closed. */
export function parseTeamTotalOutcome(
  name: string,
): { side: "Over" | "Under"; teamToken: string } | null {
  const raw = String(name ?? "").trim();
  if (!raw) return null;
  const m = raw.match(/^(.*?)\s*(over|under)\s*(.*)$/i);
  if (!m) return null;
  const side = /^under$/i.test(m[2]!) ? "Under" : "Over";
  const teamToken = `${m[1] ?? ""} ${m[3] ?? ""}`.replace(/\s+/g, " ").trim();
  // Bare "Over"/"Under" with no team token — cannot attribute to a side.
  if (!teamToken) return null;
  return { side, teamToken };
}

/**
 * Resolve which event side (home/away full name) an outcome belongs to.
 * Requires an unambiguous match to exactly one of home/away via teamNameMatches.
 */
export function resolveOutcomeTeam(
  teamToken: string,
  homeTeam: string,
  awayTeam: string,
): string | null {
  const homeHit = teamNameMatches(teamToken, homeTeam);
  const awayHit = teamNameMatches(teamToken, awayTeam);
  if (homeHit && !awayHit) return homeTeam;
  if (awayHit && !homeHit) return awayTeam;
  return null;
}

function bestSportsbook(o: OddsOutcome): string | null {
  const books = o.books;
  if (!books?.length) return null;
  const book = String(books[0]?.book ?? "").trim();
  return book || null;
}

function toPostedProp(
  g: OddsGame,
  marketKey: string,
  o: OddsOutcome,
  teamFull: string,
  side: "Over" | "Under",
): TeamPostedProp | null {
  if (o.price == null || !Number.isFinite(o.price)) return null;
  const label = gameLineTeamLabel(teamFull, g.sport);
  const line = o.point == null || !Number.isFinite(o.point) ? null : Number(o.point);
  const pt = line == null ? "" : ` ${line}`;
  const market = humanizeOddsApiMarketKey(marketKey) || "Team Total";
  // Refuse labels that look like game totals / ML / spread.
  if (!/team\s*total/i.test(market)) return null;
  return {
    sport: g.sport,
    game: `${g.awayTeam} @ ${g.homeTeam}`,
    eventId: g.id,
    marketKey,
    market,
    pick: `${label} ${side}${pt}`,
    team: teamFull,
    side,
    line,
    odds: o.price,
    sportsbook: bestSportsbook(o),
    quoteUpdatedAt: null,
    startsAt: g.commenceTime,
    books: (o.books ?? []).map((b) => ({
      book: b.book,
      price: b.price,
      point: b.point ?? null,
    })),
  };
}

/**
 * Extract posted team-total props for ONE team on this event.
 * Only outcomes that unambiguously match `teamFullName` (and that team's
 * home/away seat on the event) are returned.
 */
export function extractTeamPostedProps(
  g: OddsGame,
  teamFullName: string,
): TeamPostedProp[] {
  if (!g?.markets?.length || !teamFullName) return [];
  const homeHit = teamNameMatches(teamFullName, g.homeTeam);
  const awayHit = teamNameMatches(teamFullName, g.awayTeam);
  // Must bind to exactly one side of THIS event — nickname-only / dual hits fail.
  if (homeHit === awayHit) return [];
  const seat = homeHit ? g.homeTeam : g.awayTeam;

  const out: TeamPostedProp[] = [];
  const seen = new Set<string>();

  for (const market of g.markets) {
    if (!isTeamTotalMarketKey(market.key)) continue;
    for (const o of market.outcomes ?? []) {
      const parsed = parseTeamTotalOutcome(o.name);
      if (!parsed) continue;
      const resolved = resolveOutcomeTeam(parsed.teamToken, g.homeTeam, g.awayTeam);
      if (!resolved || resolved !== seat) continue;
      const row = toPostedProp(g, market.key, o, seat, parsed.side);
      if (!row) continue;
      const k = `${row.marketKey}|${row.side}|${row.line ?? ""}|${row.odds}`.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(row);
    }
  }

  // Main team totals first, then alts, then period; stable line then Over/Under.
  out.sort((a, b) => {
    const rank = (p: TeamPostedProp) => {
      const alt = /alternate_/i.test(p.marketKey) ? 1 : 0;
      const period = /_(h|q|p)\d$/i.test(p.marketKey) ? 1 : 0;
      return alt * 2 + period;
    };
    const r = rank(a) - rank(b);
    if (r !== 0) return r;
    const la = a.line ?? Number.POSITIVE_INFINITY;
    const lb = b.line ?? Number.POSITIVE_INFINITY;
    if (la !== lb) return la - lb;
    if (a.side !== b.side) return a.side === "Over" ? -1 : 1;
    return a.market.localeCompare(b.market);
  });

  return out;
}

/** True when the event has at least one attributable team-total outcome. */
export function gameHasTeamPostedProps(g: OddsGame): boolean {
  if (!g?.markets?.length) return false;
  for (const market of g.markets) {
    if (!isTeamTotalMarketKey(market.key)) continue;
    for (const o of market.outcomes ?? []) {
      const parsed = parseTeamTotalOutcome(o.name);
      if (!parsed) continue;
      if (resolveOutcomeTeam(parsed.teamToken, g.homeTeam, g.awayTeam)) return true;
    }
  }
  return false;
}

/**
 * Find the odds-feed event for a matchup by BOTH full team names
 * (order-independent). Nickname-only matching is intentionally insufficient.
 */
export function findOddsGameForMatchup(
  rows: OddsGame[],
  team: string,
  opp: string,
): OddsGame | null {
  if (!rows?.length || !team || !opp) return null;
  return (
    rows.find(
      (o) =>
        (teamNameMatches(o.homeTeam, team) && teamNameMatches(o.awayTeam, opp)) ||
        (teamNameMatches(o.homeTeam, opp) && teamNameMatches(o.awayTeam, team)),
    ) ?? null
  );
}

/** Slip / RealOddsEntry shape — market stays "Team Total" family labels only. */
export function teamPostedPropToRealOdds(p: TeamPostedProp): RealOddsEntry {
  return {
    sport: p.sport,
    game: p.game,
    market: p.market,
    pick: p.pick,
    odds: p.odds,
    startsAt: p.startsAt,
  };
}

/** Supported sports for the Team Props browse tab (same set as player props). */
export const TEAM_PROPS_SPORTS = [
  "mlb",
  "wnba",
  "nba",
  "nhl",
  "nfl",
  "ncaaf",
  "ncaab",
  "soccer",
] as const;

export function isTeamPropsSport(sport: string): boolean {
  return (TEAM_PROPS_SPORTS as readonly string[]).includes(sport);
}

/**
 * Provider market keys requested per sport family (odds route). Documented for
 * UI honesty — FanDuel-style team yards are unsupported (providerKey null).
 */
export const TEAM_PROP_PROVIDER_KEYS = {
  default: [
    "team_totals",
    "alternate_team_totals",
    "team_totals_h1",
    "team_totals_h2",
    "team_totals_q1",
    "team_totals_q2",
    "team_totals_q3",
    "team_totals_q4",
    "alternate_team_totals_h1",
    "alternate_team_totals_h2",
    "alternate_team_totals_q1",
    "alternate_team_totals_q2",
    "alternate_team_totals_q3",
    "alternate_team_totals_q4",
  ],
  baseball: ["team_totals", "alternate_team_totals"],
  soccer: ["team_totals", "alternate_team_totals"],
  /** Book-proprietary — Odds API has no keys; never invent. */
  unsupported: [
    "Team Total Yards",
    "Team Rush Yards",
    "Team Receiving Yards",
  ],
} as const;

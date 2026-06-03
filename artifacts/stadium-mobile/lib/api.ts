import { fetch as expoFetch } from "expo/fetch";

// The Express backend (artifacts/api-server) is reached through the Replit dev
// domain. EXPO_PUBLIC_DOMAIN is injected by the dev script.
const DOMAIN = process.env.EXPO_PUBLIC_DOMAIN;
export const API_BASE = DOMAIN ? `https://${DOMAIN}/api` : "/api";

// ---------- Types (mirror lib/api-spec/openapi.yaml) ----------

export type OddsBookPrice = { book: string; price: number; point?: number | null };

export type OddsOutcome = {
  name: string;
  price: number;
  point?: number | null;
  books?: OddsBookPrice[];
};

export type OddsMarket = { key: string; outcomes: OddsOutcome[] };

export type OddsGame = {
  id: string;
  sport: string;
  homeTeam: string;
  awayTeam: string;
  commenceTime: string;
  markets: OddsMarket[];
};

export type EspnGame = {
  id: string;
  sport: string;
  name: string;
  shortName: string;
  status: string;
  startsAt: string;
  homeTeam?: string | null;
  awayTeam?: string | null;
  homeScore?: number | null;
  awayScore?: number | null;
  homeTeamId?: string | null;
  awayTeamId?: string | null;
  homeLogo?: string | null;
  awayLogo?: string | null;
  homeAbbr?: string | null;
  awayAbbr?: string | null;
  venue?: string | null;
  clock?: string | null;
  period?: number | null;
  periodLabel?: string | null;
  state?: string | null;
};

export type ChatMessage = { role: "user" | "assistant"; content: string };

// A single real-odds context entry sent to the chat AI (matches the web app).
export type RealOddsEntry = {
  sport: string;
  game: string;
  market: string;
  pick: string;
  odds: number;
  startsAt?: string;
};

export type RealGameEntry = {
  sport: string;
  game: string;
  status?: string;
  startsAt?: string;
  venue?: string | null;
};

// ---------- Fetchers ----------

async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const res = await expoFetch(`${API_BASE}${path}`, { signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as T;
}

export function getOdds(sport: string, signal?: AbortSignal): Promise<OddsGame[]> {
  return getJson<OddsGame[]>(`/sports/odds?sport=${encodeURIComponent(sport)}`, signal);
}

export function getGames(sport: string, signal?: AbortSignal): Promise<EspnGame[]> {
  return getJson<EspnGame[]>(`/sports/games?sport=${encodeURIComponent(sport)}`, signal);
}

// ---------- Player props ----------

// A single bookmaker player-prop line (matches artifacts/api-server props.ts).
// line is null for yes/no markets (e.g. anytime TD); over/under may be null when
// only one side is posted. alt=true marks an alternate-ladder rung.
export type PlayerProp = {
  player: string;
  market: string;
  line: number | null;
  overPrice: number | null;
  underPrice: number | null;
  alt: boolean;
  headshot: string | null;
  athleteId: string | null;
  playerTeamId: string | null;
};

export type PropsResponse = {
  home: string | null;
  away: string | null;
  bookmaker: string | null;
  props: PlayerProp[];
};

// Sports the props endpoint actually serves (MARKETS_BY_SPORT in props.ts).
// Soccer/tennis/ufc return [] upstream, so we don't offer them in the props UI.
export const PROPS_SPORTS = ["mlb", "wnba", "nba", "nhl", "nfl", "ncaaf", "ncaab"];

export type GetPropsArgs = {
  sport: string;
  eventId: string;
  home?: string;
  away?: string;
  homeTeamId?: string | null;
  awayTeamId?: string | null;
};

// Per-event player props. Pass home/away names so the server can resolve the
// real Odds API event id when eventId came from a fallback odds source, and
// team ids so it can attach real ESPN headshots.
export function getProps(args: GetPropsArgs, signal?: AbortSignal): Promise<PropsResponse> {
  const q = new URLSearchParams({ sport: args.sport, eventId: args.eventId });
  if (args.home) q.set("home", args.home);
  if (args.away) q.set("away", args.away);
  if (args.homeTeamId) q.set("homeTeamId", args.homeTeamId);
  if (args.awayTeamId) q.set("awayTeamId", args.awayTeamId);
  return getJson<PropsResponse>(`/sports/props?${q.toString()}`, signal);
}

// Map a raw Odds API market key to a short human label. Handles the _q1 / _h1
// period suffixes (and _alternate, though the server already strips it).
const PROP_MARKET_LABELS: Record<string, string> = {
  player_points: "Points",
  player_rebounds: "Rebounds",
  player_assists: "Assists",
  player_threes: "3-Pointers",
  player_points_rebounds_assists: "Pts+Reb+Ast",
  player_points_rebounds: "Pts+Reb",
  player_points_assists: "Pts+Ast",
  player_rebounds_assists: "Reb+Ast",
  player_blocks: "Blocks",
  player_steals: "Steals",
  player_blocks_steals: "Blocks+Steals",
  player_turnovers: "Turnovers",
  player_pass_yds: "Pass Yds",
  player_pass_tds: "Pass TDs",
  player_rush_yds: "Rush Yds",
  player_reception_yds: "Rec Yds",
  player_receptions: "Receptions",
  player_anytime_td: "Anytime TD",
  player_goals: "Goals",
  player_shots_on_goal: "Shots on Goal",
  batter_hits: "Hits",
  batter_total_bases: "Total Bases",
  batter_home_runs: "Home Runs",
  pitcher_strikeouts: "Strikeouts",
};

export function propMarketLabel(key: string): string {
  let k = key;
  let suffix = "";
  if (k.endsWith("_alternate")) k = k.slice(0, -"_alternate".length);
  if (k.endsWith("_q1")) {
    suffix = " (Q1)";
    k = k.slice(0, -3);
  } else if (k.endsWith("_h1")) {
    suffix = " (1H)";
    k = k.slice(0, -3);
  }
  const base =
    PROP_MARKET_LABELS[k] ??
    k.replace(/^(player_|batter_|pitcher_)/, "").replace(/_/g, " ");
  return base + suffix;
}

// ---------- Pickability window ----------

// In progress (started up to 4h ago) OR tips off within the next 48h.
export function isPickable(startsAt?: string | null): boolean {
  if (!startsAt) return false;
  const t = Date.parse(startsAt);
  if (!Number.isFinite(t)) return false;
  const now = Date.now();
  return t > now - 4 * 3600_000 && t < now + 48 * 3600_000;
}

const nickname = (full: string) => (full || "").split(/\s+/).filter(Boolean).pop() || full;

// Convert an OddsGame into real-odds PICK entries (main markets only — keeps the
// chat context compact). Same shape the web app sends as context.realOdds.
export function buildRealOdds(g: OddsGame): RealOddsEntry[] {
  if (!g || !g.markets) return [];
  const out: RealOddsEntry[] = [];
  const game = `${g.awayTeam} @ ${g.homeTeam}`;
  const base = { sport: g.sport, game, startsAt: g.commenceTime };
  const h2h = g.markets.find((m) => m.key === "h2h");
  const spreads = g.markets.find((m) => m.key === "spreads");
  const totals = g.markets.find((m) => m.key === "totals");
  if (h2h) {
    for (const o of h2h.outcomes || []) {
      out.push({ ...base, market: "Moneyline", pick: `${nickname(o.name)} ML`, odds: o.price });
    }
  }
  if (spreads) {
    for (const o of spreads.outcomes || []) {
      const pt = o.point == null ? "" : ` ${o.point > 0 ? "+" : ""}${o.point}`;
      out.push({ ...base, market: "Spread", pick: `${nickname(o.name)}${pt}`, odds: o.price });
    }
  }
  if (totals) {
    for (const o of totals.outcomes || []) {
      const pt = o.point == null ? "" : ` ${o.point}`;
      out.push({ ...base, market: "Total", pick: `${o.name}${pt}`.trim(), odds: o.price });
    }
  }
  return out;
}

export type ChatContext = {
  selectedSports: string[];
  currentSlip: { game: string; market: string; pick: string; odds: number }[];
  realGames: RealGameEntry[];
  realOdds: RealOddsEntry[];
};

// Fetch live odds + games across the selected sports and assemble the real-data
// context the chat AI requires so it never fabricates fixtures or prices.
export async function buildChatContext(
  sports: string[],
  currentSlip: { game: string; market: string; pick: string; odds: number }[],
  signal?: AbortSignal,
): Promise<ChatContext> {
  // Keep the two feed types in separately-typed arrays so handling stays
  // type-safe; resilient per-sport (a failed fetch just yields an empty list).
  const [oddsAll, gamesAll] = await Promise.all([
    Promise.all(sports.map((s) => getOdds(s, signal).catch(() => [] as OddsGame[]))),
    Promise.all(sports.map((s) => getGames(s, signal).catch(() => [] as EspnGame[]))),
  ]);

  const realOdds: RealOddsEntry[] = [];
  const realGames: RealGameEntry[] = [];

  sports.forEach((sport, i) => {
    for (const g of oddsAll[i]) {
      if (!isPickable(g.commenceTime)) continue;
      realOdds.push(...buildRealOdds(g));
    }
    for (const g of gamesAll[i]) {
      if (g.state === "post") continue; // finished
      if (!isPickable(g.startsAt)) continue;
      const away = g.awayTeam || g.awayAbbr || "";
      const home = g.homeTeam || g.homeAbbr || "";
      if (!away || !home) continue;
      realGames.push({
        sport,
        game: `${away} @ ${home}`,
        status: g.status,
        startsAt: g.startsAt,
        venue: g.venue ?? null,
      });
    }
  });

  return {
    selectedSports: sports,
    currentSlip,
    realGames: realGames.slice(0, 60),
    realOdds: realOdds.slice(0, 120),
  };
}

// ---------- Chat streaming (SSE over POST) ----------

export type StreamChatArgs = {
  messages: ChatMessage[];
  context: ChatContext;
  onToken: (full: string) => void;
  signal?: AbortSignal;
};

// Streams the assistant reply token-by-token. Uses expo/fetch so getReader()
// works on native. Returns the full text once the stream closes.
export async function streamChat({ messages, context, onToken, signal }: StreamChatArgs): Promise<string> {
  const res = await expoFetch(`${API_BASE}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages, context }),
    signal,
  });
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let fullText = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split("\n\n");
    buffer = chunks.pop() || "";
    for (const chunk of chunks) {
      if (!chunk.startsWith("data: ")) continue;
      try {
        const data = JSON.parse(chunk.slice(6));
        if (data.content) {
          fullText += data.content;
          onToken(fullText);
        }
      } catch {
        // ignore keep-alive / status frames
      }
    }
  }
  return fullText;
}

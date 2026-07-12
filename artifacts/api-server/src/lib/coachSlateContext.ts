import { MARKETS_BY_SPORT } from "../routes/props.js";
import { pooled, slateLoopbackGet } from "./coachSlateLoopback.js";
import {
  buildServerMatchupInjuries,
  fetchInjuriesBySport,
  injuryDigestForSports,
} from "./coachSlateInjuries.js";
import type {
  BuiltChatContext,
  GameMeta,
  PropPoolEntry,
  RealOddsEntry,
  RealPropEntry,
} from "./coachSlateTypes.js";

const PROPS_SPORTS = [
  ...Object.keys(MARKETS_BY_SPORT),
  "tennis",
  "ufc",
];
const MAX_SPORTS = 10;
const MAX_ODDS_GAMES = 48;
const MAX_PROP_GAMES = 28;
const PROPS_CONCURRENCY = 3;
const ALT_RUNGS_PER_PROP = 8;
const ALT_LINES_PER_GAME = 8;

type OddsGame = {
  sport: string;
  awayTeam: string;
  homeTeam: string;
  commenceTime: string;
  markets?: Array<{
    key: string;
    outcomes?: Array<{
      name: string;
      price: number;
      point?: number | null;
      noVigFair?: number | null;
      edge?: number | null;
      bookSpread?: number | null;
    }>;
  }>;
};

type EspnGame = {
  id: string;
  sport: string;
  homeTeam?: string;
  awayTeam?: string;
  homeAbbr?: string | null;
  awayAbbr?: string | null;
  homeLogo?: string | null;
  awayLogo?: string | null;
  homeTeamId?: string | null;
  awayTeamId?: string | null;
  startsAt: string;
  status?: string;
  state?: string | null;
};

type PropsResponse = {
  props?: Array<{
    player: string;
    market: string;
    line: number | null;
    overPrice?: number | null;
    underPrice?: number | null;
    alt?: boolean;
    athleteId?: string | null;
    playerTeamId?: string | null;
    headshot?: string | null;
    ev?: number | null;
    evSide?: string | null;
    edge?: number | null;
    overSpread?: number | null;
    underSpread?: number | null;
  }>;
};

function nickname(name: string): string {
  const t = String(name ?? "").trim().split(/\s+/);
  return t[t.length - 1] ?? name;
}

function propMarketLabel(market: string): string {
  return market
    .replace(/^player_/, "")
    .replace(/^batter_/, "")
    .replace(/^pitcher_/, "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function isUpcomingGame(g: EspnGame): boolean {
  const st = (g.state || "").toLowerCase();
  const status = (g.status || "").toLowerCase();
  if (st === "post" || status === "final") return false;
  const t = Date.parse(g.startsAt);
  return Number.isFinite(t) && t > Date.now();
}

function buildRealOddsFromGame(g: OddsGame): RealOddsEntry[] {
  if (!g.markets?.length) return [];
  const out: RealOddsEntry[] = [];
  const game = `${g.awayTeam} @ ${g.homeTeam}`;
  const base = { sport: g.sport, game, startsAt: g.commenceTime };
  const isSoccer = g.sport === "soccer";
  const teamLabel = (name: string) => (isSoccer ? name : nickname(name));

  const pushOutcome = (
    market: string,
    pick: string,
    odds: number,
    score?: { noVigFair?: number | null; edge?: number | null; bookSpread?: number | null },
  ) => {
    out.push({
      ...base,
      market,
      pick,
      odds,
      noVigFair: score?.noVigFair ?? null,
      edge: score?.edge ?? null,
      bookSpread: score?.bookSpread ?? null,
    });
  };

  const h2h = g.markets.find((m) => m.key === "h2h");
  const spreads = g.markets.find((m) => m.key === "spreads");
  const totals = g.markets.find((m) => m.key === "totals");
  const altSpreads = g.markets.find((m) => m.key === "alternate_spreads");
  const altTotals = g.markets.find((m) => m.key === "alternate_totals");

  for (const o of h2h?.outcomes ?? []) {
    pushOutcome("Moneyline", `${teamLabel(o.name)} ML`, o.price, o);
  }
  for (const o of spreads?.outcomes ?? []) {
    const pt = o.point == null ? "" : ` ${o.point > 0 ? "+" : ""}${o.point}`;
    pushOutcome("Spread", `${teamLabel(o.name)}${pt}`, o.price, o);
  }
  for (const o of totals?.outcomes ?? []) {
    const pt = o.point == null ? "" : ` ${o.point}`;
    pushOutcome("Total", `${o.name}${pt}`.trim(), o.price, o);
  }
  for (const o of (altSpreads?.outcomes ?? []).slice(0, ALT_LINES_PER_GAME)) {
    const pt = o.point == null ? "" : ` ${o.point > 0 ? "+" : ""}${o.point}`;
    pushOutcome("Alt Spread", `${nickname(o.name)}${pt}`, o.price);
  }
  for (const o of (altTotals?.outcomes ?? []).slice(0, ALT_LINES_PER_GAME)) {
    const pt = o.point == null ? "" : ` ${o.point}`;
    pushOutcome("Alt Total", `${o.name}${pt}`.trim(), o.price);
  }

  return out;
}

function buildGameMeta(games: EspnGame[]): GameMeta[] {
  const out: GameMeta[] = [];
  for (const g of games) {
    const home = g.homeTeam || g.homeAbbr || "";
    const away = g.awayTeam || g.awayAbbr || "";
    if (!home || !away) continue;
    out.push({
      game: `${away} @ ${home}`,
      sport: g.sport,
      startsAt: g.startsAt,
      homeAbbr: g.homeAbbr ?? null,
      awayAbbr: g.awayAbbr ?? null,
      homeLogo: g.homeLogo ?? null,
      awayLogo: g.awayLogo ?? null,
    });
  }
  return out;
}

/** Build compact parlay context via loopback — mirrors mobile buildCompactParlayContext. */
export async function buildServerCompactParlayContext(): Promise<{
  built: BuiltChatContext;
  injuryDigest: string;
  gameStatusDigest: string;
}> {
  const empty: BuiltChatContext = {
    context: {
      selectedSports: [],
      currentSlip: [],
      realGames: [],
      realOdds: [],
      realProps: [],
    },
    propPool: [],
    gameMeta: [],
    upsetSpots: [],
    todayOnly: false,
    tomorrowOnly: false,
  };

  const allOdds: OddsGame[] = [];
  const gamesBySport = new Map<string, EspnGame[]>();
  const activeSports: string[] = [];

  for (const sport of PROPS_SPORTS) {
    if (activeSports.length >= MAX_SPORTS) break;
    const [odds, games] = await Promise.all([
      slateLoopbackGet<OddsGame[]>(`/sports/odds?sport=${sport}`),
      slateLoopbackGet<EspnGame[]>(`/sports/games?sport=${sport}`),
    ]);
    const pickable = (odds ?? []).filter((g) => {
      const t = Date.parse(g.commenceTime);
      return Number.isFinite(t) && t > Date.now();
    });
    if (pickable.length > 0) {
      activeSports.push(sport);
      allOdds.push(...pickable.map((g) => ({ ...g, sport })));
      gamesBySport.set(sport, games ?? []);
    }
  }

  if (!allOdds.length) {
    return { built: empty, injuryDigest: "", gameStatusDigest: "" };
  }

  allOdds.sort((a, b) => Date.parse(a.commenceTime) - Date.parse(b.commenceTime));

  const teamMetaById = new Map<string, { abbr: string | null }>();
  for (const games of gamesBySport.values()) {
    for (const g of games) {
      if (g.homeTeamId) teamMetaById.set(g.homeTeamId, { abbr: g.homeAbbr ?? null });
      if (g.awayTeamId) teamMetaById.set(g.awayTeamId, { abbr: g.awayAbbr ?? null });
    }
  }

  const realOdds: RealOddsEntry[] = [];
  const realGames: BuiltChatContext["context"]["realGames"] = [];
  for (const g of allOdds.slice(0, MAX_ODDS_GAMES)) {
    realOdds.push(...buildRealOddsFromGame(g));
    realGames.push({
      sport: g.sport,
      game: `${g.awayTeam} @ ${g.homeTeam}`,
      status: "Scheduled",
      startsAt: g.commenceTime,
    });
  }

  const realProps: RealPropEntry[] = [];
  const propPool: PropPoolEntry[] = [];

  const propCandidates: Array<{ sport: string; g: OddsGame; espn: EspnGame | null }> = [];
  for (const g of allOdds) {
    const espnGames = gamesBySport.get(g.sport) ?? [];
    const espn =
      espnGames.find(
        (eg) =>
          (eg.homeTeam === g.homeTeam && eg.awayTeam === g.awayTeam) ||
          (eg.homeAbbr && eg.awayAbbr && `${eg.awayAbbr} @ ${eg.homeAbbr}` === `${g.awayTeam} @ ${g.homeTeam}`),
      ) ?? null;
    if (!espn || !isUpcomingGame(espn)) continue;
    propCandidates.push({ sport: g.sport, g, espn });
  }
  propCandidates.sort((a, b) => Date.parse(a.g.commenceTime) - Date.parse(b.g.commenceTime));

  const gamesToFetch = propCandidates.slice(0, MAX_PROP_GAMES);
  await pooled(gamesToFetch, PROPS_CONCURRENCY, async ({ sport, g, espn }) => {
    if (!espn?.homeTeam || !espn.awayTeam) return;
    const q = new URLSearchParams({
      sport,
      eventId: espn.id,
      home: espn.homeTeam,
      away: espn.awayTeam,
    });
    if (espn.homeTeamId) q.set("homeTeamId", espn.homeTeamId);
    if (espn.awayTeamId) q.set("awayTeamId", espn.awayTeamId);
    const r = await slateLoopbackGet<PropsResponse>(`/sports/props?${q.toString()}`);
    if (!r?.props?.length) return;

    const game = `${g.awayTeam} @ ${g.homeTeam}`;
    const usable = r.props.filter((p) => p.overPrice != null || p.underPrice != null);
    const altRungs = new Map<string, number>();

    for (const altPass of [false, true]) {
      for (const p of usable) {
        if (!!p.alt !== altPass) continue;
        if (p.alt) {
          const k = `${p.player}|${p.market}`.toLowerCase();
          const n = altRungs.get(k) ?? 0;
          if (n >= ALT_RUNGS_PER_PROP) continue;
          altRungs.set(k, n + 1);
        }
        realProps.push({
          sport,
          game,
          startsAt: g.commenceTime,
          player: p.player,
          athleteId: p.athleteId ?? null,
          market: p.market,
          line: p.line,
          over: p.overPrice ?? null,
          under: p.underPrice ?? null,
          alt: !!p.alt,
          ev: p.ev ?? null,
          evSide: p.evSide ?? null,
          edge: p.edge ?? null,
        });
        const marketLabel = propMarketLabel(p.market);
        const teamAbbr = p.playerTeamId ? (teamMetaById.get(p.playerTeamId)?.abbr ?? null) : null;
        if (p.overPrice != null) {
          propPool.push({
            sport,
            game,
            marketLabel,
            player: p.player,
            line: p.line,
            side: "Over",
            odds: p.overPrice,
            headshot: p.headshot ?? null,
            teamAbbr,
            athleteId: p.athleteId ?? null,
            marketKey: p.market,
            alt: !!p.alt,
            edge: p.evSide === "Over" ? (p.edge ?? null) : null,
            bookSpread: p.overSpread ?? null,
            startsAt: g.commenceTime,
          });
        }
        if (p.line != null && p.underPrice != null) {
          propPool.push({
            sport,
            game,
            marketLabel,
            player: p.player,
            line: p.line,
            side: "Under",
            odds: p.underPrice,
            headshot: p.headshot ?? null,
            teamAbbr,
            athleteId: p.athleteId ?? null,
            marketKey: p.market,
            alt: !!p.alt,
            edge: p.evSide === "Under" ? (p.edge ?? null) : null,
            bookSpread: p.underSpread ?? null,
            startsAt: g.commenceTime,
          });
        }
      }
    }
  });

  const injuriesBySport = await fetchInjuriesBySport(activeSports);
  const injuryDigest = injuryDigestForSports(injuriesBySport);
  const gameRefs = [...gamesBySport.values()]
    .flat()
    .filter(isUpcomingGame)
    .map((g) => ({
      sport: g.sport,
      awayTeam: g.awayTeam,
      awayAbbr: g.awayAbbr,
      homeTeam: g.homeTeam,
      homeAbbr: g.homeAbbr,
    }));
  const matchupInjuries = buildServerMatchupInjuries(gameRefs, injuriesBySport);
  const gameStatusDigest = [...gamesBySport.values()]
    .flat()
    .filter(isUpcomingGame)
    .map((g) => `${g.sport}:${g.awayTeam}@${g.homeTeam}:${g.status ?? g.state ?? ""}`)
    .sort()
    .slice(0, 40)
    .join("|");

  const built: BuiltChatContext = {
    context: {
      selectedSports: activeSports.length ? activeSports : ["mlb"],
      currentSlip: [],
      realGames,
      realOdds,
      realProps,
      ...(Object.keys(matchupInjuries).length ? { matchupInjuries } : {}),
    },
    propPool,
    gameMeta: buildGameMeta([...gamesBySport.values()].flat()),
    upsetSpots: [],
    todayOnly: false,
    tomorrowOnly: false,
  };
  return { built, injuryDigest, gameStatusDigest };
}

import type { CoachRawSlateInput } from "@workspace/coach-data";
import { discoverAllPostedGameLines, type OddsGameForDiscovery } from "./coachSlateMarketDiscovery.js";
import { pooled, slateLoopbackGet } from "./coachSlateLoopback.js";

const COACH_HORIZON_MS = 48 * 60 * 60 * 1000;
const V2_SPORTS = ["mlb"] as const;
const MAX_PROP_GAMES = 24;
const PROPS_CONCURRENCY = 4;

type OddsGame = OddsGameForDiscovery;

type EspnGame = {
  id: string;
  sport: string;
  homeTeam?: string;
  awayTeam?: string;
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
  }>;
};

function isCoachBettableCommence(commenceTime: string): boolean {
  const t = Date.parse(commenceTime);
  if (!Number.isFinite(t)) return false;
  const now = Date.now();
  return t > now && t < now + COACH_HORIZON_MS;
}

function isUpcomingGame(g: EspnGame): boolean {
  const st = (g.state || "").toLowerCase();
  const status = (g.status || "").toLowerCase();
  if (st === "post" || status === "final") return false;
  const t = Date.parse(g.startsAt);
  return Number.isFinite(t) && t > Date.now();
}

function propMarketLabel(market: string): string {
  return market
    .replace(/^player_/, "")
    .replace(/^batter_/, "")
    .replace(/^pitcher_/, "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function lineFromPick(pick: string): number | null {
  const m = pick.match(/[+-]?\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : null;
}

/** Loopback loader — maps existing api-server feeds into CoachRawSlateInput. */
export async function loadCoachV2RawSlate(): Promise<CoachRawSlateInput> {
  const games: CoachRawSlateInput["games"] = [];
  const gameLines: CoachRawSlateInput["gameLines"] = [];
  const props: CoachRawSlateInput["props"] = [];
  const gameIdByLabel = new Map<string, string>();

  for (const sport of V2_SPORTS) {
    const [odds, espnGames] = await Promise.all([
      slateLoopbackGet<OddsGame[]>(`/sports/odds?sport=${sport}`),
      slateLoopbackGet<EspnGame[]>(`/sports/games?sport=${sport}`),
    ]);

    const pickableOdds = (odds ?? []).filter((g) => isCoachBettableCommence(g.commenceTime));
    const espnByMatch = new Map<string, EspnGame>();
    for (const g of espnGames ?? []) {
      if (!g.homeTeam || !g.awayTeam || !isUpcomingGame(g)) continue;
      espnByMatch.set(`${g.awayTeam} @ ${g.homeTeam}`, g);
    }

    for (const g of pickableOdds) {
      const gameLabel = `${g.awayTeam} @ ${g.homeTeam}`;
      const espn = espnByMatch.get(gameLabel);
      const gameId = espn?.id ?? `${sport}:${gameLabel}`;
      gameIdByLabel.set(gameLabel, gameId);
      games.push({
        sport,
        gameId,
        gameLabel,
        startsAt: g.commenceTime,
        status: "scheduled",
      });

      for (const line of discoverAllPostedGameLines(g)) {
        gameLines.push({
          sport,
          gameId,
          gameLabel,
          marketKey: line.market.toLowerCase().replace(/\s+/g, "_"),
          marketLabel: line.market,
          pick: line.pick,
          odds: line.odds,
          line: lineFromPick(line.pick),
          startsAt: g.commenceTime,
          isAlt: /alt/i.test(line.market),
        });
      }
    }

    const propCandidates = pickableOdds
      .map((g) => {
        const gameLabel = `${g.awayTeam} @ ${g.homeTeam}`;
        const espn = espnByMatch.get(gameLabel);
        return espn ? { sport, g, espn, gameLabel } : null;
      })
      .filter((row): row is NonNullable<typeof row> => row != null)
      .slice(0, MAX_PROP_GAMES);

    await pooled(propCandidates, PROPS_CONCURRENCY, async ({ sport, g, espn, gameLabel }) => {
      const q = new URLSearchParams({
        sport,
        eventId: espn.id,
        home: espn.homeTeam!,
        away: espn.awayTeam!,
      });
      const r = await slateLoopbackGet<PropsResponse>(`/sports/props?${q.toString()}`);
      if (!r?.props?.length) return;

      const gameId = gameIdByLabel.get(gameLabel) ?? espn.id;
      for (const p of r.props) {
        const marketLabel = propMarketLabel(p.market);
        if (p.line != null && p.overPrice != null) {
          props.push({
            sport,
            gameId,
            gameLabel,
            marketKey: p.market,
            marketLabel,
            playerId: p.athleteId ?? null,
            playerName: p.player,
            pick: `Over ${p.line}`,
            odds: p.overPrice,
            line: p.line,
            side: "Over",
            startsAt: g.commenceTime,
            isAlt: !!p.alt,
          });
        }
        if (p.line != null && p.underPrice != null) {
          props.push({
            sport,
            gameId,
            gameLabel,
            marketKey: p.market,
            marketLabel,
            playerId: p.athleteId ?? null,
            playerName: p.player,
            pick: `Under ${p.line}`,
            odds: p.underPrice,
            line: p.line,
            side: "Under",
            startsAt: g.commenceTime,
            isAlt: !!p.alt,
          });
        }
      }
    });
  }

  return { games, gameLines, props };
}

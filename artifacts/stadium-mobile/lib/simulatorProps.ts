// Simulator-only props loader — kept in a small module so OTA bundles always
// ship the PrizePicks fallback alongside the screen (avoids relying on a fresh
// re-export from the large api.ts barrel during partial updates).
import {
  getGameRoster,
  getProps,
  getPrizePicksProps,
  type GetPropsArgs,
  type PlayerProp,
} from "./api";

function normPlayerName(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z]/g, "");
}

function ppStatToMarketKey(sport: string, stat: string | null | undefined): string {
  if (!stat) return "";
  const s = stat.toLowerCase().replace(/[^a-z0-9+]/g, " ").trim();
  const MLB: Record<string, string> = {
    hits: "batter_hits",
    "home runs": "batter_home_runs",
    hr: "batter_home_runs",
    hrs: "batter_home_runs",
    strikeouts: "pitcher_strikeouts",
    "pitcher strikeouts": "pitcher_strikeouts",
    "hitter strikeouts": "batter_strikeouts",
    ks: "pitcher_strikeouts",
    "stolen bases": "batter_stolen_bases",
    sbs: "batter_stolen_bases",
    "total bases": "batter_total_bases",
    "hits runs rbis": "batter_hits_runs_rbis",
    "hits+runs+rbis": "batter_hits_runs_rbis",
    rbis: "batter_hits_runs_rbis",
    singles: "batter_hits",
    runs: "batter_runs",
  };
  const NBA: Record<string, string> = {
    points: "player_points",
    rebounds: "player_rebounds",
    assists: "player_assists",
    "3pt made": "player_threes",
    threes: "player_threes",
    "pts+rebs+asts": "player_points_rebounds_assists",
  };
  const map =
    sport === "mlb"
      ? MLB
      : sport === "nba" || sport === "wnba"
        ? NBA
        : sport === "nhl"
          ? {
              points: "player_points",
              goals: "player_goals",
              assists: "player_assists",
              "shots on goal": "player_shots_on_goal",
            }
          : {};
  return map[s] ?? stat;
}

function mapPrizePicksProps(sport: string, props: unknown): PlayerProp[] {
  if (!Array.isArray(props)) return [];
  return props
    .filter((p): p is PlayerProp => !!p && typeof p === "object" && typeof p.player === "string")
    .map((p) => ({
      ...p,
      market: ppStatToMarketKey(sport, p.market) || p.market,
      priceSource: "PrizePicks" as const,
      overBook: p.overBook ?? "PrizePicks",
    }));
}

/** Keep only players on either team's ESPN roster; attach athleteId for sims. */
async function applyGameRoster(
  sport: string,
  props: PlayerProp[],
  homeTeamId?: string | null,
  awayTeamId?: string | null,
  signal?: AbortSignal,
): Promise<PlayerProp[]> {
  if (!props.length || (!homeTeamId && !awayTeamId)) return props;
  try {
    const { players } = await getGameRoster(sport, homeTeamId, awayTeamId, signal);
    if (!players.length) return props;
    const byName = new Map(players.map((p) => [normPlayerName(p.name), p]));
    return props
      .filter((p) => byName.has(normPlayerName(p.player)))
      .map((p) => {
        const r = byName.get(normPlayerName(p.player));
        return {
          ...p,
          athleteId: p.athleteId ?? r?.athleteId ?? null,
          playerTeamId: p.playerTeamId ?? r?.teamId ?? null,
          headshot: p.headshot ?? r?.headshot ?? null,
        };
      });
  } catch {
    return props;
  }
}

/** Odds-API props first; on empty/502 fall back to PrizePicks DFS lines. Never throws. */
export async function loadSimulatorProps(
  args: GetPropsArgs,
  signal?: AbortSignal,
): Promise<PlayerProp[]> {
  if (!args?.sport || !args?.eventId) return [];
  try {
    const r = await getProps(args, signal);
    const props = Array.isArray(r.props) ? r.props : [];
    if (props.length > 0) {
      const mains = props.filter((p): p is PlayerProp => !!p && typeof p === "object");
      return applyGameRoster(args.sport, mains, args.homeTeamId, args.awayTeamId, signal);
    }
  } catch {
    // Production often 502s ESPN ids — try PrizePicks below.
  }
  if (!args.home || !args.away) return [];
  try {
    const pp = await getPrizePicksProps(
      {
        sport: args.sport,
        home: args.home,
        away: args.away,
        homeTeamId: args.homeTeamId,
        awayTeamId: args.awayTeamId,
      },
      signal,
    );
    return applyGameRoster(
      args.sport,
      mapPrizePicksProps(args.sport, pp.props),
      args.homeTeamId,
      args.awayTeamId,
      signal,
    );
  } catch {
    return [];
  }
}

// Simulator-only props loader — kept in a small module so OTA bundles always
// ship the PrizePicks fallback alongside the screen (avoids relying on a fresh
// re-export from the large api.ts barrel during partial updates).
import type { PlayerProp } from "./api";
import {
  fetchGameRoster,
  fetchSimulatorPrizePicks,
  fetchSimulatorProps,
  type SimGetPropsArgs,
} from "./simulatorApi";

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
          : sport === "soccer"
            ? {
                shots: "player_shots",
                "shots on target": "player_shots_on_target",
                sot: "player_shots_on_target",
                goals: "player_goal_scorer_anytime",
                "anytime goal": "player_goal_scorer_anytime",
                "goal scorer": "player_goal_scorer_anytime",
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

/** Bind Simulator-only rows to the selected event and an eligible roster. */
async function applyGameRoster(
  args: SimGetPropsArgs,
  props: PlayerProp[],
  signal?: AbortSignal,
): Promise<PlayerProp[]> {
  const { sport, eventId, homeTeamId, awayTeamId } = args;
  if (!props.length || !homeTeamId || !awayTeamId || homeTeamId === awayTeamId) return [];
  const teamIds = new Set([homeTeamId, awayTeamId]);
  const eligible = props.filter((p) =>
    (!p.sport || p.sport === sport) &&
    (!p.playerTeamId || teamIds.has(p.playerTeamId)) &&
    (!p.espnEventId || !/^\d+$/.test(eventId) || p.espnEventId === eventId) &&
    (!p.oddsEventId || !/^[a-f0-9]{32}$/i.test(eventId) || p.oddsEventId === eventId),
  );
  if (!eligible.length) return [];

  const { players } = await fetchGameRoster(sport, homeTeamId, awayTeamId, signal)
    .catch(() => ({ sport, players: [] }));
  if (signal?.aborted) return [];
  const roster = players.filter((player) => teamIds.has(player.teamId));
  const byId = new Map(roster.filter((player) => player.athleteId).map((player) => [player.athleteId, player]));
  const byName = new Map<string, (typeof roster)[number] | null>();
  for (const player of roster) {
    const key = normPlayerName(player.name);
    byName.set(key, byName.has(key) ? null : player);
  }

  return eligible.flatMap((p) => {
    const player = p.athleteId ? byId.get(p.athleteId) : byName.get(normPlayerName(p.player));
    if (player && (!p.playerTeamId || p.playerTeamId === player.teamId)) {
      return [{ ...p, athleteId: player.athleteId, playerTeamId: player.teamId, headshot: p.headshot ?? player.headshot }];
    }
    // An exact event and team stamp can still bind a feed row when the roster
    // source is unavailable. DFS rows must be bound by the roster lookup.
    const boundEvent = p.espnEventId === eventId || p.oddsEventId === eventId || p.eventId === eventId;
    return !roster.length && p.priceSource !== "PrizePicks" && boundEvent && p.playerTeamId && p.athleteId
      ? [p] : [];
  });
}

/** Odds-API props first; on empty/502 fall back to PrizePicks DFS lines. Never throws. */
export async function loadSimulatorProps(
  args: SimGetPropsArgs,
  signal?: AbortSignal,
): Promise<PlayerProp[]> {
  if (!args?.sport || !args?.eventId) return [];
  try {
    const r = await fetchSimulatorProps(args, signal);
    const props = Array.isArray(r.props) ? r.props : [];
    if (props.length > 0) {
      const mains = props.filter((p): p is PlayerProp => !!p && typeof p === "object");
      return applyGameRoster(args, mains, signal);
    }
  } catch {
    // Production often 502s ESPN ids — try PrizePicks below.
  }
  if (!args.home || !args.away) return [];
  try {
    const pp = await fetchSimulatorPrizePicks(
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
      args,
      mapPrizePicksProps(args.sport, pp.props),
      signal,
    );
  } catch {
    return [];
  }
}

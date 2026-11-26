import { useEffect, useState } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { Card, FONT } from "@/components/ui";
import { useColors } from "@/hooks/useColors";
import { refreshSimulatorAccuracy, trackSimulatorProjections } from "@/lib/simulatorAccuracy";
import { fetchGameRoster, fetchSimulatorFirstBasket, fetchSimulatorTeamMatchup, fetchSimulatorPlayerHistory, type GameRosterPlayer } from "@/lib/simulatorApi";

type Stat = readonly [label: string, ...keys: string[]];

const basketball: Stat[] = [
  ["PTS", "PTS", "points"], ["REB", "REB", "rebounds"], ["AST", "AST", "assists"],
  ["BLK", "BLK", "blocks"], ["STL", "STL", "steals"], ["3PM", "3PM", "threePointFieldGoalsMade", "3PT"],
];

const football: Stat[] = [
  ["Pass YDS", "passingYards"], ["Pass TD", "passingTouchdowns"],
  ["Rush YDS", "rushingYards"], ["Rush TD", "rushingTouchdowns"],
  ["REC", "receptions", "REC"], ["Rec YDS", "receivingYards"], ["Rec TD", "receivingTouchdowns"],
];

const sportStats: Record<string, Stat[]> = {
  nba: basketball, wnba: basketball, ncaab: basketball, nfl: football, ncaaf: football,
  nhl: [["G", "G", "goals"], ["AST", "A", "assists"], ["SOG", "S", "SOG", "shotsOnGoal"], ["SV", "SV", "saves"]],
  mlb: [["H", "H", "hits"], ["HR", "HR", "homeRuns"], ["RBI", "RBI", "runsBattedIn"], ["K", "strikeouts", "SO", "K"]],
  soccer: [["G", "G", "goals"], ["AST", "A", "assists"], ["SH", "SH", "shots"], ["SOT", "SOT", "shotsOnTarget"], ["SV", "SV", "saves"]],
};

export function supportsSimulatorBoxScore(sport: string) {
  return Object.hasOwn(sportStats, sport);
}

function readStat(stats: Record<string, string>, keys: string[]) {
  for (const key of keys) {
    const raw = String(stats[key] ?? "").trim();
    if (!raw) continue;
    const madeAttempts = key === "3PT" ? raw.match(/^(\d+)-\d+$/) : null;
    const value = Number(madeAttempts ? madeAttempts[1] : raw);
    if (Number.isFinite(value)) return value;
  }
  return null;
}

type StatGame = { date: string | null; stats: Record<string, string> };

const basketballMarkets = { PTS: "player_points", REB: "player_rebounds", AST: "player_assists",
  BLK: "player_blocks", STL: "player_steals", "3PM": "player_threes" };
const footballMarkets = { "Pass YDS": "player_pass_yds", "Rush YDS": "player_rush_yds",
  REC: "player_receptions", "Rec YDS": "player_reception_yds" };
const matchupMarkets: Record<string, Record<string, string>> = {
  nba: basketballMarkets, wnba: basketballMarkets, ncaab: basketballMarkets,
  nfl: footballMarkets, ncaaf: footballMarkets,
  nhl: { G: "player_goals", AST: "player_assists", SOG: "player_shots_on_goal" },
  mlb: { H: "batter_hits", HR: "batter_home_runs", RBI: "batter_rbis" },
  soccer: { AST: "player_assists", SH: "player_shots", SOT: "player_shots_on_target" },
};

type TeamMatchup = Awaited<ReturnType<typeof fetchSimulatorTeamMatchup>>;
type TeamAdjustment = { multiplier: number; scored: number; allowed: number };

function teamAdjustments(sport: string, own: TeamMatchup | undefined, opponent: TeamMatchup | undefined, cutoff: number) {
  const adjustments = new Map<string, TeamAdjustment>();
  function average(rows: TeamMatchup["allowed"] | undefined, market: string) {
    const games = rows?.find((row) => row.market === market && row.scope === "team_allowed")?.games
      ?.filter(({ date, value }) => Date.parse(date) < cutoff && Number.isFinite(value) && value >= 0) ?? [];
    return games.length >= 3 ? games.reduce((sum, game) => sum + game.value, 0) / games.length : null;
  }
  for (const [label, market] of Object.entries(matchupMarkets[sport] ?? {})) {
    const scored = average(own?.production, market);
    const allowed = average(opponent?.allowed, market);
    if (scored == null || scored <= 0 || allowed == null) continue;
    // Blend halfway toward opponent allowance and limit the adjustment from team-wide evidence.
    const multiplier = Math.max(0.85, Math.min(1.15, (1 + allowed / scored) / 2));
    adjustments.set(label, { multiplier, scored, allowed });
  }
  return adjustments;
}

export function projectPlayerStats(sport: string, recent: StatGame[], matchup: StatGame[], cutoff: number, adjustments?: Map<string, TeamAdjustment>) {
  const before = (game: StatGame) => game.date != null && Date.parse(game.date) < cutoff;
  const form = recent.filter(before).slice(0, 10);
  const meetings = matchup.filter(before).slice(0, 5);
  return (sportStats[sport] ?? []).flatMap(([label, ...keys]) => {
    const values = (games: StatGame[]) => games.map(({ stats }) => readStat(stats, keys))
      .filter((value): value is number => value != null);
    const baseline = values(form);
    const against = values(meetings);
    if (!baseline.length && !against.length) return [];
    const mean = (sample: number[]) => sample.reduce((sum, value) => sum + value, 0) / sample.length;
    // Shrink the matchup average toward recent form using five baseline games.
    const weight = against.length / (against.length + 5);
    const value = !baseline.length ? mean(against) : !against.length ? mean(baseline)
      : mean(baseline) * (1 - weight) + mean(against) * weight;
    const adjustment = baseline.length && !against.length ? adjustments?.get(label) : undefined;
    return [{ label, value: Math.round(value * (adjustment?.multiplier ?? 1)), matchupGames: against.length, adjustment }];
  });
}

const footballPositions = ["QB", "RB", "WR", "TE", "FB"];

function orderFootballPlayers(players: GameRosterPlayer[]) {
  const byPosition = new Map<string, GameRosterPlayer[]>();
  for (const player of players) {
    const position = player.position?.trim().toUpperCase() || "";
    const role = position === "HB" ? "RB" : position;
    if (role && !footballPositions.includes(role)) continue;
    const group = byPosition.get(role) ?? [];
    group.push(player);
    byPosition.set(role, group);
  }
  const ordered: GameRosterPlayer[] = [];
  const depth = Math.max(0, ...footballPositions.map((position) => byPosition.get(position)?.length ?? 0));
  for (let index = 0; index < depth; index++) {
    for (const position of footballPositions) {
      const player = byPosition.get(position)?.[index];
      if (player) ordered.push(player);
    }
  }
  return ordered.concat(byPosition.get("") ?? []);
}

type Props = {
  sport: string;
  eventId: string;
  homeTeamId: string;
  awayTeamId: string;
  home: string;
  away: string;
  startsAt: string;
  run: number;
};

export function SimulatorPlayerBoxScore({ sport, eventId, homeTeamId, awayTeamId, home, away, startsAt, run }: Props) {
  const colors = useColors();
  const isFootball = sport === "nfl" || sport === "ncaaf";
  const [showAllPlayers, setShowAllPlayers] = useState(false);
  const limit = showAllPlayers ? undefined : isFootball ? 4 : 3;
  const roster = useQuery({
    queryKey: ["sim-box-roster", sport, homeTeamId, awayTeamId],
    queryFn: ({ signal }) => fetchGameRoster(sport, homeTeamId, awayTeamId, signal),
    staleTime: 10 * 60_000,
    retry: false,
  });
  const firstBasket = useQuery({
    queryKey: ["sim-box-first-basket", eventId, homeTeamId, awayTeamId],
    enabled: sport === "nba",
    queryFn: ({ signal }) => fetchSimulatorFirstBasket(eventId, homeTeamId, awayTeamId, signal),
    staleTime: 5 * 60_000,
    retry: false,
  });
  const pick = firstBasket.data?.pick;
  const rosterPlayers = roster.data?.players ?? [];
  const teamsByAthlete = new Map<string, Set<string>>();
  for (const player of rosterPlayers) {
    if (!player.athleteId) continue;
    const teams = teamsByAthlete.get(player.athleteId) ?? new Set<string>();
    teams.add(player.teamId);
    teamsByAthlete.set(player.athleteId, teams);
  }
  const sides = [{ id: awayTeamId, team: away }, { id: homeTeamId, team: home }].map((side) => {
    const players = [...new Map(rosterPlayers
      .filter((player) => player.teamId === side.id && player.athleteId && teamsByAthlete.get(player.athleteId)?.size === 1)
      .map((player) => [player.athleteId!, player] as const)).values()];
    if (pick?.teamId === side.id) {
      players.sort((a, b) => Number(b.athleteId === pick.athleteId) - Number(a.athleteId === pick.athleteId));
    }
    return { ...side, players: isFootball ? orderFootballPlayers(players) : players };
  });
  const players = sides.flatMap((side) => side.players.slice(0, limit));
  const histories = useQueries({
    queries: players.map(({ athleteId, teamId, name }) => {
      const opponentTeamId = teamId === awayTeamId ? homeTeamId : awayTeamId;
      const opponentName = teamId === awayTeamId ? home : away;
      return {
        queryKey: ["sim-box-history", sport, athleteId, name, opponentTeamId, opponentName],
        queryFn: ({ signal }: { signal: AbortSignal }) =>
          fetchSimulatorPlayerHistory({ sport, athleteId, name, opponentTeamId, opponentName }, signal),
        staleTime: 10 * 60_000,
        retry: false,
      };
    }),
  });
  const historyByPlayer = new Map(players.map((player, i) => [player.athleteId, histories[i]]));
  const cutoff = Math.min(run, Date.parse(startsAt));
  const teamMatchup = useQueries({
    queries: [awayTeamId, homeTeamId].map((teamId) => ({
      queryKey: ["sim-team-matchup", sport, teamId],
      queryFn: ({ signal }: { signal: AbortSignal }) => fetchSimulatorTeamMatchup(sport, teamId, signal),
      enabled: Object.hasOwn(matchupMarkets, sport),
      staleTime: 10 * 60_000,
      retry: false,
    })),
  });
  const [awayEvidence, homeEvidence] = teamMatchup;
  const waitingForMatchup = teamMatchup.some((query) => query.isFetching && !query.data);
  const matchupByTeam = new Map([
    [awayTeamId, teamAdjustments(sport, awayEvidence?.data, homeEvidence?.data, cutoff)],
    [homeTeamId, teamAdjustments(sport, homeEvidence?.data, awayEvidence?.data, cutoff)],
  ]);
  const statsByPlayer = new Map(players.map(({ athleteId, teamId }) => {
    const history = historyByPlayer.get(athleteId)?.data;
    return [`${teamId}/${athleteId}`, projectPlayerStats(sport, history?.recent ?? [], history?.vsOpponent ?? [], cutoff, matchupByTeam.get(teamId))] as const;
  }));
  const visiblePickKey = pick && statsByPlayer.has(`${pick.teamId}/${pick.athleteId}`)
    ? `${pick.teamId}/${pick.athleteId}` : null;
  // Depend on projection values so asynchronous history loads are captured once.
  const projectionSignature = JSON.stringify([...statsByPlayer].flatMap(([playerKey, stats]) =>
    stats.map((stat) => ({ playerKey, ...stat }))));
  const [saveFailed, setSaveFailed] = useState(false);
  useEffect(() => {
    const projections = JSON.parse(projectionSignature) as Parameters<typeof trackSimulatorProjections>[0]["players"];
    if (waitingForMatchup || (!projections.length && !visiblePickKey)) return;
    let active = true;
    void trackSimulatorProjections({
      sport, eventId, homeTeamId, awayTeamId, startsAt, players: projections, firstBasketPick: visiblePickKey,
    }).then(() => { if (active) setSaveFailed(false); }, () => { if (active) setSaveFailed(true); });
    return () => { active = false; };
  }, [sport, eventId, homeTeamId, awayTeamId, startsAt, projectionSignature, visiblePickKey, waitingForMatchup]);

  const statKeys = new Map((sportStats[sport] ?? []).map(([label, ...keys]) => [label, keys]));
  const accuracy = useQuery({
    queryKey: ["sim-box-accuracy", sport],
    queryFn: ({ signal }) => refreshSimulatorAccuracy(sport, signal, (label, stats) => readStat(stats, statKeys.get(label) ?? [])),
    refetchInterval: 5 * 60_000,
    retry: false,
  });
  const metrics = new Map<string, { exact: number; compared: number; error: number }>();
  let basketHits = 0;
  let basketCount = 0;
  for (const tracked of accuracy.data ?? []) {
    for (const projection of tracked.players) {
      const actual = tracked.actuals?.[`${projection.playerKey}/${projection.label}`];
      if (actual == null) continue;
      const error = Math.abs(projection.value - actual);
      const metric = metrics.get(projection.label) ?? { exact: 0, compared: 0, error: 0 };
      metric.exact += Number(error === 0);
      metric.compared++;
      metric.error += error;
      metrics.set(projection.label, metric);
    }
    if (tracked.firstBasketCorrect != null) {
      basketCount++;
      basketHits += Number(tracked.firstBasketCorrect);
    }
  }

  return (
    <Card
      style={{
        marginBottom: 12,
        gap: 10,
        backgroundColor: "#071525",
        borderColor: "#1e3a55",
        borderRadius: 18,
        padding: 14,
      }}
    >
      <Text style={{ color: "#f4f8ff", fontFamily: FONT.bold, fontSize: 17 }}>
        Simulated Player Box Score
      </Text>
      <Text style={{ color: "#9db4cc", fontSize: 12, fontFamily: FONT.body }}>
        Player projections use recent form, head-to-head history, and team matchup data where available. The replay score comes from the team simulation.
      </Text>
      <Text style={{ color: "#e8f1fa", fontFamily: FONT.semibold }}>Projection Accuracy</Text>
      {saveFailed || accuracy.isError ? (
        <Text style={{ color: "#9db4cc" }}>Accuracy tracking is unavailable on this device.</Text>
      ) : metrics.size === 0 && !basketCount ? (
        <Text style={{ color: "#9db4cc", fontSize: 12 }}>No verified finals for saved projections yet.</Text>
      ) : null}
      {[...metrics].map(([label, { exact, compared, error }]) => (
        <Text key={label} style={{ color: "#9db4cc", fontSize: 12 }}>
          {label} · {exact}/{compared} exact · average miss {(error / compared).toFixed(1)}
        </Text>
      ))}
      {basketCount ? <Text style={{ color: "#9db4cc", fontSize: 12 }}>
        First Basket · {basketHits}/{basketCount} correct
      </Text> : null}
      {sport === "nba" && (!pick || !sides.some(({ id, players }) =>
        id === pick.teamId && players.some(({ athleteId }) => athleteId === pick.athleteId))) ? (
        <Text style={{ color: "#9db4cc" }}>
          {firstBasket.isFetching ? "Checking First Basket history…" : firstBasket.isError
            ? "Couldn’t load First Basket history." : "No verified First Basket pick for this roster."}
        </Text>
      ) : null}
      {roster.isPending || !players.length ? (
        <Text style={{ color: "#9db4cc" }}>
          {roster.isPending ? "Loading rosters…" : "Player rosters are unavailable for this matchup."}
        </Text>
      ) : sides.map(({ id, team, players: teamPlayers }) => (
        <View key={id} style={{ gap: 4 }}>
          <Text style={{ color: "#f4f8ff", fontFamily: FONT.bold, fontSize: 15, marginTop: 4 }}>{team}</Text>
          {!teamPlayers.length ? (
            <Text style={{ color: "#9db4cc" }}>Roster unavailable.</Text>
          ) : teamPlayers.slice(0, limit).map(({ athleteId, name }) => {
            const history = historyByPlayer.get(athleteId);
            const stats = statsByPlayer.get(`${id}/${athleteId}`) ?? [];
            const firstBasketPick = pick?.athleteId === athleteId && pick.teamId === id ? pick : null;
            return (
              <View
                key={athleteId}
                style={{ gap: 2, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#2a4563" }}
              >
                <Text style={{ color: "#f4f8ff", fontFamily: FONT.semibold }}>{name}</Text>
                {firstBasketPick ? (
                  <Text style={{ color: "#70d9ff" }}>
                    First Basket pick · {firstBasketPick.hits}/{firstBasketPick.starts} verified recent starts
                  </Text>
                ) : null}
                <Text style={{ color: "#b7c9dc", fontSize: 13, fontFamily: FONT.body }}>
                  {stats.length ? stats.map(({ value, label }) => `${value} ${label}`).join(" · ")
                    : history?.isPending ? "Loading player stats…" : history?.isError ? "Couldn’t load player history." : "No usable pregame stats available."}
                </Text>
                {stats.length ? <Text style={{ color: "#7f96ad", fontSize: 11 }}>
                  {waitingForMatchup ? "Checking team matchup…" : stats.some(({ adjustment }) => adjustment)
                    ? stats.flatMap(({ label, adjustment }) => adjustment
                      ? [`${label} matchup · team ${adjustment.scored.toFixed(1)}/game · opponent allows ${adjustment.allowed.toFixed(1)}/game`]
                      : []).join("\n")
                    : stats.some(({ matchupGames }) => matchupGames > 0)
                      ? "Includes head-to-head history" : "Recent form · matchup data unavailable"}
                </Text> : null}
              </View>
            );
          })}
        </View>
      ))}
      {limit !== undefined && sides.some((side) => side.players.length > limit) ? (
        <Pressable accessibilityRole="button" onPress={() => setShowAllPlayers(true)}
          style={{ minHeight: 44, justifyContent: "center" }}>
          <Text style={{ color: "#70d9ff", fontFamily: FONT.semibold }}>Show all players</Text>
        </Pressable>
      ) : null}
    </Card>
  );
}

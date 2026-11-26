import { useState } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { Pressable, Text, View } from "react-native";

import { Card, FONT } from "@/components/ui";
import { useColors } from "@/hooks/useColors";
import { fetchGameRoster, fetchSimulatorPlayerHistory, type GameRosterPlayer } from "@/lib/simulatorApi";

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
    const raw = stats[key]?.trim();
    if (!raw) continue;
    const madeAttempts = key === "3PT" ? raw.match(/^(\d+)-\d+$/) : null;
    const value = Number(madeAttempts ? madeAttempts[1] : raw);
    if (Number.isFinite(value)) return value;
  }
  return null;
}

export function sampleSimulatorBoxScore(
  sport: string,
  games: { date: string | null; stats: Record<string, string> }[],
  cutoff: number,
  seed: string,
) {
  const markets = sportStats[sport] ?? [];
  const samples = games
    .filter((game) => game.date && Date.parse(game.date) < cutoff)
    .flatMap((game) => {
      const stats = markets.flatMap(([label, ...keys]) => {
        const value = readStat(game.stats, keys);
        return value == null ? [] : [{ label, value }];
      });
      return stats.length ? [stats] : [];
    }).slice(0, 10);
  if (!samples.length) return [];
  let hash = 2166136261;
  for (const character of seed) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return samples[(hash >>> 0) % samples.length]!;
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
  homeTeamId: string;
  awayTeamId: string;
  home: string;
  away: string;
  startsAt: string;
  run: number;
};

export function SimulatorPlayerBoxScore({ sport, homeTeamId, awayTeamId, home, away, startsAt, run }: Props) {
  const colors = useColors();
  const isFootball = sport === "nfl" || sport === "ncaaf";
  const [limit, setLimit] = useState(isFootball ? 4 : 3);
  const roster = useQuery({
    queryKey: ["sim-box-roster", sport, homeTeamId, awayTeamId],
    queryFn: ({ signal }) => fetchGameRoster(sport, homeTeamId, awayTeamId, signal),
    staleTime: 10 * 60_000,
    retry: false,
  });
  const sides = [{ id: awayTeamId, team: away }, { id: homeTeamId, team: home }].map((side) => {
    const players = [...new Map((roster.data?.players ?? [])
      .filter((player) => player.teamId === side.id && player.athleteId)
      .map((player) => [player.athleteId!, player] as const)).values()];
    return { ...side, players: isFootball ? orderFootballPlayers(players) : players };
  });
  const players = sides.flatMap((side) => side.players.slice(0, limit));
  const histories = useQueries({
    queries: players.map(({ athleteId }) => ({
      queryKey: ["sim-box-history", sport, athleteId],
      queryFn: ({ signal }: { signal: AbortSignal }) => fetchSimulatorPlayerHistory({ sport, athleteId }, signal),
      staleTime: 10 * 60_000,
      retry: false,
    })),
  });
  const historyByPlayer = new Map(players.map((player, i) => [player.athleteId, histories[i]]));
  const cutoff = Math.min(run, Date.parse(startsAt));

  return (
    <Card style={{ marginBottom: 12, gap: 8 }}>
      <Text style={{ color: colors.foreground, fontFamily: FONT.semibold }}>Simulated Player Box Score</Text>
      <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>
        Each player’s line is sampled from recent games. Player totals are independent of the replay score.
        {isFootball ? " Football rows cover passing, rushing, and receiving." : null}
      </Text>
      {roster.isPending || !players.length ? (
        <Text style={{ color: colors.mutedForeground }}>
          {roster.isPending ? "Loading rosters…" : "Player rosters are unavailable for this matchup."}
        </Text>
      ) : sides.map(({ id, team, players: teamPlayers }) => (
        <View key={id} style={{ gap: 8 }}>
          <Text style={{ color: colors.foreground, fontFamily: FONT.semibold }}>{team}</Text>
          {!teamPlayers.length ? (
            <Text style={{ color: colors.mutedForeground }}>Roster unavailable.</Text>
          ) : teamPlayers.slice(0, limit).map(({ athleteId, name }) => {
            const history = historyByPlayer.get(athleteId);
            const stats = sampleSimulatorBoxScore(sport, history?.data?.recent ?? [], cutoff, `${run}/${athleteId}`);
            return (
              <View key={athleteId} style={{ gap: 3, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: colors.border }}>
                <Text style={{ color: colors.foreground, fontFamily: FONT.semibold }}>{name}</Text>
                <Text style={{ color: colors.mutedForeground }}>
                  {stats.length ? stats.map(({ value, label }) => `${value} ${label}`).join(" · ")
                    : history?.isPending ? "Loading player stats…" : "Recent stats unavailable."}
                </Text>
              </View>
            );
          })}
        </View>
      ))}
      {sides.some((side) => side.players.length > limit) ? (
        <Pressable accessibilityRole="button" onPress={() => setLimit((count) => count + 3)}
          style={{ minHeight: 44, justifyContent: "center" }}>
          <Text style={{ color: colors.primary, fontFamily: FONT.semibold }}>Show more players</Text>
        </Pressable>
      ) : null}
    </Card>
  );
}

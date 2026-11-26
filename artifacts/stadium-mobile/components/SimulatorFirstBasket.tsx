import { useQuery } from "@tanstack/react-query";
import { Text, View } from "react-native";

import { Card, FONT } from "@/components/ui";
import { useColors } from "@/hooks/useColors";
import { formatAmerican } from "@/lib/format";
import { fetchSimulatorFirstBasket } from "@/lib/simulatorApi";

const percent = (value: number) => `${(value * 100).toFixed(1)}%`;
const markets = {
  player_first_basket: "First scorer in game",
  player_first_team_basket: "First scorer on team",
  player_method_of_first_basket: "First score by player and method",
};
const methods = { FT: "Free throw", "2": "Two-pointer", "3": "Three-pointer" };

export function SimulatorFirstBasket({ eventId, homeTeamId, awayTeamId, startsAt, home, away }: {
  eventId: string; homeTeamId: string; awayTeamId: string; startsAt: string; home: string; away: string;
}) {
  const colors = useColors();
  const query = useQuery({
    queryKey: ["sim-nba-first-basket-model", eventId, homeTeamId, awayTeamId],
    queryFn: ({ signal }) => fetchSimulatorFirstBasket(eventId, homeTeamId, awayTeamId, signal),
    refetchInterval: () => {
      const remaining = Date.parse(startsAt) - Date.now();
      return remaining <= 0 ? false : remaining < 60 * 60_000 ? 60_000 : 5 * 60_000;
    },
    staleTime: 45_000,
    retry: false,
  });
  const result = query.data;
  const title = { color: colors.foreground, fontFamily: FONT.semibold, fontSize: 14 };
  const detail = { color: colors.mutedForeground, fontFamily: FONT.body, fontSize: 12 };
  const show = (homeProbability: number) => `${home} ${percent(homeProbability)} · ${away} ${percent(1 - homeProbability)}`;

  return (
    <Card style={{ marginHorizontal: 16, marginBottom: 16, gap: 8 }}>
      <Text style={title}>First Basket</Text>
      {query.isError || result?.status !== "ready" ? (
        <Text style={detail}>{query.isError ? "Couldn’t load First Basket data." :
          result?.status === "started" ? "Pregame prices are closed." :
          result?.status === "insufficient_history" ? "Confirmed starters are in. Verified opening-possession history is incomplete." :
          "Waiting for confirmed starters"}</Text>
      ) : (
        <>
          <Text style={detail}>Opening tip · {show(result.homeTipWin)}</Text>
          <Text style={detail}>First possession · {show(result.homeFirstPossession)}</Text>
          <Text style={detail}>Scores first, free throws count · {show(result.homeScoresFirst.points)}</Text>
          <Text style={detail}>First field goal, free throws excluded · {show(result.homeScoresFirst.field_goal)}</Text>
          {result.groups.every(group => !group.rows.length) &&
            <Text style={detail}>Waiting for posted prices with verified sportsbook rules.</Text>}
          {result.groups.filter(group => group.rows.length).map(group => (
            <View key={`${group.market}:${group.rule}`} style={{ gap: 5, borderTopWidth: 1, borderColor: colors.border, paddingTop: 8 }}>
              <Text style={title}>{markets[group.market]} · {group.rule === "points" ? "FT counts" : "FT excluded"}</Text>
              {group.rows.map(row => (
                <View key={row.playerId} style={{ gap: 2, paddingBottom: 5 }}>
                  <Text style={title}>{row.player} ({row.teamId === homeTeamId ? home : away}){row.method ? ` · ${methods[row.method]}` : ""} · {row.grade}</Text>
                  <Text style={detail}>{percent(row.probability)} model · {formatAmerican(row.fairPrice)} fair · {formatAmerican(row.price)} at {row.book}</Text>
                  <Text style={detail}>{percent(row.breakEven)} break-even · {percent(row.positiveEvProbability)} P(+EV) · {row.confidence} confidence</Text>
                  {row.noVig != null && <Text style={detail}>{percent(row.noVig)} book probability after vig removal</Text>}
                </View>
              ))}
            </View>
          ))}
          <Text style={detail}>{result.historyGames} verified opening games · Research model</Text>
        </>
      )}
    </Card>
  );
}

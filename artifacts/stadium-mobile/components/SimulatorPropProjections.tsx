import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Pressable, Text, View } from "react-native";

import { PropProjectionBreakdown } from "@/components/PropProjectionBreakdown";
import { FONT } from "@/components/ui";
import { useColors } from "@/hooks/useColors";
import { propMarketLabel } from "@/lib/api";
import { fetchSimulatorPropSimulationsBatch, type SimGetPropsArgs } from "@/lib/simulatorApi";
import { loadSimulatorProps } from "@/lib/simulatorProps";

export function SimulatorPropProjections(game: SimGetPropsArgs) {
  const colors = useColors();
  const [open, setOpen] = useState(false);
  const football = game.sport === "nfl" || game.sport === "ncaaf";
  const markets = football ? ["player_rush_yds"] : ["player_points", "player_threes", "player_rebounds", "player_assists"];
  const query = useQuery({
    queryKey: ["simulator-posted-projections", game.sport, game.eventId, game.startsAt, game.homeTeamId, game.awayTeamId],
    enabled: open,
    staleTime: 2 * 60_000,
    retry: false,
    queryFn: async ({ signal }) => {
      const posted = await loadSimulatorProps(game, signal);
      const requests = posted.flatMap((prop) => {
        if (prop.alt || prop.priceSource === "PrizePicks" || !markets.includes(prop.market) || prop.line == null ||
            !prop.athleteId || !prop.playerTeamId || (prop.overPrice == null && prop.underPrice == null)) return [];
        return [{
          player: prop.player, athleteId: prop.athleteId, playerTeamId: prop.playerTeamId,
          market: prop.market, line: prop.line, side: prop.overPrice != null ? "Over" as const : "Under" as const,
        }];
      });
      const batches = [];
      for (let i = 0; i < requests.length; i += 40) {
        batches.push(await fetchSimulatorPropSimulationsBatch(game.sport, requests.slice(i, i + 40), {
          homeTeam: game.home, awayTeam: game.away, homeTeamId: game.homeTeamId,
          awayTeamId: game.awayTeamId, startsAt: game.startsAt ?? undefined,
          espnEventId: /^\d+$/.test(game.eventId) ? game.eventId : undefined,
        }, signal));
      }
      return batches.flat().filter(row => row.hitProbability != null && row.projectionBreakdown != null);
    },
  });

  return (
    <View style={{ gap: 6 }}>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} onPress={() => setOpen(!open)}>
        <Text style={{ color: colors.primary, fontFamily: FONT.semibold, paddingVertical: 8 }}>
          {open ? "Hide posted prop projections" : "Show posted prop projections"}
        </Text>
      </Pressable>
      {open && (query.isPending || query.isError || !query.data?.length) && (
        <Text style={{ color: colors.mutedForeground }}>
          {query.isPending ? "Loading posted prop projections…" : "No posted prop projections available."}
        </Text>
      )}
      {open && query.data?.map((row, index) => (
        <View key={`${row.key}:${index}`} style={{ gap: 2 }}>
          <Text style={{ color: colors.foreground, fontFamily: FONT.semibold }}>
            {row.player} · {row.side} {row.line} {propMarketLabel(row.market)}
          </Text>
          <PropProjectionBreakdown breakdown={row.projectionBreakdown} />
        </View>
      ))}
    </View>
  );
}

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Pressable, ScrollView, Text, View } from "react-native";

import { PropProjectionBreakdown } from "@/components/PropProjectionBreakdown";
import { FONT } from "@/components/ui";
import { useColors } from "@/hooks/useColors";
import { propMarketLabel } from "@/lib/api";
import { fetchSimulatorPropSimulationsBatch, type SimGetPropsArgs } from "@/lib/simulatorApi";
import { formatAmerican, formatGameTime } from "@/lib/format";
import { simulatorNbaProjectionQuotes } from "@/lib/simulatorProjectionQuotes";
import { loadSimulatorProps } from "@/lib/simulatorProps";

export function SimulatorPropProjections(game: SimGetPropsArgs) {
  const colors = useColors();
  const [open, setOpen] = useState(false);
  const [selectedQuoteKey, setSelectedQuoteKey] = useState<string | null>(null);
  const football = game.sport === "nfl" || game.sport === "ncaaf";
  const markets = football ? ["player_rush_yds"] : ["player_points", "player_threes", ...(game.sport === "nba" ? [] : ["player_rebounds"]), "player_assists"];
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
      return {
        rows: batches.flat().filter(row => row.hitProbability != null && row.projectionBreakdown != null),
        comparisonQuotes: game.sport === "nba" ? simulatorNbaProjectionQuotes(posted, game.eventId) : [],
      };
    },
  });

  const selected = query.data?.comparisonQuotes.find(quote => quote.key === selectedQuoteKey);
  const comparison = useQuery({
    queryKey: ["simulator-nba-quote-projection", game.sport, game.eventId, game.startsAt, selected?.key],
    enabled: open && !!selected,
    retry: false,
    staleTime: 2 * 60_000,
    queryFn: async ({ signal }) => {
      if (!selected) return null;
      const { prop, side } = selected;
      const [row] = await fetchSimulatorPropSimulationsBatch(game.sport, [{
        player: prop.player, athleteId: prop.athleteId, playerTeamId: prop.playerTeamId,
        market: prop.market, line: prop.line!, side,
      }], {
        homeTeam: game.home, awayTeam: game.away, homeTeamId: game.homeTeamId,
        awayTeamId: game.awayTeamId, startsAt: game.startsAt ?? undefined,
        espnEventId: prop.espnEventId ?? (/^\d+$/.test(game.eventId) ? game.eventId : undefined),
      }, signal);
      return row?.market === prop.market && row.line === prop.line && row.side === side && row.hitProbability != null
        ? row.projectionBreakdown ?? null : null;
    },
  });

  return (
    <View style={{ gap: 6 }}>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} onPress={() => setOpen(!open)}>
        <Text style={{ color: colors.primary, fontFamily: FONT.semibold, paddingVertical: 8 }}>
          {open ? "Hide posted prop projections" : "Show posted prop projections"}
        </Text>
      </Pressable>
      {open && (query.isPending || query.isError || !query.data?.rows.length && !query.data?.comparisonQuotes.length) && (
        <Text style={{ color: colors.mutedForeground }}>
          {query.isPending ? "Loading posted prop projections…" : "No posted prop projections available."}
        </Text>
      )}
      {open && !!query.data?.comparisonQuotes.length && (
        <View style={{ gap: 6 }}>
          <Text style={{ color: colors.foreground, fontFamily: FONT.semibold }}>Posted rebounds and alternate assists</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
            {query.data.comparisonQuotes.map(quote => (
              <Pressable key={quote.key} onPress={() => setSelectedQuoteKey(quote.key)}
                accessibilityRole="button" accessibilityState={{ selected: quote.key === selectedQuoteKey }}
                style={{ padding: 10, borderWidth: 1, borderColor: quote.key === selectedQuoteKey ? colors.primary : colors.border, borderRadius: 8 }}>
                <Text style={{ color: colors.foreground }}>{quote.prop.player} · {propMarketLabel(quote.prop.market)} · {quote.side} {quote.prop.line} · {formatAmerican(quote.price)}</Text>
                <Text style={{ color: colors.mutedForeground }}>{quote.book} · {formatGameTime(quote.updatedAt) || quote.updatedAt}</Text>
              </Pressable>
            ))}
          </ScrollView>
          {selected && (comparison.data
            ? <PropProjectionBreakdown breakdown={comparison.data} />
            : <Text style={{ color: colors.mutedForeground }}>{comparison.isPending ? "Loading selected projection…" : "Selected projection unavailable."}</Text>)}
        </View>
      )}
      {open && query.data?.rows.map((row, index) => (
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

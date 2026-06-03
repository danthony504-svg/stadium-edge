import { Feather } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useMemo } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { GameCard, type GameMeta } from "@/components/GameCard";
import { SlipBar } from "@/components/SlipBar";
import { EmptyState, ErrorState, FONT, Loading } from "@/components/ui";
import { useColors } from "@/hooks/useColors";
import { getGames, getOdds, isPickable, type EspnGame, type OddsGame } from "@/lib/api";
import { SPORTS } from "@/lib/sports";

const nickname = (full: string) => (full || "").split(/\s+/).filter(Boolean).pop() || full;

function buildMetaMap(games: EspnGame[]): Map<string, GameMeta> {
  const map = new Map<string, GameMeta>();
  for (const g of games) {
    const home = g.homeTeam || g.homeAbbr || "";
    const away = g.awayTeam || g.awayAbbr || "";
    if (!home || !away) continue;
    const key = `${nickname(away)}|${nickname(home)}`.toLowerCase();
    map.set(key, {
      homeLogo: g.homeLogo,
      awayLogo: g.awayLogo,
      live: g.state === "in",
      awayScore: g.awayScore,
      homeScore: g.homeScore,
      periodLabel: g.periodLabel,
    });
  }
  return map;
}

export default function UpcomingScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { sport } = useLocalSearchParams<{ sport: string | string[] }>();
  const sportId = String((Array.isArray(sport) ? sport[0] : sport) || "");

  const oddsQ = useQuery({
    queryKey: ["odds", sportId],
    queryFn: ({ signal }) => getOdds(sportId, signal),
    staleTime: 60_000,
    enabled: !!sportId,
  });
  const gamesQ = useQuery({
    queryKey: ["games", sportId],
    queryFn: ({ signal }) => getGames(sportId, signal),
    staleTime: 60_000,
    enabled: !!sportId,
  });

  const metaMap = useMemo(() => buildMetaMap(gamesQ.data ?? []), [gamesQ.data]);

  const games: OddsGame[] = useMemo(() => {
    const list = (oddsQ.data ?? []).filter((g) => isPickable(g.commenceTime));
    return list.sort((a, b) => Date.parse(a.commenceTime) - Date.parse(b.commenceTime));
  }, [oddsQ.data]);

  const sportLabel = SPORTS.find((s) => s.id === sportId)?.label ?? sportId;

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      {/* Custom header */}
      <View
        style={{
          paddingTop: insets.top + 6,
          paddingBottom: 10,
          paddingHorizontal: 12,
          flexDirection: "row",
          alignItems: "center",
          gap: 6,
          borderBottomWidth: 1,
          borderBottomColor: colors.border,
        }}
      >
        <Pressable onPress={() => router.back()} hitSlop={10} style={{ padding: 6 }}>
          <Feather name="chevron-left" size={24} color={colors.foreground} />
        </Pressable>
        <Text
          style={{ color: colors.foreground, fontFamily: FONT.semibold, fontSize: 16, flex: 1 }}
          numberOfLines={1}
        >
          Upcoming {sportLabel} games
        </Text>
        {games.length > 0 ? (
          <View
            style={{
              minWidth: 24,
              height: 24,
              paddingHorizontal: 8,
              borderRadius: 12,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: colors.primary,
            }}
          >
            <Text style={{ color: colors.primaryForeground, fontFamily: FONT.display, fontSize: 13 }}>
              {games.length}
            </Text>
          </View>
        ) : null}
      </View>

      {oddsQ.isLoading ? (
        <Loading label="Loading live odds…" />
      ) : oddsQ.isError ? (
        <ErrorState onRetry={() => oddsQ.refetch()} />
      ) : games.length === 0 ? (
        <View style={{ padding: 16 }}>
          <EmptyState
            icon="calendar"
            title="No games in the window"
            subtitle={`No ${sportLabel} games are within the next 48 hours. Try another league.`}
          />
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 40, gap: 12 }}>
          {games.map((g) => {
            const meta = metaMap.get(`${nickname(g.awayTeam)}|${nickname(g.homeTeam)}`.toLowerCase());
            return (
              <GameCard
                key={g.id}
                game={g}
                meta={meta}
                onPress={() => router.push({ pathname: "/game/[id]", params: { id: g.id, sport: sportId } })}
              />
            );
          })}
        </ScrollView>
      )}
      {/* Floating slip popup — root-stack screen (outside the tab layout). */}
      <SlipBar />
    </View>
  );
}

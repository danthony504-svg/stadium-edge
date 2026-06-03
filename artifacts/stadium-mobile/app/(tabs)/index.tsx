import { Feather } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { useMemo, useState } from "react";
import {
  Image,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { GameCard, type GameMeta } from "@/components/GameCard";
import { EmptyState, ErrorState, FONT, Loading, Pill } from "@/components/ui";
import { useColors } from "@/hooks/useColors";
import { getGames, getOdds, isPickable, type EspnGame, type OddsGame } from "@/lib/api";
import { DEFAULT_SPORTS, SPORTS } from "@/lib/sports";

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

export default function HomeScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [sport, setSport] = useState(DEFAULT_SPORTS[0]);

  const oddsQ = useQuery({
    queryKey: ["odds", sport],
    queryFn: ({ signal }) => getOdds(sport, signal),
    staleTime: 60_000,
  });
  const gamesQ = useQuery({
    queryKey: ["games", sport],
    queryFn: ({ signal }) => getGames(sport, signal),
    staleTime: 60_000,
  });

  const metaMap = useMemo(() => buildMetaMap(gamesQ.data ?? []), [gamesQ.data]);

  const games: OddsGame[] = useMemo(() => {
    const list = (oddsQ.data ?? []).filter((g) => isPickable(g.commenceTime));
    return list.sort((a, b) => Date.parse(a.commenceTime) - Date.parse(b.commenceTime));
  }, [oddsQ.data]);

  const refreshing = oddsQ.isFetching || gamesQ.isFetching;

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView
        contentContainerStyle={{
          paddingTop: insets.top + 8,
          paddingBottom: insets.bottom + 96,
        }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              oddsQ.refetch();
              gamesQ.refetch();
            }}
            tintColor={colors.mutedForeground}
          />
        }
      >
        {/* Header */}
        <View style={{ paddingHorizontal: 16, marginBottom: 16 }}>
          <Image
            source={require("@/assets/images/logo.png")}
            style={{ width: 216, height: 86, marginLeft: -6 }}
            resizeMode="contain"
            accessibilityLabel="Stadium Edge"
          />
          <Text style={{ color: colors.mutedForeground, fontFamily: FONT.body, fontSize: 13, marginTop: 2 }}>
            Real lines. Real edges. No guesswork.
          </Text>
        </View>

        {/* AI Coach CTA */}
        <Pressable
          onPress={() => router.push("/coach")}
          style={({ pressed }) => ({ marginHorizontal: 16, marginBottom: 18, opacity: pressed ? 0.92 : 1 })}
        >
          <LinearGradient
            colors={[colors.primary, colors.accent]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={{ borderRadius: colors.radius, padding: 16, flexDirection: "row", alignItems: "center", gap: 14 }}
          >
            <View
              style={{
                width: 44,
                height: 44,
                borderRadius: 22,
                backgroundColor: "rgba(2,6,23,0.14)",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Feather name="zap" size={22} color="#020617" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ color: "#020617", fontFamily: FONT.display, fontSize: 16 }}>
                Build with AI Coach
              </Text>
              <Text style={{ color: "rgba(2,6,23,0.7)", fontFamily: FONT.body, fontSize: 12, marginTop: 2 }}>
                Parlays grounded in tonight&apos;s real odds
              </Text>
            </View>
            <Feather name="arrow-right" size={20} color="#020617" />
          </LinearGradient>
        </Pressable>

        {/* Sport selector */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 16, gap: 8, marginBottom: 18 }}
        >
          {SPORTS.map((s) => (
            <Pill key={s.id} label={s.label} active={sport === s.id} onPress={() => setSport(s.id)} />
          ))}
        </ScrollView>

        {/* Games */}
        <View style={{ paddingHorizontal: 16, gap: 12 }}>
          {oddsQ.isLoading ? (
            <Loading label="Loading live odds…" />
          ) : oddsQ.isError ? (
            <ErrorState onRetry={() => oddsQ.refetch()} />
          ) : games.length === 0 ? (
            <EmptyState
              icon="calendar"
              title="No games in the window"
              subtitle={`No ${SPORTS.find((s) => s.id === sport)?.label ?? sport} games are within the next 48 hours. Try another league.`}
            />
          ) : (
            games.map((g) => {
              const meta = metaMap.get(`${nickname(g.awayTeam)}|${nickname(g.homeTeam)}`.toLowerCase());
              return (
                <GameCard
                  key={g.id}
                  game={g}
                  meta={meta}
                  onPress={() => router.push({ pathname: "/game/[id]", params: { id: g.id, sport } })}
                />
              );
            })
          )}
        </View>
      </ScrollView>
    </View>
  );
}

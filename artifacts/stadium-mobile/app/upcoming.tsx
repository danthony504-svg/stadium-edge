import { Feather } from "@expo/vector-icons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { useMemo } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ErrorBoundary } from "@/components/ErrorBoundary";
import type { ErrorFallbackProps } from "@/components/ErrorFallback";
import { GameCard, type GameMeta } from "@/components/GameCard";
import { EmptyState, ErrorState, FONT, Loading, TYPE } from "@/components/ui";
import { useColors } from "@/hooks/useColors";
import {
  getGames,
  getOdds,
  getTennisFlags,
  isPickable,
  resolveTennisFlag,
  type EspnGame,
  type OddsGame,
  type TennisFlag,
} from "@/lib/api";
import {
  espnRowsFromQuery,
  oddsRowsFromQuery,
  type SportFeedPayload,
} from "@/lib/sportFeed";
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

function withTennisFlags(
  base: GameMeta | undefined,
  flags: Record<string, TennisFlag> | undefined,
  g: OddsGame,
): GameMeta | undefined {
  if (!flags) return base;
  const awayFlag = resolveTennisFlag(flags, g.awayTeam);
  const homeFlag = resolveTennisFlag(flags, g.homeTeam);
  if (!awayFlag && !homeFlag) return base;
  return {
    ...(base ?? {}),
    awayLogo: awayFlag ?? base?.awayLogo ?? null,
    homeLogo: homeFlag ?? base?.homeLogo ?? null,
  };
}

function UpcomingFeedErrorFallback({ error, resetError }: ErrorFallbackProps) {
  const colors = useColors();
  return (
    <View style={{ flex: 1, padding: 24, justifyContent: "center", gap: 12 }}>
      <Text style={{ color: colors.foreground, ...TYPE.button, textAlign: "center" }}>
        Couldn't load upcoming games
      </Text>
      <Text
        style={{
          color: colors.mutedForeground,
          fontFamily: FONT.medium,
          fontSize: 13,
          textAlign: "center",
          lineHeight: 19,
        }}
      >
        Go back to Home — View all now expands the list in place without opening this screen.
      </Text>
      {error.message ? (
        <Text
          style={{
            color: colors.mutedForeground,
            fontFamily: FONT.medium,
            fontSize: 11,
            textAlign: "center",
            opacity: 0.75,
          }}
          numberOfLines={3}
        >
          {error.message}
        </Text>
      ) : null}
      <Pressable
        onPress={() => {
          resetError();
          router.back();
        }}
        style={({ pressed }) => ({
          alignSelf: "center",
          backgroundColor: colors.primary,
          borderRadius: 10,
          paddingVertical: 12,
          paddingHorizontal: 28,
          opacity: pressed ? 0.9 : 1,
        })}
      >
        <Text style={{ color: colors.primaryForeground, fontFamily: FONT.semibold, fontSize: 14 }}>
          Back to Home
        </Text>
      </Pressable>
    </View>
  );
}

/** Deep-link / legacy route — Home "View all" expands inline on Discover. */
function UpcomingScreenBody() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const { sport } = useLocalSearchParams<{ sport: string | string[] }>();
  const sportId = String((Array.isArray(sport) ? sport[0] : sport) || "").toLowerCase();
  const sportLabel = SPORTS.find((s) => s.id === sportId)?.label ?? sportId;

  const oddsQ = useQuery({
    queryKey: ["odds", sportId],
    queryFn: async ({ signal }) => {
      const rows = await getOdds(sportId, signal);
      return { gen: 0, league: sportId, rows } satisfies SportFeedPayload<OddsGame>;
    },
    initialData: () => queryClient.getQueryData<SportFeedPayload<OddsGame>>(["odds", sportId]),
    staleTime: 60_000,
    enabled: !!sportId,
    retry: false,
  });

  const gamesQ = useQuery({
    queryKey: ["games", sportId],
    queryFn: async ({ signal }) => {
      const rows = await getGames(sportId, signal);
      return { gen: 0, league: sportId, rows } satisfies SportFeedPayload<EspnGame>;
    },
    initialData: () => queryClient.getQueryData<SportFeedPayload<EspnGame>>(["games", sportId]),
    staleTime: 60_000,
    enabled: !!sportId,
    retry: false,
  });

  const tennisFlagsQ = useQuery({
    queryKey: ["tennis-flags"],
    queryFn: ({ signal }) => getTennisFlags(signal),
    staleTime: 5 * 60_000,
    enabled: sportId === "tennis",
    retry: false,
  });

  const espnGames = useMemo(() => espnRowsFromQuery(gamesQ.data, sportId), [gamesQ.data, sportId]);
  const metaMap = useMemo(() => buildMetaMap(espnGames), [espnGames]);

  const liveKeySet = useMemo(() => {
    const s = new Set<string>();
    for (const g of espnGames) {
      if (g.state !== "in") continue;
      const home = g.homeTeam || g.homeAbbr || "";
      const away = g.awayTeam || g.awayAbbr || "";
      if (!home || !away) continue;
      s.add(`${nickname(away)}|${nickname(home)}`.toLowerCase());
    }
    return s;
  }, [espnGames]);

  const upcomingGames = useMemo(() => {
    const rows = oddsRowsFromQuery(oddsQ.data, sportId);
    return rows
      .filter((g) => isPickable(g.commenceTime))
      .filter(
        (g) => !liveKeySet.has(`${nickname(g.awayTeam)}|${nickname(g.homeTeam)}`.toLowerCase()),
      )
      .sort((a, b) => Date.parse(a.commenceTime) - Date.parse(b.commenceTime));
  }, [oddsQ.data, sportId, liveKeySet]);

  if (!sportId) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background, padding: 16 }}>
        <EmptyState icon="calendar" title="No league selected" subtitle="Go back and pick a sport on Home." />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
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
      </View>

      {oddsQ.isLoading && upcomingGames.length === 0 ? (
        <Loading label="Loading live odds…" />
      ) : oddsQ.isError && upcomingGames.length === 0 ? (
        <ErrorState onRetry={() => oddsQ.refetch()} />
      ) : upcomingGames.length === 0 ? (
        <View style={{ padding: 16 }}>
          <EmptyState
            icon="calendar"
            title="No games in the window"
            subtitle={`No ${sportLabel} games are within the next 48 hours.`}
          />
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 24, gap: 12 }}>
          {upcomingGames.map((g) => {
            const baseMeta = metaMap.get(
              `${nickname(g.awayTeam)}|${nickname(g.homeTeam)}`.toLowerCase(),
            );
            const meta =
              sportId === "tennis" ? withTennisFlags(baseMeta, tennisFlagsQ.data, g) : baseMeta;
            return (
              <GameCard
                key={g.id}
                game={{ ...g, sport: g.sport || sportId }}
                meta={meta}
                onPress={() =>
                  router.push({
                    pathname: "/game/[id]",
                    params: { id: g.id, sport: g.sport || sportId },
                  })
                }
              />
            );
          })}
        </ScrollView>
      )}
    </View>
  );
}

export default function UpcomingScreen() {
  return (
    <ErrorBoundary FallbackComponent={UpcomingFeedErrorFallback}>
      <UpcomingScreenBody />
    </ErrorBoundary>
  );
}

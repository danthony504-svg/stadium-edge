import { Feather } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useMemo } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ErrorBoundary } from "@/components/ErrorBoundary";
import type { ErrorFallbackProps } from "@/components/ErrorFallback";
import { GameCard, type GameMeta } from "@/components/GameCard";
import { SlipBar, useSlipClearance } from "@/components/SlipBar";
import { EmptyState, FONT, Loading } from "@/components/ui";
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
import { cachedUpcomingGames } from "@/lib/discoverSessionCache";
import {
  espnRowsFromQuery,
  isRenderableOddsGame,
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
    <View style={{ padding: 24, gap: 12 }}>
      <Text style={{ color: colors.foreground, fontFamily: FONT.display, fontSize: 17, textAlign: "center" }}>
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
        Tap retry, or go back and pull to refresh on Home. If this keeps happening, force-quit and reopen
        the app so the latest update can finish installing.
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
        onPress={resetError}
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
          Retry
        </Text>
      </Pressable>
    </View>
  );
}

export default function UpcomingScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const slipClearance = useSlipClearance();
  const router = useRouter();
  const { sport } = useLocalSearchParams<{ sport: string | string[] }>();
  const sportId = String((Array.isArray(sport) ? sport[0] : sport) || "");

  // Use dedicated query keys so we never treat Home's generation-tagged cache
  // (`{ gen, league, rows }`) as a plain OddsGame[] — that mismatch was
  // crashing "View all" when the Home feed had already warmed the cache.
  const oddsQ = useQuery<SportFeedPayload<OddsGame>>({
    queryKey: ["upcoming-odds", sportId],
    queryFn: async ({ signal, queryKey }) => {
      const league = String(queryKey[1] ?? "");
      try {
        const rows = await getOdds(league, signal);
        return { gen: 0, league, rows };
      } catch {
        return { gen: 0, league, rows: [] as OddsGame[] };
      }
    },
    staleTime: 60_000,
    enabled: !!sportId,
    placeholderData: () => {
      const cached = cachedUpcomingGames(sportId);
      return cached.length > 0 ? { gen: 0, league: sportId, rows: cached } : undefined;
    },
  });
  const gamesQ = useQuery<SportFeedPayload<EspnGame>>({
    queryKey: ["upcoming-games", sportId],
    queryFn: async ({ signal, queryKey }) => {
      const league = String(queryKey[1] ?? "");
      try {
        const rows = await getGames(league, signal);
        return { gen: 0, league, rows };
      } catch {
        return { gen: 0, league, rows: [] as EspnGame[] };
      }
    },
    staleTime: 60_000,
    enabled: !!sportId,
  });

  const tennisFlagsQ = useQuery({
    queryKey: ["tennis-flags"],
    queryFn: ({ signal }) => getTennisFlags(signal),
    staleTime: 5 * 60_000,
    enabled: sportId === "tennis",
    retry: false,
  });

  const espnGames = useMemo(
    () => espnRowsFromQuery(gamesQ.data, sportId),
    [gamesQ.data, sportId],
  );
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

  const games: OddsGame[] = useMemo(() => {
    const list = oddsRowsFromQuery(oddsQ.data, sportId)
      .filter(isRenderableOddsGame)
      .filter((g) => isPickable(g.commenceTime))
      .filter(
        (g) =>
          !liveKeySet.has(`${nickname(g.awayTeam)}|${nickname(g.homeTeam)}`.toLowerCase()),
      );
    return list.sort((a, b) => Date.parse(a.commenceTime) - Date.parse(b.commenceTime));
  }, [oddsQ.data, liveKeySet, sportId]);

  const sportLabel = SPORTS.find((s) => s.id === sportId)?.label ?? sportId;
  const feedLoading = oddsQ.isFetching && games.length === 0;

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

      {feedLoading ? (
        <Loading label="Loading live odds…" />
      ) : games.length === 0 ? (
        <View style={{ padding: 16 }}>
          <EmptyState
            icon="calendar"
            title="No games in the window"
            subtitle={`No ${sportLabel} games are within the next 48 hours. Try another league.`}
          />
        </View>
      ) : (
        <ErrorBoundary FallbackComponent={UpcomingFeedErrorFallback}>
          <ScrollView
            contentContainerStyle={{
              padding: 16,
              paddingBottom: insets.bottom + 40 + slipClearance,
              gap: 12,
            }}
          >
            {games.map((g) => {
              const baseMeta = metaMap.get(
                `${nickname(g.awayTeam)}|${nickname(g.homeTeam)}`.toLowerCase(),
              );
              const meta =
                sportId === "tennis"
                  ? withTennisFlags(baseMeta, tennisFlagsQ.data, g)
                  : baseMeta;
              return (
                <GameCard
                  key={g.id}
                  game={{ ...g, sport: g.sport || sportId }}
                  meta={meta}
                  onPress={() =>
                    router.push({ pathname: "/game/[id]", params: { id: g.id, sport: sportId } })
                  }
                />
              );
            })}
          </ScrollView>
        </ErrorBoundary>
      )}
      <SlipBar />
    </View>
  );
}

import { Feather } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useMemo } from "react";
import { Image, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ErrorBoundary } from "@/components/ErrorBoundary";
import type { ErrorFallbackProps } from "@/components/ErrorFallback";
import { type GameMeta } from "@/components/GameCard";
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
import { formatAmerican } from "@/lib/format";
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
    <View style={{ flex: 1, padding: 24, justifyContent: "center", gap: 12 }}>
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

function UpcomingGameRow({
  game,
  sportId,
  meta,
  onPress,
}: {
  game: OddsGame;
  sportId: string;
  meta?: GameMeta;
  onPress: () => void;
}) {
  const colors = useColors();
  const h2h = game.markets?.find((m) => m.key === "h2h");
  const awayML = h2h?.outcomes?.find((o) => o.name === game.awayTeam)?.price;
  const homeML = h2h?.outcomes?.find((o) => o.name === game.homeTeam)?.price;
  const rows = [
    { name: game.awayTeam, logo: meta?.awayLogo, ml: awayML },
    { name: game.homeTeam, logo: meta?.homeLogo, ml: homeML },
  ];

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        backgroundColor: colors.card,
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: colors.radius,
        padding: 14,
        gap: 10,
        opacity: pressed ? 0.9 : 1,
      })}
    >
      <View style={{ flexDirection: "row", alignItems: "center" }}>
        <Text
          style={{
            color: colors.mutedForeground,
            fontFamily: FONT.semibold,
            fontSize: 12,
            flex: 1,
          }}
          numberOfLines={1}
        >
          {nickname(game.awayTeam)} @ {nickname(game.homeTeam)}
        </Text>
        {game.commenceTime ? (
          <Text style={{ color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 11 }}>
            {new Date(game.commenceTime).toLocaleString([], {
              weekday: "short",
              hour: "numeric",
              minute: "2-digit",
            })}
          </Text>
        ) : null}
      </View>

      {rows.map((t, i) => (
        <View key={i} style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          {t.logo ? (
            <Image source={{ uri: t.logo }} style={{ width: 24, height: 24 }} resizeMode="contain" />
          ) : (
            <View style={{ width: 24, height: 24 }} />
          )}
          <Text
            style={{ color: colors.foreground, fontFamily: FONT.semibold, fontSize: 15, flex: 1 }}
            numberOfLines={1}
          >
            {t.name}
          </Text>
          {t.ml != null ? (
            <Text style={{ color: colors.foreground, fontFamily: FONT.bold, fontSize: 14 }}>
              {formatAmerican(t.ml)}
            </Text>
          ) : null}
        </View>
      ))}
    </Pressable>
  );
}

function UpcomingScreenBody() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const slipClearance = useSlipClearance();
  const router = useRouter();
  const { sport } = useLocalSearchParams<{ sport: string | string[] }>();
  const sportId = String((Array.isArray(sport) ? sport[0] : sport) || "");

  const oddsQ = useQuery<SportFeedPayload<OddsGame>>({
    queryKey: ["upcoming-odds", sportId],
    queryFn: async ({ signal, queryKey }) => {
      const league = String(queryKey[1] ?? "");
      try {
        const rows = await getOdds(league, signal);
        return { gen: 0, league, rows: rows.filter(isRenderableOddsGame) };
      } catch {
        return { gen: 0, league, rows: [] as OddsGame[] };
      }
    },
    staleTime: 60_000,
    enabled: !!sportId,
    placeholderData: () => {
      const cached = cachedUpcomingGames(sportId).filter(isRenderableOddsGame);
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
              sportId === "tennis" ? withTennisFlags(baseMeta, tennisFlagsQ.data, g) : baseMeta;
            return (
              <UpcomingGameRow
                key={g.id}
                game={{ ...g, sport: g.sport || sportId }}
                sportId={sportId}
                meta={meta}
                onPress={() =>
                  router.push({ pathname: "/game/[id]", params: { id: g.id, sport: sportId } })
                }
              />
            );
          })}
        </ScrollView>
      )}
      <SlipBar />
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

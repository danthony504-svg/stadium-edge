import { Feather } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import type { Router } from "expo-router";
import { useMemo } from "react";
import { Image, Pressable, RefreshControl, ScrollView, Text, View } from "react-native";

import type { GameMeta } from "@/components/GameCard";
import { EmptyState, ErrorState, FONT, Loading } from "@/components/ui";
import { useColors } from "@/hooks/useColors";
import { markCoachHomeLaunch } from "@/lib/coachSilentLaunch";
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
import { formatAmerican } from "@/lib/format";
import { oddsRowsFromQuery } from "@/lib/sportFeed";

const nickname = (full: string) => (full || "").split(/\s+/).filter(Boolean).pop() || full;

function withTennisFlags(
  base: GameMeta | undefined,
  flags: Record<string, TennisFlag> | undefined,
  g: OddsGame,
): GameMeta | undefined {
  try {
    if (!flags) return base;
    const awayFlag = resolveTennisFlag(flags, g.awayTeam);
    const homeFlag = resolveTennisFlag(flags, g.homeTeam);
    if (!awayFlag && !homeFlag) return base;
    return {
      ...(base ?? {}),
      awayLogo: awayFlag ?? base?.awayLogo ?? null,
      homeLogo: homeFlag ?? base?.homeLogo ?? null,
    };
  } catch {
    return base;
  }
}

type TennisHomeFeedProps = {
  router: Router;
  width: number;
  slipClearance: number;
  bottomInset: number;
  onBuildParlay: () => void;
};

/** Minimal Home feed for Tennis — no featured props, upsets, or useQueries fan-out. */
export function TennisHomeFeed({
  router,
  width,
  slipClearance,
  bottomInset,
  onBuildParlay,
}: TennisHomeFeedProps) {
  const colors = useColors();
  const sport = "tennis";

  const oddsQ = useQuery({
    queryKey: ["odds", sport],
    queryFn: ({ signal }) => getOdds(sport, signal),
    staleTime: 45_000,
    retry: false,
  });
  const gamesQ = useQuery({
    queryKey: ["games", sport],
    queryFn: ({ signal }) => getGames(sport, signal),
    staleTime: 45_000,
    retry: false,
  });
  const flagsQ = useQuery({
    queryKey: ["tennis-flags"],
    queryFn: ({ signal }) => getTennisFlags(signal),
    staleTime: 5 * 60_000,
    retry: false,
  });

  const gamesForSport = useMemo(() => {
    const rows = Array.isArray(gamesQ.data) ? gamesQ.data : [];
    return rows.filter((g) => g.sport === sport);
  }, [gamesQ.data]);

  const metaMap = useMemo(() => {
    const map = new Map<string, GameMeta>();
    for (const g of gamesForSport) {
      const home = g.homeTeam || g.homeAbbr || "";
      const away = g.awayTeam || g.awayAbbr || "";
      if (!home || !away) continue;
      map.set(`${nickname(away)}|${nickname(home)}`.toLowerCase(), {
        homeLogo: g.homeLogo,
        awayLogo: g.awayLogo,
        live: g.state === "in",
        awayScore: g.awayScore,
        homeScore: g.homeScore,
        periodLabel: g.periodLabel,
      });
    }
    return map;
  }, [gamesForSport]);

  const liveGames = useMemo(
    () => gamesForSport.filter((g) => g.state === "in"),
    [gamesForSport],
  );

  const liveKeySet = useMemo(() => {
    const s = new Set<string>();
    for (const g of liveGames) {
      const home = g.homeTeam || g.homeAbbr || "";
      const away = g.awayTeam || g.awayAbbr || "";
      if (!home || !away) continue;
      s.add(`${nickname(away)}|${nickname(home)}`.toLowerCase());
    }
    return s;
  }, [liveGames]);

  const upcoming = useMemo(() => {
    const rows = oddsRowsFromQuery(oddsQ.data, sport);
    return rows
      .filter((g) => g.sport === sport && isPickable(g.commenceTime))
      .filter(
        (g) =>
          !liveKeySet.has(`${nickname(g.awayTeam)}|${nickname(g.homeTeam)}`.toLowerCase()),
      )
      .sort((a, b) => Date.parse(a.commenceTime) - Date.parse(b.commenceTime));
  }, [oddsQ.data, liveKeySet]);

  const loading = oddsQ.isFetching || gamesQ.isFetching;
  const refreshing = oddsQ.isFetching || gamesQ.isFetching || flagsQ.isFetching;

  const askCoach = (msg: string, silent = false) => {
    if (silent) markCoachHomeLaunch();
    router.push({
      pathname: "/coach",
      params: { autoMsg: msg, send: "1", ts: String(Date.now()) },
    });
  };

  return (
    <ScrollView
      contentContainerStyle={{ paddingBottom: bottomInset + 24 + slipClearance }}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => {
            void oddsQ.refetch();
            void gamesQ.refetch();
            void flagsQ.refetch();
          }}
          tintColor={colors.mutedForeground}
        />
      }
    >
      <Pressable
        onPress={onBuildParlay}
        style={({ pressed }) => ({
          marginHorizontal: 16,
          marginTop: 18,
          marginBottom: 16,
          backgroundColor: colors.card,
          borderWidth: 1,
          borderColor: colors.primary,
          borderRadius: colors.radius,
          padding: 16,
          opacity: pressed ? 0.92 : 1,
        })}
      >
        <Text style={{ color: colors.foreground, fontFamily: FONT.display, fontSize: 18 }}>
          Build best parlay
        </Text>
        <Text style={{ color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 13, marginTop: 4 }}>
          AI picks from live tennis moneylines when matches are on the board.
        </Text>
      </Pressable>

      {liveGames.length > 0 ? (
        <View style={{ marginBottom: 22 }}>
          <Text
            style={{
              color: colors.foreground,
              fontFamily: FONT.display,
              fontSize: 18,
              paddingHorizontal: 16,
              marginBottom: 12,
            }}
          >
            Live Now
          </Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: 16, gap: 12 }}
          >
            {liveGames.map((g: EspnGame) => (
              <Pressable
                key={g.id}
                onPress={() => router.push({ pathname: "/game/[id]", params: { id: g.id, sport } })}
                style={{
                  width: Math.min(300, width - 32),
                  backgroundColor: colors.card,
                  borderWidth: 1,
                  borderColor: colors.border,
                  borderRadius: colors.radius,
                  padding: 14,
                  gap: 8,
                }}
              >
                <Text style={{ color: "#ef4444", fontFamily: FONT.bold, fontSize: 11 }}>
                  {g.periodLabel || "Live"}
                </Text>
                <Text style={{ color: colors.foreground, fontFamily: FONT.semibold, fontSize: 15 }}>
                  {g.awayTeam} vs {g.homeTeam}
                </Text>
                <Text style={{ color: colors.foreground, fontFamily: FONT.bold, fontSize: 18 }}>
                  {g.awayScore ?? 0} – {g.homeScore ?? 0}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      ) : null}

      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          paddingHorizontal: 16,
          marginBottom: 12,
        }}
      >
        <Text style={{ color: colors.foreground, fontFamily: FONT.display, fontSize: 18 }}>
          Upcoming Matches
        </Text>
      </View>

      {loading && upcoming.length === 0 ? (
        <View style={{ paddingHorizontal: 16 }}>
          <Loading label="Loading tennis odds…" />
        </View>
      ) : oddsQ.isError && !oddsQ.data ? (
        <View style={{ paddingHorizontal: 16 }}>
          <ErrorState onRetry={() => oddsQ.refetch()} />
        </View>
      ) : upcoming.length === 0 ? (
        <View style={{ paddingHorizontal: 16 }}>
          <EmptyState
            icon="calendar"
            title="No matches in the window"
            subtitle="No pregame tennis matchups in the next 48 hours right now. Live and completed matches are hidden."
          />
        </View>
      ) : (
        <View style={{ paddingHorizontal: 16, gap: 10 }}>
          {upcoming.map((g) => {
            const baseMeta = metaMap.get(
              `${nickname(g.awayTeam)}|${nickname(g.homeTeam)}`.toLowerCase(),
            );
            const meta = withTennisFlags(baseMeta, flagsQ.data, g);
            const h2h = g.markets?.find((m) => m.key === "h2h");
            const awayML = h2h?.outcomes?.find((o) => o.name === g.awayTeam)?.price;
            const homeML = h2h?.outcomes?.find((o) => o.name === g.homeTeam)?.price;
            const rows = [
              { name: g.awayTeam, logo: meta?.awayLogo, ml: awayML },
              { name: g.homeTeam, logo: meta?.homeLogo, ml: homeML },
            ];
            return (
              <Pressable
                key={g.id}
                onPress={() => router.push({ pathname: "/game/[id]", params: { id: g.id, sport } })}
                style={{
                  backgroundColor: colors.card,
                  borderWidth: 1,
                  borderColor: colors.border,
                  borderRadius: colors.radius,
                  padding: 14,
                  gap: 10,
                }}
              >
                <Text style={{ color: colors.mutedForeground, fontFamily: FONT.semibold, fontSize: 12 }}>
                  {nickname(g.awayTeam)} @ {nickname(g.homeTeam)}
                </Text>
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
          })}
        </View>
      )}

      <Pressable
        onPress={() => askCoach("Build me the best tennis parlay for today's board")}
        style={({ pressed }) => ({
          marginHorizontal: 16,
          marginTop: 20,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
          backgroundColor: "rgba(59,130,246,0.14)",
          borderWidth: 1,
          borderColor: colors.primary,
          borderRadius: 999,
          paddingVertical: 12,
          opacity: pressed ? 0.85 : 1,
        })}
      >
        <Feather name="message-circle" size={16} color={colors.primary} />
        <Text style={{ color: colors.primary, fontFamily: FONT.semibold, fontSize: 13 }}>
          Ask Coach about tennis
        </Text>
      </Pressable>
    </ScrollView>
  );
}

import { Feather } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
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
import {
  getGames,
  getOdds,
  getProps,
  isPickable,
  propMarketLabel,
  PROPS_SPORTS,
  type EspnGame,
  type OddsGame,
} from "@/lib/api";
import { formatAmerican } from "@/lib/format";
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

// A featured player built ONLY from a real bookmaker prop line — never an
// invented "form" rating. Team abbreviation is resolved from the player's real
// ESPN team id matched against the game's home/away ids.
type FeaturedPlayer = {
  name: string;
  headshot: string | null;
  teamAbbr: string | null;
  label: string;
  line: number;
  overPrice: number;
};

function FeaturedAvatar({ headshot, name }: { headshot: string | null; name: string }) {
  const colors = useColors();
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
  return (
    <View
      style={{
        width: 56,
        height: 56,
        borderRadius: 28,
        backgroundColor: colors.surface,
        borderWidth: 1,
        borderColor: colors.border,
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
      }}
    >
      {headshot ? (
        <Image source={{ uri: headshot }} style={{ width: 56, height: 56 }} resizeMode="cover" />
      ) : (
        <Text style={{ color: colors.mutedForeground, fontFamily: FONT.bold, fontSize: 16 }}>
          {initials || "?"}
        </Text>
      )}
    </View>
  );
}

export default function HomeScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [sport, setSport] = useState(DEFAULT_SPORTS[0]);
  const [showAllUpcoming, setShowAllUpcoming] = useState(false);

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

  const liveGames = useMemo(
    () => (gamesQ.data ?? []).filter((g) => g.state === "in"),
    [gamesQ.data],
  );

  // Featured players: only for sports the props feed serves. IMPORTANT: draw the
  // game list from the SAME source + ordering the Props tab uses (Odds API odds,
  // soonest first) so any featured player is guaranteed to also appear when we
  // deep-link into the Props search. ESPN games only supply team ids/abbrs (for
  // headshots + team labels), matched by nickname.
  const featuredEnabled = PROPS_SPORTS.includes(sport);
  const featGames = useMemo(() => games.slice(0, 4), [games]);
  const featIdsKey = featGames.map((g) => g.id).join(",");

  const teamInfoMap = useMemo(() => {
    const map = new Map<
      string,
      { homeTeamId: string | null; awayTeamId: string | null; homeAbbr: string | null; awayAbbr: string | null }
    >();
    for (const g of gamesQ.data ?? []) {
      const home = g.homeTeam || g.homeAbbr || "";
      const away = g.awayTeam || g.awayAbbr || "";
      if (!home || !away) continue;
      map.set(`${nickname(away)}|${nickname(home)}`.toLowerCase(), {
        homeTeamId: g.homeTeamId ?? null,
        awayTeamId: g.awayTeamId ?? null,
        homeAbbr: g.homeAbbr ?? null,
        awayAbbr: g.awayAbbr ?? null,
      });
    }
    return map;
  }, [gamesQ.data]);

  const featuredQ = useQuery({
    queryKey: ["home-featured", sport, featIdsKey],
    // Wait for ESPN games to SUCCEED (not merely settle) so team ids/headshots are
    // attached on the first pass; without headshots every prop is filtered out. When
    // gamesQ flips false->true the query enables and runs.
    enabled: featuredEnabled && featGames.length > 0 && gamesQ.isSuccess,
    staleTime: 2 * 60_000,
    queryFn: async ({ signal }): Promise<FeaturedPlayer[]> => {
      const settled = await Promise.allSettled(
        featGames.map((g) => {
          const info = teamInfoMap.get(
            `${nickname(g.awayTeam)}|${nickname(g.homeTeam)}`.toLowerCase(),
          );
          return getProps(
            {
              sport,
              eventId: g.id,
              home: g.homeTeam,
              away: g.awayTeam,
              homeTeamId: info?.homeTeamId,
              awayTeamId: info?.awayTeamId,
            },
            signal,
          ).then((r) => ({ info, props: r.props ?? [] }));
        }),
      );
      const seen = new Set<string>();
      const out: FeaturedPlayer[] = [];
      for (const s of settled) {
        if (s.status !== "fulfilled") continue;
        const { info, props } = s.value;
        for (const p of props) {
          if (p.alt || !p.headshot || p.overPrice == null || p.line == null) continue;
          const key = p.player.toLowerCase();
          if (seen.has(key)) continue;
          seen.add(key);
          const teamAbbr =
            p.playerTeamId && info?.homeTeamId && p.playerTeamId === info.homeTeamId
              ? info.homeAbbr
              : p.playerTeamId && info?.awayTeamId && p.playerTeamId === info.awayTeamId
                ? info.awayAbbr
                : null;
          out.push({
            name: p.player,
            headshot: p.headshot,
            teamAbbr,
            label: propMarketLabel(p.market),
            line: p.line,
            overPrice: p.overPrice,
          });
          if (out.length >= 8) break;
        }
        if (out.length >= 8) break;
      }
      return out;
    },
  });

  const featured = featuredQ.data ?? [];
  const refreshing = oddsQ.isFetching || gamesQ.isFetching || featuredQ.isFetching;

  const askCoach = (msg: string) =>
    router.push({
      pathname: "/coach",
      params: { prefill: msg, send: "1", ts: String(Date.now()) },
    });

  const quickActions: { label: string; icon: keyof typeof Feather.glyphMap; color: string; msg: string }[] = [
    { label: "Hot Picks", icon: "zap", color: "#fb923c", msg: "Build me the best parlay" },
    { label: "Easy Money", icon: "dollar-sign", color: "#34d399", msg: "Build me a safe parlay" },
    { label: "Lottery Ticket", icon: "target", color: colors.primary, msg: "Build me a lottery ticket" },
  ];

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView
        contentContainerStyle={{
          paddingTop: insets.top,
          paddingBottom: insets.bottom + 24,
        }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              oddsQ.refetch();
              gamesQ.refetch();
              featuredQ.refetch();
            }}
            tintColor={colors.mutedForeground}
          />
        }
      >
        {/* Logo */}
        <View style={{ paddingHorizontal: 16, marginBottom: 8, alignItems: "center" }}>
          <Image
            source={require("@/assets/images/logo.png")}
            style={{ width: "100%", height: 130, marginTop: -8 }}
            resizeMode="contain"
            accessibilityLabel="Stadium Edge"
          />
        </View>

        {/* Search bar → Player Props search */}
        <Pressable
          onPress={() =>
            router.push({
              pathname: "/props",
              params: featuredEnabled ? { sp: sport } : {},
            })
          }
          style={({ pressed }) => ({
            marginHorizontal: 16,
            flexDirection: "row",
            alignItems: "center",
            gap: 10,
            backgroundColor: colors.card,
            borderWidth: 1,
            borderColor: colors.border,
            borderRadius: 999,
            paddingHorizontal: 16,
            paddingVertical: 13,
            opacity: pressed ? 0.85 : 1,
          })}
        >
          <Feather name="search" size={17} color={colors.mutedForeground} />
          <Text style={{ color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 14 }}>
            Search games, teams, or player props…
          </Text>
        </Pressable>

        {/* Tagline */}
        <Text
          style={{
            color: colors.mutedForeground,
            fontFamily: FONT.body,
            fontSize: 14,
            textAlign: "center",
            lineHeight: 20,
            marginTop: 16,
            marginBottom: 16,
            paddingHorizontal: 32,
          }}
        >
          Your parlay assistant. Build picks, analyze odds, track your slips.
        </Text>

        {/* Build best parlay */}
        <View style={{ alignItems: "center", marginBottom: 18 }}>
          <Pressable
            onPress={() => askCoach("Build me the best parlay")}
            style={({ pressed }) => ({
              flexDirection: "row",
              alignItems: "center",
              gap: 10,
              backgroundColor: colors.primary,
              borderRadius: 999,
              paddingHorizontal: 32,
              paddingVertical: 15,
              opacity: pressed ? 0.9 : 1,
            })}
          >
            <Text style={{ color: "#020617", fontFamily: FONT.display, fontSize: 17 }}>
              Build best parlay
            </Text>
            <Feather name="arrow-right" size={18} color="#020617" />
          </Pressable>
        </View>

        {/* Quick actions */}
        <View style={{ flexDirection: "row", gap: 10, paddingHorizontal: 16, marginBottom: 22 }}>
          {quickActions.map((a) => (
            <Pressable
              key={a.label}
              onPress={() => askCoach(a.msg)}
              style={({ pressed }) => ({
                flex: 1,
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "center",
                gap: 6,
                backgroundColor: colors.card,
                borderWidth: 1,
                borderColor: colors.border,
                borderRadius: 999,
                paddingVertical: 11,
                paddingHorizontal: 6,
                opacity: pressed ? 0.85 : 1,
              })}
            >
              <Feather name={a.icon} size={14} color={a.color} />
              <Text
                style={{ color: colors.foreground, fontFamily: FONT.semibold, fontSize: 12 }}
                numberOfLines={1}
              >
                {a.label}
              </Text>
            </Pressable>
          ))}
        </View>

        {/* Sport selector */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 16, gap: 8, marginBottom: 20 }}
        >
          {SPORTS.map((s) => (
            <Pill key={s.id} label={s.label} active={sport === s.id} onPress={() => setSport(s.id)} />
          ))}
        </ScrollView>

        {/* Featured players */}
        {featuredEnabled && (featuredQ.isLoading || featured.length > 0) ? (
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
              Featured Players
            </Text>
            {featuredQ.isLoading ? (
              <View style={{ paddingHorizontal: 16 }}>
                <Loading label="Loading featured props…" />
              </View>
            ) : (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ paddingHorizontal: 16, gap: 12 }}
              >
                {featured.map((p) => (
                  <Pressable
                    key={p.name}
                    onPress={() =>
                      router.push({ pathname: "/props", params: { q: nickname(p.name), sp: sport } })
                    }
                    style={({ pressed }) => ({
                      width: 150,
                      backgroundColor: colors.card,
                      borderWidth: 1,
                      borderColor: colors.border,
                      borderRadius: colors.radius,
                      paddingVertical: 16,
                      paddingHorizontal: 12,
                      alignItems: "center",
                      gap: 6,
                      opacity: pressed ? 0.85 : 1,
                    })}
                  >
                    <FeaturedAvatar headshot={p.headshot} name={p.name} />
                    <Text
                      style={{ color: colors.foreground, fontFamily: FONT.semibold, fontSize: 14, textAlign: "center" }}
                      numberOfLines={1}
                    >
                      {p.name}
                    </Text>
                    {p.teamAbbr ? (
                      <Text
                        style={{
                          color: colors.mutedForeground,
                          fontFamily: FONT.medium,
                          fontSize: 11,
                          letterSpacing: 0.5,
                          textTransform: "uppercase",
                        }}
                      >
                        {p.teamAbbr}
                      </Text>
                    ) : null}
                    <Text
                      style={{ color: colors.primary, fontFamily: FONT.bold, fontSize: 12, textAlign: "center" }}
                      numberOfLines={1}
                    >
                      o{p.line} {p.label} {formatAmerican(p.overPrice)}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>
            )}
          </View>
        ) : null}

        {/* Live now */}
        {liveGames.length > 0 ? (
          <View style={{ marginBottom: 22 }}>
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                paddingHorizontal: 16,
                marginBottom: 12,
              }}
            >
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flex: 1 }}>
                <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: "#ef4444" }} />
                <Text style={{ color: colors.foreground, fontFamily: FONT.display, fontSize: 18 }}>
                  Live Now
                </Text>
              </View>
              <Text
                style={{
                  color: colors.mutedForeground,
                  fontFamily: FONT.medium,
                  fontSize: 11,
                  letterSpacing: 0.5,
                  textTransform: "uppercase",
                }}
              >
                {liveGames.length} {liveGames.length === 1 ? "Game" : "Games"} · Live
              </Text>
            </View>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ paddingHorizontal: 16, gap: 12 }}
            >
              {liveGames.map((g) => (
                <View
                  key={g.id}
                  style={{
                    width: 270,
                    backgroundColor: colors.card,
                    borderWidth: 1,
                    borderColor: colors.border,
                    borderRadius: colors.radius,
                    padding: 14,
                    gap: 12,
                  }}
                >
                  <View style={{ flexDirection: "row", alignItems: "center" }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flex: 1 }}>
                      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: "#ef4444" }} />
                      <Text
                        style={{
                          color: "#ef4444",
                          fontFamily: FONT.bold,
                          fontSize: 11,
                          letterSpacing: 0.5,
                          textTransform: "uppercase",
                        }}
                        numberOfLines={1}
                      >
                        {g.periodLabel || g.clock || "Live"}
                      </Text>
                    </View>
                    <Text
                      style={{
                        color: colors.mutedForeground,
                        fontFamily: FONT.medium,
                        fontSize: 10,
                        letterSpacing: 0.5,
                        textTransform: "uppercase",
                      }}
                    >
                      {(SPORTS.find((s) => s.id === sport)?.label ?? sport)} · Live
                    </Text>
                  </View>

                  <Pressable
                    onPress={() => router.push({ pathname: "/game/[id]", params: { id: g.id, sport } })}
                    style={{ gap: 8 }}
                  >
                    {[
                      { name: g.awayTeam, abbr: g.awayAbbr, logo: g.awayLogo, score: g.awayScore },
                      { name: g.homeTeam, abbr: g.homeAbbr, logo: g.homeLogo, score: g.homeScore },
                    ].map((t, i) => (
                      <View key={i} style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                        {t.logo ? (
                          <Image source={{ uri: t.logo }} style={{ width: 22, height: 22 }} resizeMode="contain" />
                        ) : (
                          <View style={{ width: 22, height: 22 }} />
                        )}
                        <Text
                          style={{ color: colors.foreground, fontFamily: FONT.semibold, fontSize: 14, flex: 1 }}
                          numberOfLines={1}
                        >
                          {t.name || t.abbr || "—"}
                        </Text>
                        <Text style={{ color: colors.foreground, fontFamily: FONT.bold, fontSize: 16 }}>
                          {t.score ?? 0}
                        </Text>
                      </View>
                    ))}
                  </Pressable>

                  <Pressable
                    onPress={() => askCoach(`Give me your best bets for ${g.awayTeam} @ ${g.homeTeam}`)}
                    style={({ pressed }) => ({
                      backgroundColor: "rgba(34,211,238,0.14)",
                      borderWidth: 1,
                      borderColor: colors.primary,
                      borderRadius: 999,
                      paddingVertical: 10,
                      alignItems: "center",
                      opacity: pressed ? 0.85 : 1,
                    })}
                  >
                    <Text style={{ color: colors.primary, fontFamily: FONT.semibold, fontSize: 12 }}>
                      Build best parlay from this game
                    </Text>
                  </Pressable>
                </View>
              ))}
            </ScrollView>
          </View>
        ) : null}

        {/* Upcoming games */}
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            paddingHorizontal: 16,
            marginBottom: 12,
          }}
        >
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Text
              style={{
                color: colors.foreground,
                fontFamily: FONT.display,
                fontSize: 18,
              }}
            >
              Upcoming
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
                <Text
                  style={{
                    color: colors.primaryForeground,
                    fontFamily: FONT.display,
                    fontSize: 13,
                  }}
                >
                  {games.length}
                </Text>
              </View>
            ) : null}
          </View>
          {games.length > 0 ? (
            <Pressable
              hitSlop={8}
              onPress={() => setShowAllUpcoming((v) => !v)}
              style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
            >
              <Text
                style={{
                  color: colors.primary,
                  fontFamily: FONT.display,
                  fontSize: 14,
                }}
              >
                {showAllUpcoming ? "Show less" : "View all"}
              </Text>
            </Pressable>
          ) : null}
        </View>
        {oddsQ.isLoading ? (
          <View style={{ paddingHorizontal: 16 }}>
            <Loading label="Loading live odds…" />
          </View>
        ) : oddsQ.isError ? (
          <View style={{ paddingHorizontal: 16 }}>
            <ErrorState onRetry={() => oddsQ.refetch()} />
          </View>
        ) : games.length === 0 ? (
          <View style={{ paddingHorizontal: 16 }}>
            <EmptyState
              icon="calendar"
              title="No games in the window"
              subtitle={`No ${SPORTS.find((s) => s.id === sport)?.label ?? sport} games are within the next 48 hours. Try another league.`}
            />
          </View>
        ) : showAllUpcoming ? (
          <View style={{ paddingHorizontal: 16, gap: 12 }}>
            {games.map((g) => {
              const meta = metaMap.get(`${nickname(g.awayTeam)}|${nickname(g.homeTeam)}`.toLowerCase());
              return (
                <GameCard
                  key={g.id}
                  game={g}
                  meta={meta}
                  onPress={() => router.push({ pathname: "/game/[id]", params: { id: g.id, sport } })}
                />
              );
            })}
          </View>
        ) : (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: 16, gap: 12 }}
          >
            {games.map((g) => {
              const meta = metaMap.get(`${nickname(g.awayTeam)}|${nickname(g.homeTeam)}`.toLowerCase());
              return (
                <View key={g.id} style={{ width: 300 }}>
                  <GameCard
                    game={g}
                    meta={meta}
                    onPress={() => router.push({ pathname: "/game/[id]", params: { id: g.id, sport } })}
                  />
                </View>
              );
            })}
          </ScrollView>
        )}
      </ScrollView>
    </View>
  );
}

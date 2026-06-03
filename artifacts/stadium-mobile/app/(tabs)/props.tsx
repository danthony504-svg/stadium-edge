import { Feather } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import { useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import {
  Image,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { PickCard } from "@/components/PickCard";
import { PlayerPropsSheet, type PlayerSheetData } from "@/components/PlayerPropsSheet";
import { useSlipClearance } from "@/components/SlipBar";
import { EmptyState, ErrorState, FONT, Loading, Pill } from "@/components/ui";
import { useBetSlip } from "@/context/BetSlipContext";
import { useColors } from "@/hooks/useColors";
import {
  getGames,
  getOdds,
  getProps,
  isPickable,
  propMarketLabel,
  PROPS_SPORTS,
  type EspnGame,
  type PlayerProp,
} from "@/lib/api";
import { formatAmerican } from "@/lib/format";
import { SPORTS } from "@/lib/sports";

const nickname = (full: string) => (full || "").split(/\s+/).filter(Boolean).pop() || full;

// How many of the soonest pickable games to pull props for. Each game is a
// separate Odds API request; the props route allows 120/min and caches 5min,
// so a dozen is comfortable and keeps the screen responsive.
const MAX_GAMES = 12;

type TeamInfo = {
  homeTeamId: string | null;
  awayTeamId: string | null;
  homeAbbr: string | null;
  awayAbbr: string | null;
};

function buildIdMap(games: EspnGame[]): Map<string, TeamInfo> {
  const map = new Map<string, TeamInfo>();
  for (const g of games) {
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
}

type GameProps = {
  gameLabel: string;
  startsAt: string;
  props: PlayerProp[];
  teams: TeamInfo | null;
};

// Resolve a player's team abbreviation from their playerTeamId against the
// game's home/away team ids. Null when ids don't resolve (honest, no guess).
function teamAbbrFor(prop: PlayerProp, teams: TeamInfo | null): string | null {
  if (!teams || !prop.playerTeamId) return null;
  if (prop.playerTeamId === teams.homeTeamId) return teams.homeAbbr;
  if (prop.playerTeamId === teams.awayTeamId) return teams.awayAbbr;
  return null;
}

// Fetch odds (for the pickable game list + Odds API event ids) and ESPN games
// (for team ids → headshots), then pull player props per game.
async function fetchAllProps(sport: string, signal?: AbortSignal): Promise<GameProps[]> {
  const [odds, games] = await Promise.all([
    getOdds(sport, signal),
    getGames(sport, signal).catch(() => [] as EspnGame[]),
  ]);
  const idMap = buildIdMap(games);
  const pickable = odds
    .filter((g) => isPickable(g.commenceTime))
    .sort((a, b) => Date.parse(a.commenceTime) - Date.parse(b.commenceTime))
    .slice(0, MAX_GAMES);

  let failures = 0;
  const results = await Promise.all(
    pickable.map(async (g): Promise<GameProps> => {
      const ids = idMap.get(`${nickname(g.awayTeam)}|${nickname(g.homeTeam)}`.toLowerCase()) ?? null;
      try {
        const r = await getProps(
          {
            sport,
            eventId: g.id,
            home: g.homeTeam,
            away: g.awayTeam,
            homeTeamId: ids?.homeTeamId,
            awayTeamId: ids?.awayTeamId,
          },
          signal,
        );
        // Main lines only — alternate-ladder rungs would duplicate each player.
        const mains = (r.props ?? []).filter((p) => !p.alt && (p.overPrice != null || p.underPrice != null));
        return { gameLabel: `${g.awayTeam} @ ${g.homeTeam}`, startsAt: g.commenceTime, props: mains, teams: ids };
      } catch {
        failures += 1;
        return { gameLabel: `${g.awayTeam} @ ${g.homeTeam}`, startsAt: g.commenceTime, props: [], teams: ids };
      }
    }),
  );
  // Honest failure surfacing: if there were pickable games but EVERY props
  // request failed, this is a data-unavailable error, not an empty slate —
  // throw so the UI shows the retryable ErrorState instead of "no props".
  if (pickable.length > 0 && failures === pickable.length) {
    throw new Error("All player-prop requests failed");
  }
  return results.filter((r) => r.props.length > 0);
}

function Avatar({ headshot, name }: { headshot: string | null; name: string }) {
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
        width: 38,
        height: 38,
        borderRadius: 19,
        backgroundColor: colors.surface,
        borderWidth: 1,
        borderColor: colors.border,
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
      }}
    >
      {headshot ? (
        <Image source={{ uri: headshot }} style={{ width: 38, height: 38 }} resizeMode="cover" />
      ) : (
        <Text style={{ color: colors.mutedForeground, fontFamily: FONT.bold, fontSize: 13 }}>
          {initials || "?"}
        </Text>
      )}
    </View>
  );
}

function PropChip({
  side,
  line,
  price,
  added,
  onPress,
}: {
  side: "Over" | "Under";
  line: number | null;
  price: number | null;
  added: boolean;
  onPress: () => void;
}) {
  const colors = useColors();
  if (price == null) {
    return (
      <View
        style={{
          flex: 1,
          borderRadius: 10,
          borderWidth: 1,
          borderColor: colors.border,
          backgroundColor: colors.surface,
          paddingVertical: 10,
          alignItems: "center",
          opacity: 0.4,
        }}
      >
        <Text style={{ color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 11 }}>—</Text>
      </View>
    );
  }
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        flex: 1,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: added ? colors.primary : colors.border,
        backgroundColor: added ? "rgba(34,211,238,0.14)" : colors.surface,
        paddingVertical: 8,
        paddingHorizontal: 8,
        alignItems: "center",
        gap: 1,
        opacity: pressed ? 0.85 : 1,
      })}
    >
      <Text
        style={{
          color: added ? colors.primary : colors.mutedForeground,
          fontFamily: FONT.bold,
          fontSize: 10,
          letterSpacing: 0.5,
          textTransform: "uppercase",
        }}
      >
        {side}
        {line != null ? ` ${line}` : ""}
      </Text>
      <Text
        style={{
          color: added ? colors.primary : colors.foreground,
          fontFamily: FONT.bold,
          fontSize: 14,
        }}
      >
        {formatAmerican(price)}
      </Text>
    </Pressable>
  );
}

function PropRow({
  prop,
  gameLabel,
  sport,
  onOpen,
}: {
  prop: PlayerProp;
  gameLabel: string;
  sport: string;
  onOpen: () => void;
}) {
  const colors = useColors();
  const { addLeg, hasLeg } = useBetSlip();
  const label = propMarketLabel(prop.market);
  const lineTxt = prop.line != null ? ` ${prop.line}` : "";

  // Always include the side token (matches the web app's pick format), even for
  // yes/no markets with no line (e.g. Anytime TD) — lineTxt is "" in that case.
  const overPick = `${prop.player} Over${lineTxt} ${label}`;
  const underPick = `${prop.player} Under${lineTxt} ${label}`;
  const overAdded = hasLeg(gameLabel, "Player Prop", overPick);
  const underAdded = hasLeg(gameLabel, "Player Prop", underPick);

  const add = (pick: string, price: number) => {
    const ok = addLeg({ game: gameLabel, market: "Player Prop", pick, odds: price, sport });
    Haptics.impactAsync(ok ? Haptics.ImpactFeedbackStyle.Medium : Haptics.ImpactFeedbackStyle.Light);
  };

  return (
    <View
      style={{
        backgroundColor: colors.card,
        borderColor: colors.border,
        borderWidth: 1,
        borderRadius: colors.radius,
        padding: 12,
        gap: 10,
      }}
    >
      <Pressable
        onPress={onOpen}
        style={({ pressed }) => ({
          flexDirection: "row",
          alignItems: "center",
          gap: 10,
          opacity: pressed ? 0.7 : 1,
        })}
      >
        <Avatar headshot={prop.headshot} name={prop.player} />
        <View style={{ flex: 1 }}>
          <Text style={{ color: colors.foreground, fontFamily: FONT.semibold, fontSize: 14 }} numberOfLines={1}>
            {prop.player}
          </Text>
          <Text style={{ color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 12, marginTop: 1 }}>
            {label}
            {prop.line != null ? ` · ${prop.line}` : ""}
          </Text>
        </View>
        <Feather name="bar-chart-2" size={16} color={colors.primary} />
      </Pressable>
      <View style={{ flexDirection: "row", gap: 8 }}>
        <PropChip
          side="Over"
          line={prop.line}
          price={prop.overPrice}
          added={overAdded}
          onPress={() => prop.overPrice != null && add(overPick, prop.overPrice)}
        />
        <PropChip
          side="Under"
          line={prop.line}
          price={prop.underPrice}
          added={underAdded}
          onPress={() => prop.underPrice != null && add(underPick, prop.underPrice)}
        />
      </View>
    </View>
  );
}

// Compact search result: one tappable row per player (name + how many markets
// they have in this game). Tapping opens the full props sheet — we don't dump
// every prop line inline. Used only while a search query is active.
function PlayerResultRow({
  prop,
  marketCount,
  onOpen,
}: {
  prop: PlayerProp;
  marketCount: number;
  onOpen: () => void;
}) {
  const colors = useColors();
  return (
    <Pressable
      onPress={onOpen}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        backgroundColor: colors.card,
        borderColor: colors.border,
        borderWidth: 1,
        borderRadius: colors.radius,
        padding: 12,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <Avatar headshot={prop.headshot} name={prop.player} />
      <View style={{ flex: 1 }}>
        <Text style={{ color: colors.foreground, fontFamily: FONT.semibold, fontSize: 14 }} numberOfLines={1}>
          {prop.player}
        </Text>
        <Text style={{ color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 12, marginTop: 1 }}>
          {marketCount} market{marketCount === 1 ? "" : "s"} · tap to view
        </Text>
      </View>
      <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
    </Pressable>
  );
}

export default function PropsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const slipClearance = useSlipClearance();
  const { aiPicks } = useBetSlip();
  const aiProps = useMemo(() => aiPicks.filter((p) => p.isProp), [aiPicks]);
  const params = useLocalSearchParams<{ q?: string; sp?: string }>();
  const [sport, setSport] = useState(
    params.sp && PROPS_SPORTS.includes(String(params.sp)) ? String(params.sp) : PROPS_SPORTS[0],
  );
  const [query, setQuery] = useState(params.q ? String(params.q) : "");
  const [sheet, setSheet] = useState<PlayerSheetData | null>(null);

  // Open the player-props detail seeded to the tapped market, gathering every
  // market that player has in this game (for the metric pills + lines list).
  const openSheet = (g: GameProps, prop: PlayerProp) => {
    const playerProps = g.props.filter((p) => p.player === prop.player);
    setSheet({
      player: prop.player,
      athleteId: prop.athleteId ?? null,
      headshot: prop.headshot ?? null,
      playerTeamId: prop.playerTeamId ?? null,
      teamAbbr: teamAbbrFor(prop, g.teams),
      sport,
      gameLabel: g.gameLabel,
      initialMarket: prop.market,
      props: playerProps,
    });
  };

  // When navigated to with a player/sport (e.g. from the Home featured row),
  // sync the search + sport selector to that target.
  useEffect(() => {
    if (params.sp && PROPS_SPORTS.includes(String(params.sp))) setSport(String(params.sp));
    if (params.q != null) setQuery(String(params.q));
  }, [params.q, params.sp]);

  const propsSports = useMemo(() => SPORTS.filter((s) => PROPS_SPORTS.includes(s.id)), []);

  const propsQ = useQuery({
    queryKey: ["props-all", sport],
    queryFn: ({ signal }) => fetchAllProps(sport, signal),
    staleTime: 2 * 60_000,
  });

  const filtered = useMemo(() => {
    const data = propsQ.data ?? [];
    const q = query.trim().toLowerCase();
    if (!q) return data;
    return data
      .map((g) => ({
        ...g,
        props: g.props.filter((p) => p.player.toLowerCase().includes(q)),
      }))
      .filter((g) => g.props.length > 0);
  }, [propsQ.data, query]);

  const totalProps = useMemo(
    () => filtered.reduce((n, g) => n + g.props.length, 0),
    [filtered],
  );

  // While searching, collapse each game's matches to one row per player (with a
  // representative prop to seed the sheet + a market count), instead of listing
  // every prop line.
  const playerResults = useMemo(() => {
    return filtered.map((g) => {
      const byPlayer = new Map<string, { prop: PlayerProp; count: number }>();
      for (const p of g.props) {
        const existing = byPlayer.get(p.player);
        if (existing) existing.count += 1;
        else byPlayer.set(p.player, { prop: p, count: 1 });
      }
      return { g, players: Array.from(byPlayer.values()) };
    });
  }, [filtered]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{
          paddingTop: insets.top + 8,
          paddingBottom: insets.bottom + 24 + slipClearance,
        }}
        refreshControl={
          <RefreshControl
            refreshing={propsQ.isFetching}
            onRefresh={() => propsQ.refetch()}
            tintColor={colors.mutedForeground}
          />
        }
      >
        {/* Logo — matches the Home logo's size and position */}
        <View style={{ paddingHorizontal: 16, marginBottom: 8, alignItems: "center" }}>
          <Image
            source={require("@/assets/images/logo.png")}
            style={{ width: "100%", height: 130, marginTop: -8 }}
            resizeMode="contain"
            accessibilityLabel="Stadium Edge"
          />
        </View>

        {/* Search */}
        <View style={{ paddingHorizontal: 16, marginBottom: 14 }}>
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 8,
              backgroundColor: colors.card,
              borderWidth: 1,
              borderColor: colors.border,
              borderRadius: 999,
              paddingHorizontal: 14,
              paddingVertical: 10,
            }}
          >
            <Feather name="search" size={16} color={colors.mutedForeground} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Search players"
              placeholderTextColor={colors.mutedForeground}
              style={{ flex: 1, color: colors.foreground, fontFamily: FONT.medium, fontSize: 14, padding: 0 }}
              autoCorrect={false}
              autoCapitalize="none"
            />
            {query.length > 0 ? (
              <Pressable onPress={() => setQuery("")} hitSlop={8}>
                <Feather name="x" size={16} color={colors.mutedForeground} />
              </Pressable>
            ) : null}
          </View>
        </View>

        {/* AI-recommended props (pinned from the AI Coach's latest parlay) */}
        {aiProps.length > 0 ? (
          <View style={{ paddingHorizontal: 16, marginBottom: 18 }}>
            <Text
              style={{
                color: colors.primary,
                fontFamily: FONT.display,
                fontSize: 13,
                letterSpacing: 0.5,
                marginBottom: 8,
              }}
            >
              ★ AI RECOMMENDED
            </Text>
            {aiProps.map((p, i) => (
              <PickCard key={`${p.game}|${p.pick}|${i}`} pick={p} />
            ))}
          </View>
        ) : null}

        {/* Sport selector */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 16, gap: 8, marginBottom: 16 }}
        >
          {propsSports.map((s) => (
            <Pill key={s.id} label={s.label} active={sport === s.id} onPress={() => setSport(s.id)} />
          ))}
        </ScrollView>

        {/* Props list */}
        <View style={{ paddingHorizontal: 16, gap: 16 }}>
          {propsQ.isLoading ? (
            <Loading label="Loading player props…" />
          ) : propsQ.isError ? (
            <ErrorState onRetry={() => propsQ.refetch()} />
          ) : totalProps === 0 ? (
            <EmptyState
              icon={query ? "search" : "user"}
              title={query ? "No matching players" : "No props in the window"}
              subtitle={
                query
                  ? `No ${SPORTS.find((s) => s.id === sport)?.label ?? sport} players match “${query}”.`
                  : `No player props are posted for ${SPORTS.find((s) => s.id === sport)?.label ?? sport} games in the next 48 hours. Try another league.`
              }
            />
          ) : query.trim() ? (
            // Searching → compact: one tappable row per player, not every prop.
            playerResults.map(({ g, players }, gi) => (
              <View key={`${g.gameLabel}-${gi}`} style={{ gap: 10 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <Text style={{ color: colors.foreground, fontFamily: FONT.displaySemi, fontSize: 15, flex: 1 }} numberOfLines={1}>
                    {g.gameLabel}
                  </Text>
                  <Text style={{ color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 11 }}>
                    {new Date(g.startsAt).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" })}
                  </Text>
                </View>
                {players.map(({ prop, count }) => (
                  <PlayerResultRow
                    key={`${g.gameLabel}-${prop.player}`}
                    prop={prop}
                    marketCount={count}
                    onOpen={() => openSheet(g, prop)}
                  />
                ))}
              </View>
            ))
          ) : (
            filtered.map((g, gi) => (
              <View key={`${g.gameLabel}-${gi}`} style={{ gap: 10 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <Text style={{ color: colors.foreground, fontFamily: FONT.displaySemi, fontSize: 15, flex: 1 }} numberOfLines={1}>
                    {g.gameLabel}
                  </Text>
                  <Text style={{ color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 11 }}>
                    {new Date(g.startsAt).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" })}
                  </Text>
                </View>
                {g.props.map((p, idx) => (
                  <PropRow
                    key={`${p.player}-${p.market}-${p.line}-${idx}`}
                    prop={p}
                    gameLabel={g.gameLabel}
                    sport={sport}
                    onOpen={() => openSheet(g, p)}
                  />
                ))}
              </View>
            ))
          )}
        </View>
      </ScrollView>
      <PlayerPropsSheet data={sheet} onClose={() => setSheet(null)} />
    </View>
  );
}

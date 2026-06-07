import { Feather } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import {
  FlatList,
  Image,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { PickCard, type ParsedPick } from "@/components/PickCard";
import { PlayerPropsSheet, type PlayerSheetData } from "@/components/PlayerPropsSheet";
import { PropCard } from "@/components/PropCard";
import { useSlipClearance } from "@/components/SlipBar";
import { EmptyState, ErrorState, FONT, Loading, Pill } from "@/components/ui";
import { useColors } from "@/hooks/useColors";
import {
  getGames,
  getOdds,
  getProps,
  propMarketLabel,
  PROPS_SPORTS,
  type EspnGame,
  type PlayerProp,
} from "@/lib/api";
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
  // Main lines only — one row per (player, market) for the list/search/count.
  props: PlayerProp[];
  // Mains + alternate-ladder rungs — used by the per-row "alt lines" expander
  // and passed to the props sheet so it can price any real rung.
  allProps: PlayerProp[];
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

// Pick the side to recommend for a prop from its REAL posted prices only.
// When both sides are priced, take the higher American number (the shorter-juice
// / better-return side) — a transparent rule, never a fabricated lean. Yes/no
// markets (line null) only carry an Over/"Yes" price, so that side is used.
// Returns null when no real price exists (nothing to honestly recommend).
function recommendSide(p: PlayerProp): { side: "Over" | "Under"; price: number } | null {
  const o = p.overPrice;
  const u = p.underPrice;
  if (o != null && u != null) return o >= u ? { side: "Over", price: o } : { side: "Under", price: u };
  if (o != null) return { side: "Over", price: o };
  if (u != null) return { side: "Under", price: u };
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
  // Soccer (World Cup) is a tournament: books post real player props days before
  // kickoff, but matches cluster outside the usual 48h pickable window. Widen the
  // look-ahead for soccer so those real props surface; other sports keep 48h.
  const HORIZON_H = sport === "soccer" ? 14 * 24 : 48;
  const now = Date.now();
  const inWindow = (iso?: string | null): boolean => {
    if (!iso) return false;
    const t = Date.parse(iso);
    if (Number.isNaN(t)) return false;
    return t > now - 4 * 3600_000 && t < now + HORIZON_H * 3600_000;
  };
  const pickable = odds
    .filter((g) => inWindow(g.commenceTime))
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
        // Keep every priced line. Mains drive the list rows (one per player +
        // market); the full set (incl. alternate rungs) feeds the per-row alt
        // expander and the props sheet.
        const all = (r.props ?? []).filter((p) => p.overPrice != null || p.underPrice != null);
        const mains = all.filter((p) => !p.alt);
        return { gameLabel: `${g.awayTeam} @ ${g.homeTeam}`, startsAt: g.commenceTime, props: mains, allProps: all, teams: ids };
      } catch {
        failures += 1;
        return { gameLabel: `${g.awayTeam} @ ${g.homeTeam}`, startsAt: g.commenceTime, props: [], allProps: [], teams: ids };
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
  const params = useLocalSearchParams<{ q?: string; sp?: string }>();
  const [sport, setSport] = useState(
    params.sp && PROPS_SPORTS.includes(String(params.sp)) ? String(params.sp) : PROPS_SPORTS[0],
  );
  const [query, setQuery] = useState(params.q ? String(params.q) : "");
  const [sheet, setSheet] = useState<PlayerSheetData | null>(null);

  // Open the player-props detail seeded to the tapped market, gathering every
  // market that player has in this game (for the metric pills + lines list).
  const openSheet = (g: GameProps, prop: PlayerProp) => {
    const playerProps = g.allProps.filter((p) => p.player === prop.player);
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

  // A varied, rotating set of recommended picks built ONLY from the real props
  // feed for the selected sport — independent of the AI Coach's chat parlay. Each
  // card uses a real player, real posted line, and a real Over/Under price (side
  // chosen by recommendSide); no fabricated edge note. Shuffled per data load so
  // the list refreshes (and re-rolls on pull-to-refresh). Deduped to one main
  // line per player, spread across games, capped small.
  const recommended = useMemo<ParsedPick[]>(() => {
    const data = propsQ.data ?? [];
    const candidates: { pick: ParsedPick; player: string }[] = [];
    for (const g of data) {
      for (const p of g.props) {
        if (p.alt) continue; // main lines only
        const sel = recommendSide(p);
        if (!sel) continue;
        // Yes/no markets (no line, e.g. anytime goalscorer/TD) are only meaningful
        // on the Over/"Yes" side, and the canonical pick string drops the side
        // token — so force the Yes side here and require its price, keeping the
        // displayed odds consistent with the label (never an ambiguous "Under").
        let side = sel.side;
        let price = sel.price;
        if (p.line == null) {
          if (p.overPrice == null) continue;
          side = "Over";
          price = p.overPrice;
        }
        const label = propMarketLabel(p.market);
        const pick =
          p.line != null
            ? `${p.player} ${side} ${p.line} ${label}`
            : `${p.player} ${label}`;
        candidates.push({
          player: p.player,
          pick: {
            game: g.gameLabel,
            market: label,
            pick,
            odds: price,
            sport,
            isProp: true,
            startsAt: g.startsAt,
            headshot: p.headshot ?? null,
            teamAbbr: teamAbbrFor(p, g.teams),
          },
        });
      }
    }
    // Fisher–Yates shuffle for variety.
    for (let i = candidates.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
    }
    const seen = new Set<string>();
    const out: ParsedPick[] = [];
    for (const c of candidates) {
      const key = c.player.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(c.pick);
      if (out.length >= 6) break;
    }
    return out;
  }, [propsQ.data, sport]);

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

  // Flatten the grouped props into a single virtualized list. Each game becomes
  // a header row followed by its cards (or compact player rows while searching).
  // Virtualizing matters here: every PropCard fetches the player's real game
  // log, so only mounting the on-screen cards keeps those fetches bounded.
  type ListRow =
    | { kind: "gameHeader"; id: string; gameLabel: string; startsAt: string }
    | { kind: "card"; id: string; g: GameProps; prop: PlayerProp; alts: PlayerProp[] }
    | { kind: "searchPlayer"; id: string; g: GameProps; prop: PlayerProp; count: number };

  const listData = useMemo<ListRow[]>(() => {
    const rows: ListRow[] = [];
    const searching = !!query.trim();
    if (searching) {
      for (const { g, players } of playerResults) {
        if (players.length === 0) continue;
        // Key on startsAt too: same-label rematches/doubleheaders must not collide.
        rows.push({ kind: "gameHeader", id: `h-${g.gameLabel}-${g.startsAt}`, gameLabel: g.gameLabel, startsAt: g.startsAt });
        for (const { prop, count } of players) {
          rows.push({ kind: "searchPlayer", id: `s-${g.gameLabel}-${g.startsAt}-${prop.player}`, g, prop, count });
        }
      }
    } else {
      for (const g of filtered) {
        rows.push({ kind: "gameHeader", id: `h-${g.gameLabel}-${g.startsAt}`, gameLabel: g.gameLabel, startsAt: g.startsAt });
        g.props.forEach((p, idx) => {
          const alts = g.allProps
            .filter((a) => a.alt && a.player === p.player && a.market === p.market)
            .sort((a, b) => (a.line ?? 0) - (b.line ?? 0));
          rows.push({ kind: "card", id: `c-${g.gameLabel}-${g.startsAt}-${p.player}-${p.market}-${p.line}-${idx}`, g, prop: p, alts });
        });
      }
    }
    return rows;
  }, [query, playerResults, filtered]);

  // Header chrome (logo, search, recommended, sport pills) rendered ABOVE the
  // list. Passed as an element (not an inline component) so the search TextInput
  // doesn't remount/lose focus on each keystroke.
  const header = (
    <View>
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

      {/* AI-recommended props — a varied set built from the real props feed,
          independent of the AI Coach's chat parlay. Horizontal swipe list,
          hidden while searching. */}
      {!query.trim() && recommended.length > 0 ? (
        <View style={{ marginBottom: 18 }}>
          <Text
            style={{
              color: colors.primary,
              fontFamily: FONT.display,
              fontSize: 13,
              letterSpacing: 0.5,
              marginBottom: 8,
              paddingHorizontal: 16,
            }}
          >
            ★ AI RECOMMENDED
          </Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: 16, gap: 12 }}
          >
            {recommended.map((p, i) => (
              <View key={`${p.game}|${p.pick}|${i}`} style={{ width: 290 }}>
                <PickCard pick={p} />
              </View>
            ))}
          </ScrollView>
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
    </View>
  );

  const empty = propsQ.isLoading ? (
    <View style={{ paddingHorizontal: 16 }}>
      <Loading label="Loading player props…" />
    </View>
  ) : propsQ.isError ? (
    <View style={{ paddingHorizontal: 16 }}>
      <ErrorState onRetry={() => propsQ.refetch()} />
    </View>
  ) : (
    <View style={{ paddingHorizontal: 16 }}>
      <EmptyState
        icon={query ? "search" : "user"}
        title={query ? "No matching players" : "No props in the window"}
        subtitle={
          query
            ? `No ${SPORTS.find((s) => s.id === sport)?.label ?? sport} players match “${query}”.`
            : `No player props are posted for ${SPORTS.find((s) => s.id === sport)?.label ?? sport} games in the ${sport === "soccer" ? "next 2 weeks" : "next 48 hours"}. Try another league.`
        }
      />
    </View>
  );

  const renderItem = ({ item }: { item: ListRow }) => {
    if (item.kind === "gameHeader") {
      return (
        <View
          style={{
            paddingHorizontal: 16,
            marginTop: 14,
            marginBottom: 8,
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
          }}
        >
          <Text style={{ color: colors.foreground, fontFamily: FONT.displaySemi, fontSize: 15, flex: 1 }} numberOfLines={1}>
            {item.gameLabel}
          </Text>
          <Text style={{ color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 11 }}>
            {new Date(item.startsAt).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" })}
          </Text>
        </View>
      );
    }
    if (item.kind === "searchPlayer") {
      return (
        <View style={{ paddingHorizontal: 16, marginBottom: 10 }}>
          <PlayerResultRow prop={item.prop} marketCount={item.count} onOpen={() => openSheet(item.g, item.prop)} />
        </View>
      );
    }
    return (
      <View style={{ paddingHorizontal: 16, marginBottom: 12 }}>
        <PropCard
          prop={item.prop}
          alts={item.alts}
          gameLabel={item.g.gameLabel}
          startsAt={item.g.startsAt}
          sport={sport}
          onOpen={() => openSheet(item.g, item.prop)}
        />
      </View>
    );
  };

  const showList = !propsQ.isLoading && !propsQ.isError && totalProps > 0;

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <FlatList
        data={showList ? listData : []}
        keyExtractor={(it) => it.id}
        renderItem={renderItem}
        ListHeaderComponent={header}
        ListEmptyComponent={empty}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{
          paddingTop: insets.top + 8,
          paddingBottom: insets.bottom + 24 + slipClearance,
        }}
        initialNumToRender={6}
        maxToRenderPerBatch={6}
        windowSize={7}
        removeClippedSubviews
        refreshControl={
          <RefreshControl
            refreshing={propsQ.isFetching}
            onRefresh={() => propsQ.refetch()}
            tintColor={colors.mutedForeground}
          />
        }
      />
      <PlayerPropsSheet data={sheet} onClose={() => setSheet(null)} />
    </View>
  );
}

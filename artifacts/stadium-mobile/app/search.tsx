import { Feather } from "@expo/vector-icons";
import { useQueries, useQuery } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type { ParsedPick } from "@/components/PickCard";
import { Avatar } from "@/components/PlayerPropRow";
import { PlayerPropsSheet, type PlayerSheetData } from "@/components/PlayerPropsSheet";
import { TeamPropsSheet, type TeamSheetData } from "@/components/TeamPropsSheet";
import { EmptyState, FONT, Loading } from "@/components/ui";
import { useColors } from "@/hooks/useColors";
import {
  getOdds,
  isPickable,
  propMarketLabel,
  PROPS_SPORTS,
  searchPlayer,
  type OddsGame,
  type PlayerProp,
  type PlayerSearchResult,
} from "@/lib/api";
import { recommendSide } from "@/lib/propGrade";
import { gameMatchesQuery } from "@/lib/gameSearchMatch";
import {
  fetchAllProps,
  teamAbbrFor,
  type GameProps,
} from "@/lib/propsSearchPool";
import { clearRecentSearches, loadRecentSearches, rememberRecentSearch } from "@/lib/recentSearches";
import { SPORTS } from "@/lib/sports";

const SEARCH_DEBOUNCE_MS = 250;
const INITIAL_GAMES = 8;
const DEFAULT_SEARCH_MARKET: Record<string, string> = {
  nba: "player_points",
  wnba: "player_points",
  ncaab: "player_points",
  mlb: "batter_hits",
  nhl: "player_goals",
};

function SearchSectionLabel({ children }: { children: React.ReactNode }) {
  const colors = useColors();
  return (
    <Text
      style={{
        color: colors.mutedForeground,
        fontFamily: FONT.bold,
        fontSize: 11,
        letterSpacing: 1,
        textTransform: "uppercase",
        marginTop: 8,
      }}
    >
      {children}
    </Text>
  );
}

function PlayerResultRow({
  prop,
  subtitle,
  onOpen,
}: {
  prop: PlayerProp;
  subtitle: string;
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
        <Text style={{ color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 12, marginTop: 1 }} numberOfLines={1}>
          {subtitle}
        </Text>
      </View>
      <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
    </Pressable>
  );
}

function SearchedPlayerRow({ result, onOpen }: { result: PlayerSearchResult; onOpen: () => void }) {
  const colors = useColors();
  const sportLabel = SPORTS.find((s) => s.id === result.sport)?.label ?? result.sport.toUpperCase();
  const sub = [result.team, sportLabel].filter(Boolean).join(" · ");
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
      <Avatar headshot={result.headshot} name={result.name} />
      <View style={{ flex: 1 }}>
        <Text style={{ color: colors.foreground, fontFamily: FONT.semibold, fontSize: 14 }} numberOfLines={1}>
          {result.name}
        </Text>
        <Text style={{ color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 12, marginTop: 1 }} numberOfLines={1}>
          {sub ? `${sub} · ` : ""}stats and game log
        </Text>
      </View>
      <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
    </Pressable>
  );
}

function TeamResultRow({
  team,
  opp,
  isHome,
  subtitle,
  onOpen,
}: {
  team: string;
  opp: string;
  isHome: boolean;
  subtitle?: string;
  onOpen: () => void;
}) {
  const colors = useColors();
  const code = (team.split(/\s+/).filter(Boolean).pop() ?? team).slice(0, 3).toUpperCase();
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
        }}
      >
        <Text style={{ color: colors.mutedForeground, fontFamily: FONT.bold, fontSize: 12 }}>{code}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ color: colors.foreground, fontFamily: FONT.semibold, fontSize: 14 }} numberOfLines={1}>
          {team}
        </Text>
        <Text style={{ color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 12, marginTop: 1 }} numberOfLines={1}>
          {subtitle ?? `${isHome ? "Home" : "Away"} vs ${opp.split(/\s+/).filter(Boolean).pop() ?? opp} · tap to view`}
        </Text>
      </View>
      <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
    </Pressable>
  );
}

function GameResultRow({
  game,
  sport,
  onOpen,
}: {
  game: OddsGame;
  sport: string;
  onOpen: () => void;
}) {
  const colors = useColors();
  const label = `${game.awayTeam} @ ${game.homeTeam}`;
  const when = new Date(game.commenceTime).toLocaleString([], {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  });
  const sportLabel = SPORTS.find((s) => s.id === sport)?.label ?? sport.toUpperCase();
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
        }}
      >
        <Feather name="calendar" size={16} color={colors.primary} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ color: colors.foreground, fontFamily: FONT.semibold, fontSize: 14 }} numberOfLines={2}>
          {label}
        </Text>
        <Text style={{ color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 12, marginTop: 1 }} numberOfLines={1}>
          {sportLabel} · {when}
        </Text>
      </View>
      <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
    </Pressable>
  );
}

function PropResultRow({
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
  const label = propMarketLabel(prop.market);
  const sel = recommendSide(prop);
  const lineTxt = prop.line != null ? `${sel?.side ?? "Over"} ${prop.line} ` : "";
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
          {prop.player} {lineTxt}
          {label}
        </Text>
        <Text style={{ color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 12, marginTop: 1 }} numberOfLines={1}>
          {gameLabel} · {SPORTS.find((s) => s.id === sport)?.label ?? sport}
        </Text>
      </View>
      <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
    </Pressable>
  );
}

export default function SearchScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ sp?: string }>();
  const inputRef = useRef<TextInput>(null);

  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [recent, setRecent] = useState<string[]>([]);
  const [sheet, setSheet] = useState<PlayerSheetData | null>(null);
  const [teamSheet, setTeamSheet] = useState<TeamSheetData | null>(null);

  useEffect(() => {
    const id = setTimeout(() => setDebouncedQuery(query), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [query]);

  useEffect(() => {
    void loadRecentSearches().then(setRecent);
    const t = setTimeout(() => inputRef.current?.focus(), 100);
    return () => clearTimeout(t);
  }, []);

  const searching = query.trim().length > 0;
  const fetchEnabled = debouncedQuery.trim().length > 0;
  const debouncedQ = debouncedQuery.trim().toLowerCase();

  const propsSports = useMemo(() => SPORTS.filter((s) => PROPS_SPORTS.includes(s.id)), []);

  const sportQueries = useQueries({
    queries: propsSports.map((s) => ({
      queryKey: ["search-props", s.id, INITIAL_GAMES],
      queryFn: ({ signal }: { signal?: AbortSignal }) => fetchAllProps(s.id, INITIAL_GAMES, signal),
      staleTime: 2 * 60_000,
      gcTime: 30 * 60_000,
      enabled: fetchEnabled,
    })),
  });

  const oddsQueries = useQueries({
    queries: propsSports.map((s) => ({
      queryKey: ["search-odds", s.id],
      queryFn: ({ signal }: { signal?: AbortSignal }) => getOdds(s.id, signal),
      staleTime: 5 * 60_000,
      gcTime: 30 * 60_000,
      enabled: fetchEnabled,
    })),
  });

  const dataStamp = sportQueries.map((q) => q.dataUpdatedAt).join(",");
  const searchPool = useMemo(
    () => sportQueries.flatMap((q) => q.data?.games ?? []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dataStamp],
  );

  const searchBusy =
    fetchEnabled &&
    (sportQueries.some((q) => q.isFetching) || oddsQueries.some((q) => q.isFetching));

  const playerSearchQ = useQuery({
    queryKey: ["home-search-player", debouncedQ],
    queryFn: ({ signal }: { signal?: AbortSignal }) => searchPlayer(debouncedQuery.trim(), signal),
    enabled: fetchEnabled && debouncedQuery.trim().length >= 2,
    staleTime: 10 * 60_000,
    gcTime: 30 * 60_000,
  });

  const rememberQuery = useCallback(async (q: string) => {
    const next = await rememberRecentSearch(q);
    setRecent(next);
  }, []);

  const openSheet = useCallback((g: GameProps, prop: PlayerProp) => {
    const playerProps = g.allProps.filter((p) => p.player === prop.player);
    setSheet({
      player: prop.player,
      athleteId: prop.athleteId ?? null,
      headshot: prop.headshot ?? null,
      playerTeamId: prop.playerTeamId ?? null,
      teamAbbr: teamAbbrFor(prop, g.teams),
      sport: g.sport,
      gameLabel: g.gameLabel,
      startsAt: g.startsAt,
      initialMarket: prop.market,
      props: playerProps,
    });
  }, []);

  const openSearchedPlayer = useCallback((r: PlayerSearchResult) => {
    setSheet({
      player: r.name,
      athleteId: r.athleteId,
      headshot: r.headshot,
      playerTeamId: null,
      teamAbbr: r.team,
      sport: r.sport,
      gameLabel: "",
      startsAt: "",
      initialMarket: DEFAULT_SEARCH_MARKET[r.sport] ?? "",
      props: [],
    });
  }, []);

  const openTeam = useCallback(
    (t: {
      team: string;
      opp: string;
      isHome: boolean;
      sport: string;
      gameLabel: string;
      startsAt: string;
    }) => {
      setTeamSheet({
        team: t.team,
        opp: t.opp,
        isHome: t.isHome,
        sport: t.sport,
        gameLabel: t.gameLabel,
        startsAt: t.startsAt,
      });
    },
    [],
  );

  const openPropDetail = useCallback(
    (g: GameProps, prop: PlayerProp) => {
      const sel = recommendSide(prop);
      if (!sel) return;
      const label = propMarketLabel(prop.market);
      const pick =
        prop.line != null ? `${prop.player} ${sel.side} ${prop.line} ${label}` : `${prop.player} ${label}`;
      const p: ParsedPick = {
        game: g.gameLabel,
        market: label,
        pick,
        odds: sel.price,
        sport: g.sport,
        isProp: true,
        startsAt: g.startsAt,
        headshot: prop.headshot ?? null,
        teamAbbr: teamAbbrFor(prop, g.teams),
        athleteId: prop.athleteId ?? null,
        player: prop.player,
        propMarketKey: prop.market,
        propLine: prop.line ?? null,
        propSide: sel.side,
      };
      router.push({
        pathname: "/prop/[id]",
        params: {
          id: p.athleteId ?? p.player ?? "prop",
          player: p.player ?? "",
          marketKey: p.propMarketKey ?? "",
          marketLabel: p.market,
          line: p.propLine != null ? String(p.propLine) : "",
          side: p.propSide ?? "",
          odds: String(p.odds),
          game: p.game,
          sport: p.sport ?? params.sp ?? PROPS_SPORTS[0],
          athleteId: p.athleteId ?? "",
          headshot: p.headshot ?? "",
          startsAt: p.startsAt ?? "",
          pick: p.pick,
        },
      });
    },
    [params.sp, router],
  );

  const openGame = useCallback(
    (sport: string, gameId: string) => {
      router.push({ pathname: "/game/[id]", params: { id: gameId, sport } });
    },
    [router],
  );

  const playerResults = useMemo(() => {
    if (!debouncedQ) return [] as { g: GameProps; players: { prop: PlayerProp; count: number }[] }[];
    return searchPool
      .map((g) => {
        const byPlayer = new Map<string, { prop: PlayerProp; count: number }>();
        for (const p of g.props) {
          if (!p.player.toLowerCase().includes(debouncedQ)) continue;
          const existing = byPlayer.get(p.player);
          if (existing) existing.count += 1;
          else byPlayer.set(p.player, { prop: p, count: 1 });
        }
        return { g, players: Array.from(byPlayer.values()) };
      })
      .filter((r) => r.players.length > 0);
  }, [searchPool, debouncedQ]);

  const teamResults = useMemo(() => {
    type TeamHit = {
      team: string;
      opp: string;
      isHome: boolean;
      sport: string;
      gameLabel: string;
      startsAt: string;
    };
    if (!debouncedQ) return [] as TeamHit[];
    const seen = new Set<string>();
    const out: TeamHit[] = [];
    for (const g of searchPool) {
      const [away, home] = g.gameLabel.split(" @ ");
      if (!away || !home) continue;
      const sides = [
        { team: away.trim(), opp: home.trim(), isHome: false },
        { team: home.trim(), opp: away.trim(), isHome: true },
      ];
      for (const s of sides) {
        if (!s.team.toLowerCase().includes(debouncedQ)) continue;
        const k = `${g.sport}|${s.team.toLowerCase()}`;
        if (seen.has(k)) continue;
        seen.add(k);
        out.push({ ...s, sport: g.sport, gameLabel: g.gameLabel, startsAt: g.startsAt });
      }
    }
    return out;
  }, [searchPool, debouncedQ]);

  const gameResults = useMemo(() => {
    if (!debouncedQ) return [] as { sport: string; game: OddsGame }[];
    const seen = new Set<string>();
    const out: { sport: string; game: OddsGame }[] = [];
    propsSports.forEach((s, idx) => {
      const odds = oddsQueries[idx]?.data ?? [];
      for (const g of odds) {
        if (!isPickable(g.commenceTime)) continue;
        const label = `${g.awayTeam} @ ${g.homeTeam}`;
        if (!gameMatchesQuery(label, debouncedQuery)) continue;
        const key = `${s.id}-${g.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ sport: s.id, game: g });
      }
    });
    return out.sort((a, b) => Date.parse(a.game.commenceTime) - Date.parse(b.game.commenceTime));
  }, [debouncedQ, debouncedQuery, oddsQueries, propsSports]);

  const propResults = useMemo(() => {
    if (!debouncedQ) return [] as { g: GameProps; prop: PlayerProp }[];
    const out: { g: GameProps; prop: PlayerProp }[] = [];
    const seen = new Set<string>();
    for (const g of searchPool) {
      for (const p of g.props) {
        const marketLabel = propMarketLabel(p.market).toLowerCase();
        const marketKey = p.market.toLowerCase();
        const playerHit = p.player.toLowerCase().includes(debouncedQ);
        const marketHit = marketLabel.includes(debouncedQ) || marketKey.includes(debouncedQ);
        if (!marketHit && playerHit) continue;
        if (!marketHit) continue;
        const key = `${g.sport}|${g.gameLabel}|${p.player}|${p.market}|${p.line}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ g, prop: p });
        if (out.length >= 24) return out;
      }
    }
    return out;
  }, [searchPool, debouncedQ]);

  const fallbackPlayers = useMemo(() => {
    const results = playerSearchQ.data?.results ?? [];
    if (results.length === 0) return [] as PlayerSearchResult[];
    const supported = new Set(SPORTS.map((s) => s.id));
    const shown = new Set<string>();
    for (const grp of playerResults) for (const p of grp.players) shown.add(p.prop.player.toLowerCase());
    const seen = new Set<string>();
    const out: PlayerSearchResult[] = [];
    for (const r of results) {
      if (!supported.has(r.sport)) continue;
      if (shown.has(r.name.toLowerCase())) continue;
      const key = `${r.sport}-${r.athleteId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(r);
    }
    return out;
  }, [playerSearchQ.data, playerResults]);

  const totalPlayerMatches = playerResults.reduce((n, r) => n + r.players.length, 0);
  const hasResults =
    totalPlayerMatches > 0 ||
    fallbackPlayers.length > 0 ||
    teamResults.length > 0 ||
    gameResults.length > 0 ||
    propResults.length > 0;

  const onSelectQuery = (q: string) => {
    setQuery(q);
    void rememberQuery(q);
  };

  const onPlayerOpen = (g: GameProps, prop: PlayerProp) => {
    void rememberQuery(query);
    openSheet(g, prop);
  };

  const onFallbackPlayerOpen = (r: PlayerSearchResult) => {
    void rememberQuery(query);
    openSearchedPlayer(r);
  };

  const onTeamOpen = (t: (typeof teamResults)[number]) => {
    void rememberQuery(query);
    openTeam(t);
  };

  const onGameOpen = (sport: string, game: OddsGame) => {
    void rememberQuery(query);
    openGame(sport, game.id);
  };

  const onPropOpen = (g: GameProps, prop: PlayerProp) => {
    void rememberQuery(query);
    openPropDetail(g, prop);
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.background, paddingTop: insets.top }}>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 10,
          paddingHorizontal: 16,
          paddingVertical: 10,
        }}
      >
        <Pressable onPress={() => router.back()} hitSlop={8} style={{ padding: 4 }}>
          <Feather name="arrow-left" size={22} color={colors.foreground} />
        </Pressable>
        <View
          style={{
            flex: 1,
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
            backgroundColor: colors.card,
            borderWidth: 1,
            borderColor: colors.border,
            borderRadius: 999,
            paddingHorizontal: 14,
            paddingVertical: 11,
          }}
        >
          <Feather name="search" size={17} color={colors.mutedForeground} />
          <TextInput
            ref={inputRef}
            value={query}
            onChangeText={setQuery}
            placeholder="Search games, teams, or player props…"
            placeholderTextColor={colors.mutedForeground}
            style={{ flex: 1, color: colors.foreground, fontFamily: FONT.medium, fontSize: 14, padding: 0 }}
            autoCorrect={false}
            autoCapitalize="none"
            returnKeyType="search"
          />
          {query.length > 0 ? (
            <Pressable onPress={() => setQuery("")} hitSlop={8} accessibilityLabel="Clear search">
              <Feather name="x-circle" size={18} color={colors.mutedForeground} />
            </Pressable>
          ) : null}
        </View>
      </View>

      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 24, gap: 10 }}
      >
        {!searching ? (
          recent.length > 0 ? (
            <View style={{ gap: 10 }}>
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                <SearchSectionLabel>Recent searches</SearchSectionLabel>
                <Pressable
                  onPress={() => {
                    void clearRecentSearches().then(() => setRecent([]));
                  }}
                  hitSlop={8}
                >
                  <Text style={{ color: colors.primary, fontFamily: FONT.medium, fontSize: 12 }}>Clear</Text>
                </Pressable>
              </View>
              {recent.map((item) => (
                <Pressable
                  key={item}
                  onPress={() => onSelectQuery(item)}
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
                  <Feather name="clock" size={16} color={colors.mutedForeground} />
                  <Text style={{ color: colors.foreground, fontFamily: FONT.medium, fontSize: 14, flex: 1 }} numberOfLines={1}>
                    {item}
                  </Text>
                  <Feather name="arrow-up-left" size={16} color={colors.mutedForeground} />
                </Pressable>
              ))}
            </View>
          ) : (
            <EmptyState
              icon="search"
              title="Search Stadium Edge"
              subtitle="Find teams, players, games, and player props across every league."
            />
          )
        ) : debouncedQuery.trim() !== query.trim() || searchBusy || playerSearchQ.isFetching ? (
          <View style={{ paddingVertical: 24, alignItems: "center", gap: 10 }}>
            <ActivityIndicator color={colors.mutedForeground} />
            <Text style={{ color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 13 }}>Searching…</Text>
          </View>
        ) : !hasResults ? (
          <EmptyState
            icon="search"
            title="No results found"
            subtitle={`Nothing matched “${query.trim()}”. Try a team, player, game, or prop market like strikeouts.`}
          />
        ) : (
          <>
            {(totalPlayerMatches > 0 || fallbackPlayers.length > 0) && (
              <View style={{ gap: 10 }}>
                <SearchSectionLabel>Players</SearchSectionLabel>
                {playerResults.map(({ g, players }, gi) => (
                  <View key={`${g.gameLabel}-${gi}`} style={{ gap: 10 }}>
                    {playerResults.length > 1 ? (
                      <Text
                        style={{ color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 11 }}
                        numberOfLines={1}
                      >
                        {g.gameLabel}
                      </Text>
                    ) : null}
                    {players.map(({ prop, count }) => (
                      <PlayerResultRow
                        key={`${g.gameLabel}-${prop.player}`}
                        prop={prop}
                        subtitle={`${count} market${count === 1 ? "" : "s"} · ${g.gameLabel}`}
                        onOpen={() => onPlayerOpen(g, prop)}
                      />
                    ))}
                  </View>
                ))}
                {fallbackPlayers.map((r) => (
                  <SearchedPlayerRow key={`fb-${r.sport}-${r.athleteId}`} result={r} onOpen={() => onFallbackPlayerOpen(r)} />
                ))}
              </View>
            )}

            {teamResults.length > 0 && (
              <View style={{ gap: 10 }}>
                <SearchSectionLabel>Teams</SearchSectionLabel>
                {teamResults.map((t) => (
                  <TeamResultRow
                    key={`team-${t.sport}-${t.team}`}
                    team={t.team}
                    opp={t.opp}
                    isHome={t.isHome}
                    subtitle={`${t.gameLabel} · tap to view`}
                    onOpen={() => onTeamOpen(t)}
                  />
                ))}
              </View>
            )}

            {gameResults.length > 0 && (
              <View style={{ gap: 10 }}>
                <SearchSectionLabel>Games</SearchSectionLabel>
                {gameResults.map(({ sport, game }) => (
                  <GameResultRow
                    key={`${sport}-${game.id}`}
                    game={game}
                    sport={sport}
                    onOpen={() => onGameOpen(sport, game)}
                  />
                ))}
              </View>
            )}

            {propResults.length > 0 && (
              <View style={{ gap: 10 }}>
                <SearchSectionLabel>Props</SearchSectionLabel>
                {propResults.map(({ g, prop }) => (
                  <PropResultRow
                    key={`${g.sport}-${g.gameLabel}-${prop.player}-${prop.market}-${prop.line}`}
                    prop={prop}
                    gameLabel={g.gameLabel}
                    sport={g.sport}
                    onOpen={() => onPropOpen(g, prop)}
                  />
                ))}
              </View>
            )}
          </>
        )}
      </ScrollView>

      <PlayerPropsSheet data={sheet} active={!!sheet} onClose={() => setSheet(null)} />
      <TeamPropsSheet data={teamSheet} onClose={() => setTeamSheet(null)} />
    </View>
  );
}

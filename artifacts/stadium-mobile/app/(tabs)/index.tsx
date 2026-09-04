import { Feather, MaterialCommunityIcons } from "@expo/vector-icons";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useFocusEffect, useRouter } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Image,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ErrorBoundary } from "@/components/ErrorBoundary";
import type { ErrorFallbackProps } from "@/components/ErrorFallback";
import { PerformanceSparkline } from "@/components/PerformanceSparkline";
import { AppHeader } from "@/components/AppHeader";
import { TennisHomeFeed } from "@/components/TennisHomeFeed";
import { FighterAvatar } from "@/components/FighterAvatar";
import { GameCard, type GameMeta } from "@/components/GameCard";
import { useSlipClearance } from "@/components/SlipBar";
import { EmptyState, ErrorState, FONT, Loading, Pill, TABULAR, TYPE } from "@/components/ui";
import { useColors } from "@/hooks/useColors";
import { markCoachHomeLaunch } from "@/lib/coachSilentLaunch";
import {
  fetchUpsetSpots,
  getGames,
  getLiveSteals,
  getOdds,
  getProps,
  getTennisFlags,
  isHomeDiscoverable,
  propMarketLabel,
  PROPS_SPORTS,
  resolveTennisFlag,
  type EspnGame,
  type OddsGame,
  type TennisFlag,
  type UpsetSpot,
} from "@/lib/api";
import { formatAmerican } from "@/lib/format";
import { buildRollingWinRateSeries, summarizeRecentPerformance } from "@/lib/performanceChart";
import { GRADE_POOL, gradePropCands, recommendSide } from "@/lib/propGrade";
import { DEFAULT_SPORTS, SPORTS } from "@/lib/sports";
import {
  hydrateDiscoverCache,
  rememberLiveGames,
  rememberUpcomingGames,
  DISCOVER_CACHE_SPORTS,
  clearDiscoverCache,
  type CachedPropEntry,
} from "@/lib/discoverSessionCache";
import { oddsGameFromEspnShell } from "@/lib/gameResolve";
import { isRenderableOddsGame, safeMarkets } from "@/lib/sportFeed";
import { buildUfcFeedPhotoMap, withUfcFightPhotos } from "@/lib/ufcFighterPhotos";

const nickname = (full: string) => (full || "").split(/\s+/).filter(Boolean).pop() || full;

type SportFeedPayload<T> = { gen: number; league: string; rows: T[] };

function isSportFeedPayload<T>(v: unknown): v is SportFeedPayload<T> {
  return (
    !!v &&
    typeof v === "object" &&
    !Array.isArray(v) &&
    typeof (v as SportFeedPayload<T>).gen === "number" &&
    typeof (v as SportFeedPayload<T>).league === "string" &&
    Array.isArray((v as SportFeedPayload<T>).rows)
  );
}

// Top Value Props rail: a prop is "value" when the best posted price beats the
// de-vigged cross-book consensus fair value (server-computed ev) by at least
// this margin. We NEVER recompute or guess EV client-side.
const HOME_MIN_VALUE_EV = 1.5;
const HOME_SPORT_IDS = ["mlb", "wnba", "nba", "nhl", "soccer", "ufc", "tennis", "nfl"];
const HOME_SPORTS = SPORTS.filter((s) => HOME_SPORT_IDS.includes(s.id));
const UPCOMING_PREVIEW_COUNT = 8;

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

// Tennis cards have no ESPN team meta (players aren't teams), so merge in each
// player's REAL country flag as the avatar image. The flag fills the GameCard's
// logo slot, which already falls back to initials when the uri is null — so a
// player ESPN doesn't carry simply stays as initials (never a guessed flag).
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

/** Keeps sport pills usable if a single league feed throws during render. */
function HomeFeedErrorFallback({ error, resetError }: ErrorFallbackProps) {
  const colors = useColors();
  return (
    <View style={{ paddingHorizontal: 16, paddingVertical: 32, gap: 12 }}>
      <Text style={{ color: colors.foreground, ...TYPE.button, textAlign: "center" }}>
        Couldn't load this league
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
        Try another sport pill above, or tap retry. If this keeps happening, force-quit the app and
        reopen so the latest update can finish installing.
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
          numberOfLines={2}
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

// A featured player built ONLY from a real bookmaker prop line — never an
// invented "form" rating. Team abbreviation is resolved from the player's real
// ESPN team id matched against the game's home/away ids.
function FeaturedAvatar({
  headshot,
  teamLogo,
  name,
  size = 56,
}: {
  headshot: string | null;
  teamLogo: string | null;
  name: string;
  size?: number;
}) {
  const colors = useColors();
  // Fall back through real imagery only: player headshot first, then the team
  // logo, and finally initials. onError drops a broken image to the next tier so
  // a dead URL never leaves an empty avatar.
  const [headshotFailed, setHeadshotFailed] = useState(false);
  const [logoFailed, setLogoFailed] = useState(false);
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
  const showHeadshot = headshot && !headshotFailed;
  const showLogo = !showHeadshot && teamLogo && !logoFailed;
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: colors.surface,
        borderWidth: 1,
        borderColor: colors.border,
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
      }}
    >
      {showHeadshot ? (
        <Image
          source={{ uri: headshot! }}
          style={{ width: size, height: size }}
          resizeMode="cover"
          onError={() => setHeadshotFailed(true)}
        />
      ) : showLogo ? (
        <Image
          source={{ uri: teamLogo! }}
          style={{ width: size * 0.62, height: size * 0.62 }}
          resizeMode="contain"
          onError={() => setLogoFailed(true)}
        />
      ) : (
        <Text style={{ color: colors.mutedForeground, fontFamily: FONT.bold, fontSize: size * 0.28 }}>
          {initials || "?"}
        </Text>
      )}
    </View>
  );
}

function BaseballMiniPanel() {
  const colors = useColors();
  const dot = (filled: boolean, color: string) => (
    <View
      style={{
        width: 7,
        height: 7,
        borderRadius: 4,
        backgroundColor: filled ? color : colors.border,
      }}
    />
  );
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
      <View style={{ gap: 5 }}>
        {[
          { label: "B", filled: 3, color: "#34d399" },
          { label: "S", filled: 2, color: "#facc15" },
          { label: "O", filled: 1, color: "#ef4444" },
        ].map((row) => (
          <View key={row.label} style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
            <Text style={{ width: 10, color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 10 }}>
              {row.label}
            </Text>
            {[0, 1, 2, 3, 4].map((i) => (
              <View key={i}>{dot(i < row.filled, row.color)}</View>
            ))}
          </View>
        ))}
      </View>
      <View style={{ width: 48, height: 48, alignItems: "center", justifyContent: "center" }}>
        <View
          style={{
            position: "absolute",
            width: 16,
            height: 16,
            borderWidth: 2,
            borderColor: colors.mutedForeground,
            transform: [{ rotate: "45deg" }, { translateY: -14 }],
          }}
        />
        <View
          style={{
            position: "absolute",
            width: 16,
            height: 16,
            borderWidth: 2,
            borderColor: colors.mutedForeground,
            transform: [{ rotate: "45deg" }, { translateX: -14 }],
          }}
        />
        <View
          style={{
            position: "absolute",
            width: 16,
            height: 16,
            borderWidth: 2,
            borderColor: colors.primary,
            backgroundColor: "#facc15",
            transform: [{ rotate: "45deg" }, { translateX: 14 }],
          }}
        />
      </View>
    </View>
  );
}

/** Premium parlay CTA card — opens Coach for a new AI parlay. */
function BuildBestParlayHero({ onPress }: { onPress: () => void }) {
  const colors = useColors();
  return (
    <Pressable
      onPress={onPress}
      style={{ marginHorizontal: 16, marginTop: 16, marginBottom: 4 }}
    >
      {({ pressed }) => (
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 14,
            backgroundColor: colors.card,
            borderWidth: 1,
            borderColor: colors.border,
            borderRadius: 16,
            paddingVertical: 16,
            paddingHorizontal: 16,
            opacity: pressed ? 0.92 : 1,
          }}
        >
          <View
            style={{
              width: 48,
              height: 48,
              borderRadius: 12,
              backgroundColor: "rgba(59,130,246,0.14)",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <MaterialCommunityIcons name="cards-playing-outline" size={26} color={colors.primary} />
          </View>
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={{ color: colors.foreground, ...TYPE.button }}>
              Build best parlay
            </Text>
            <Text
              style={{
                color: colors.mutedForeground,
                fontFamily: FONT.medium,
                fontSize: 12,
                lineHeight: 17,
              }}
            >
              Get AI-powered picks tailored for the best possible odds
            </Text>
          </View>
          <View
            style={{
              width: 40,
              height: 40,
              borderRadius: 20,
              backgroundColor: colors.primary,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Feather name="arrow-right" size={18} color="#fff" />
          </View>
        </View>
      )}
    </Pressable>
  );
}

type HomeSportFeedProps = {
  sport: string;
  sportFetchGenRef: React.MutableRefObject<number>;
  colors: ReturnType<typeof useColors>;
  insets: ReturnType<typeof useSafeAreaInsets>;
  slipClearance: number;
  router: ReturnType<typeof useRouter>;
  width: number;
  isWideLayout: boolean;
  hotCardWidth: number;
  quickCardWidth: number;
};

function HomeSportFeed({
  sport,
  sportFetchGenRef,
  colors,
  insets,
  slipClearance,
  router,
  width,
  isWideLayout,
  hotCardWidth,
  quickCardWidth,
}: HomeSportFeedProps) {
  const queryClient = useQueryClient();
  const [upcomingExpanded, setUpcomingExpanded] = useState(false);

  // Refetch the active league when the pill changes. Kept separate from
  // useFocusEffect so a sport tap never retriggers OTA reload side-effects.
  useEffect(() => {
    void queryClient.invalidateQueries({ queryKey: ["odds", sport] });
    void queryClient.invalidateQueries({ queryKey: ["games", sport] });
    void queryClient.invalidateQueries({ queryKey: ["home-featured", sport] });
    setUpcomingExpanded(false);
  }, [queryClient, sport]);

  useFocusEffect(
    useCallback(() => {
      /* sport from props */
      void queryClient.invalidateQueries({ queryKey: ["odds", sport] });
      void queryClient.invalidateQueries({ queryKey: ["games", sport] });
      void queryClient.invalidateQueries({ queryKey: ["home-featured", sport] });
      // OTA apply is user-driven via OtaUpdateBanner — never reloadAsync here.
      // Auto-reload on focus (and especially on sport-pill dep churn) was
      // corrupting mid-session bundles and surfacing errors like
      // "userFound is not a function" right after tapping Tennis.
    }, [queryClient, sport]),
  );

  const oddsQ = useQuery<SportFeedPayload<OddsGame>>({
    queryKey: ["odds", sport],
    queryFn: async ({ signal, queryKey }) => {
      const league = String(queryKey[1] ?? "");
      const gen = sportFetchGenRef.current;
      try {
        const rows = await getOdds(league, signal);
        return { gen, league, rows };
      } catch {
        return { gen, league, rows: [] as OddsGame[] };
      }
    },
    staleTime: 45_000,
    refetchOnMount: "always",
    placeholderData: (previousData, previousQuery) =>
      previousQuery?.queryKey?.[1] === sport ? previousData : undefined,
  });
  const gamesQ = useQuery<SportFeedPayload<EspnGame>>({
    queryKey: ["games", sport],
    queryFn: async ({ signal, queryKey }) => {
      const league = String(queryKey[1] ?? "");
      const gen = sportFetchGenRef.current;
      try {
        const rows = await getGames(league, signal);
        return { gen, league, rows };
      } catch {
        // Tennis used to 400 before ESPN scoreboard support; never leave the
        // pill in a permanent error/loading state when games are unavailable.
        return { gen, league, rows: [] as EspnGame[] };
      }
    },
    staleTime: 45_000,
    refetchOnMount: "always",
    placeholderData: (previousData, previousQuery) =>
      previousQuery?.queryKey?.[1] === sport ? previousData : undefined,
  });

  // Tennis players have no club crest, so the Upcoming cards show each player's
  // REAL ESPN country flag instead of plain initials. One cached fetch covers
  // the whole tennis slate; only fired when the Tennis pill is selected.
  const tennisFlagsQ = useQuery({
    queryKey: ["tennis-flags"],
    queryFn: ({ signal }) => getTennisFlags(signal),
    staleTime: 5 * 60_000,
    enabled: sport === "tennis",
    retry: false,
  });

  const gamesForSport = useMemo(() => {
    const payload = gamesQ.data;
    if (
      !isSportFeedPayload<EspnGame>(payload) ||
      payload.league !== sport ||
      payload.gen !== sportFetchGenRef.current ||
      gamesQ.isPlaceholderData ||
      gamesQ.isFetching ||
      !gamesQ.isSuccess
    ) {
      return [];
    }
    return payload.rows.filter((g) => g.sport === sport);
  }, [gamesQ.data, gamesQ.isPlaceholderData, gamesQ.isFetching, gamesQ.isSuccess, sport]);

  const oddsForSport = useMemo(() => {
    const payload = oddsQ.data;
    if (
      !isSportFeedPayload<OddsGame>(payload) ||
      payload.league !== sport ||
      payload.gen !== sportFetchGenRef.current ||
      oddsQ.isPlaceholderData ||
      oddsQ.isFetching ||
      !oddsQ.isSuccess
    ) {
      return [];
    }
    return payload.rows.filter((g) => g.sport === sport && isRenderableOddsGame(g));
  }, [oddsQ.data, oddsQ.isPlaceholderData, oddsQ.isFetching, oddsQ.isSuccess, sport]);

  const metaMap = useMemo(() => buildMetaMap(gamesForSport), [gamesForSport]);

  const freshLiveGames = useMemo(
    () => gamesForSport.filter((g) => g.state === "in"),
    [gamesForSport],
  );
  useEffect(() => {
    if (freshLiveGames.length > 0) {
      rememberLiveGames(sport, freshLiveGames);
    }
  }, [freshLiveGames, sport]);
  // Live Now: only rows from the active pill's successful games fetch.
  const displayLiveGames = useMemo(
    () => freshLiveGames.filter((g) => g.sport === sport),
    [freshLiveGames, sport],
  );

  // Nickname keys (away|home) of games currently in progress, so we can drop them
  // from Upcoming — a live game already has its own card in the "Live Now" rail.
  const liveKeySet = useMemo(() => {
    const s = new Set<string>();
    for (const g of displayLiveGames) {
      const home = g.homeTeam || g.homeAbbr || "";
      const away = g.awayTeam || g.awayAbbr || "";
      if (!home || !away) continue;
      s.add(`${nickname(away)}|${nickname(home)}`.toLowerCase());
    }
    return s;
  }, [displayLiveGames]);

  const games: OddsGame[] = useMemo(() => {
    const dropLive = (g: OddsGame) =>
      !liveKeySet.has(`${nickname(g.awayTeam)}|${nickname(g.homeTeam)}`.toLowerCase());
    const byStart = (a: OddsGame, b: OddsGame) =>
      Date.parse(a.commenceTime) - Date.parse(b.commenceTime);

    const fromOdds = oddsForSport
      .filter((g) => isHomeDiscoverable(g.commenceTime))
      .filter(dropLive)
      .sort(byStart);
    if (fromOdds.length > 0) return fromOdds;

    // Odds feed is often empty during MLB All-Star break and other off-days;
    // fall back to ESPN schedule shells so Upcoming still lists the next slate.
    return gamesForSport
      .filter((g) => g.state !== "post" && g.state !== "in")
      .filter((g) => isHomeDiscoverable(g.startsAt))
      .map((g) => oddsGameFromEspnShell(sport, g))
      .filter((g): g is OddsGame => g !== null)
      .filter(dropLive)
      .sort(byStart);
  }, [oddsForSport, gamesForSport, liveKeySet, sport]);

  const ufcPhotoKey = useMemo(
    () =>
      games
        .map((g) => `${g.awayTeam}|${g.homeTeam}`)
        .sort()
        .join(";"),
    [games],
  );

  const ufcPhotosQ = useQuery({
    queryKey: ["ufc-feed-photos", ufcPhotoKey],
    queryFn: ({ signal }) =>
      buildUfcFeedPhotoMap(
        games.map((g) => ({ awayTeam: g.awayTeam, homeTeam: g.homeTeam })),
        signal,
      ),
    staleTime: 24 * 60 * 60_000,
    enabled: sport === "ufc" && games.length > 0,
  });

  useEffect(() => {
    if (games.length > 0) {
      rememberUpcomingGames(sport, games);
    }
  }, [games, sport]);
  const displayUpcoming = useMemo(() => games, [games]);
  const visibleUpcoming = useMemo(
    () =>
      upcomingExpanded
        ? displayUpcoming
        : displayUpcoming.slice(0, UPCOMING_PREVIEW_COUNT),
    [displayUpcoming, upcomingExpanded],
  );
  const canExpandUpcoming = displayUpcoming.length > UPCOMING_PREVIEW_COUNT;

  const sportFeedLoading =
    oddsQ.isFetching ||
    gamesQ.isFetching ||
    !oddsQ.isSuccess ||
    !gamesQ.isSuccess ||
    !isSportFeedPayload(oddsQ.data) ||
    !isSportFeedPayload(gamesQ.data) ||
    oddsQ.data.gen !== sportFetchGenRef.current ||
    gamesQ.data.gen !== sportFetchGenRef.current;

  // Featured players: only for sports the props feed serves. IMPORTANT: draw the
  // game list from the SAME source + ordering the Props tab uses (Odds API odds,
  // soonest first) so any featured player is guaranteed to also appear when we
  // deep-link into the Props search. ESPN games only supply team ids/abbrs (for
  // headshots + team labels), matched by nickname.
  const featuredEnabled = PROPS_SPORTS.includes(sport);
  const featGames = useMemo(() => games.slice(0, 4), [games]);

  const teamInfoMap = useMemo(() => {
    const map = new Map<
      string,
      {
        homeTeamId: string | null;
        awayTeamId: string | null;
        homeAbbr: string | null;
        awayAbbr: string | null;
        homeLogo: string | null;
        awayLogo: string | null;
      }
    >();
    for (const g of gamesForSport) {
      const home = g.homeTeam || g.homeAbbr || "";
      const away = g.awayTeam || g.awayAbbr || "";
      if (!home || !away) continue;
      map.set(`${nickname(away)}|${nickname(home)}`.toLowerCase(), {
        homeTeamId: g.homeTeamId ?? null,
        awayTeamId: g.awayTeamId ?? null,
        homeAbbr: g.homeAbbr ?? null,
        awayAbbr: g.awayAbbr ?? null,
        homeLogo: g.homeLogo ?? null,
        awayLogo: g.awayLogo ?? null,
      });
    }
    return map;
  }, [gamesForSport]);

  // One query PER featured game (not a single allSettled over all 4), so the
  // rail renders PROGRESSIVELY — players from whichever game responds first
  // appear immediately instead of the whole section blocking on the slowest
  // (cold-cache) props request. Still gated on ESPN success so team ids/abbrs/
  // crests attach on the first pass (headshots optional → avatar falls back to
  // initials).
  const featuredGameQs = useQueries({
    queries: featuredEnabled
      ? featGames.map((g) => ({
          queryKey: ["home-featured", sport, g.id],
          enabled: !sportFeedLoading && games.length > 0,
          staleTime: 60_000,
          refetchOnMount: "always",
          queryFn: async ({ signal }: { signal: AbortSignal }) => {
            const info =
              teamInfoMap.get(
                `${nickname(g.awayTeam)}|${nickname(g.homeTeam)}`.toLowerCase(),
              ) ?? null;
            const r = await getProps(
              {
                sport,
                eventId: g.id,
                home: g.homeTeam,
                away: g.awayTeam,
                homeTeamId: info?.homeTeamId,
                awayTeamId: info?.awayTeamId,
                startsAt: g.commenceTime,
              },
              signal,
            );
            return { info, props: Array.isArray(r.props) ? r.props : [] };
          },
        }))
      : [],
  });

  // ---- Home AI sections (all REAL data; each rail hides when nothing qualifies) ----

  // Flatten the featured per-game prop fetches into one list with game/team
  // context. Drives Hot Picks and Top Value rails. Recomputed each render
  // (cheap) as the per-game queries settle, so rails fill in progressively.
  type PropEntry = CachedPropEntry;
  const propEntries: PropEntry[] = (() => {
    const out: PropEntry[] = [];
    featuredGameQs.forEach((q, i) => {
      const data = q.data;
      const g = featGames[i];
      if (!data || !g) return;
      const { info, props } = data;
      const propRows = Array.isArray(props) ? props : [];
      const gameLabel = `${g.awayTeam} @ ${g.homeTeam}`;
      for (const p of propRows) {
        if (p.alt) continue;
        const isHome =
          !!p.playerTeamId && !!info?.homeTeamId && p.playerTeamId === info.homeTeamId;
        const isAway =
          !!p.playerTeamId && !!info?.awayTeamId && p.playerTeamId === info.awayTeamId;
        const teamAbbr = isHome ? info!.homeAbbr : isAway ? info!.awayAbbr : null;
        const teamLogo =
          p.teamLogo ?? (isHome ? info!.homeLogo : isAway ? info!.awayLogo : null);
        out.push({ prop: p, gameLabel, startsAt: g.commenceTime, teamAbbr, teamLogo });
      }
    });
    return out;
  })();

  // HOT PICKS — graded by REAL recent hit-rate (same shared engine as the Props
  // tab): how often the player has cleared THIS posted line in their last games.
  type HotCand = {
    key: string;
    player: string;
    athleteId: string | null;
    marketKey: string;
    line: number | null;
    side: "Over" | "Under";
    price: number;
    label: string;
    headshot: string | null;
    teamLogo: string | null;
    teamAbbr: string | null;
  };
  const hotCands: HotCand[] = (() => {
    const out: HotCand[] = [];
    const seen = new Set<string>();
    for (const e of propEntries) {
      const p = e.prop;
      const sel = recommendSide(p);
      if (!sel) continue;
      let side = sel.side;
      let price = sel.price;
      // Yes/no markets (no line) are only meaningful on the Over/"Yes" side.
      if (p.line == null) {
        if (p.overPrice == null) continue;
        side = "Over";
        price = p.overPrice;
      }
      const pl = p.player.toLowerCase();
      if (seen.has(pl)) continue;
      seen.add(pl);
      out.push({
        key: `${e.gameLabel}|${p.player}|${p.market}|${p.line}|${side}`,
        player: p.player,
        athleteId: p.athleteId ?? null,
        marketKey: p.market,
        line: p.line,
        side,
        price,
        label: propMarketLabel(p.market),
        headshot: p.headshot ?? null,
        teamLogo: e.teamLogo,
        teamAbbr: e.teamAbbr,
      });
      if (out.length >= GRADE_POOL) break;
    }
    return out;
  })();
  // Stable string key so grading only refetches when the candidate set changes.
  const hotKey = hotCands
    .map((c) => `${c.player}|${c.marketKey}|${c.line}|${c.side}`)
    .join(",");

  // Track record of the app's OWN longshot "steal" picks (auto-graded W/L vs real
  // results). Real or hidden — never shown without graded results.
  const stealsQ = useQuery({
    queryKey: ["home-steals"],
    queryFn: ({ signal }) => getLiveSteals(signal),
    staleTime: 5 * 60_000,
  });
  const gradedHistory = stealsQ.data?.history ?? [];
  const perfSummary = summarizeRecentPerformance(gradedHistory);
  const perfSeries = buildRollingWinRateSeries(gradedHistory);
  const hasPerfData = perfSummary.wins + perfSummary.losses > 0;
  const perfWinPct = perfSummary.winPct;
  const perfRecord = hasPerfData
    ? `${perfSummary.wins}-${perfSummary.losses}${perfSummary.pushes > 0 ? `-${perfSummary.pushes}` : ""}`
    : null;

  const hotGradesQ = useQuery({
    queryKey: ["home-hot-grades", sport, hotKey],
    enabled: featuredEnabled && hotCands.length > 0,
    staleTime: 10 * 60_000,
    queryFn: ({ signal }) =>
      gradePropCands(
        hotCands.map((c) => ({
          key: c.key,
          player: c.player,
          athleteId: c.athleteId,
          marketKey: c.marketKey,
          line: c.line,
          side: c.side,
        })),
        sport,
        signal,
      ),
  });
  const topHot: (HotCand & { grade: string; hits: number; n: number })[] = (() => {
    const grades = hotGradesQ.data;
    if (!grades) return [];
    const order = (g: string) => (g === "A+" ? 3 : g === "A" ? 2 : 1);
    const out: (HotCand & { grade: string; hits: number; n: number })[] = [];
    for (const c of hotCands) {
      const r = grades.get(c.key);
      if (r) out.push({ ...c, grade: r.grade, hits: r.hits, n: r.n });
    }
    out.sort((a, b) => order(b.grade) - order(a.grade) || b.hits / b.n - a.hits / a.n);
    return out.slice(0, 6);
  })();
  const hotLoading =
    featuredEnabled && hotCands.length > 0 && hotGradesQ.isLoading && topHot.length === 0;

  // TOP VALUE PROPS — server-computed +EV props above a small EV floor, deduped
  // by player. Real ev/edge only; empty (hidden) when nothing qualifies.
  type ValueProp = {
    player: string;
    athleteId: string | null;
    headshot: string | null;
    teamLogo: string | null;
    teamAbbr: string | null;
    gameLabel: string;
    startsAt: string;
    marketKey: string;
    side: "Over" | "Under";
    line: number | null;
    label: string;
    price: number;
    ev: number;
  };
  const valueProps: ValueProp[] = (() => {
    const seen = new Set<string>();
    const out: ValueProp[] = [];
    const sorted = propEntries
      .filter((e) => e.prop.ev != null && e.prop.ev >= HOME_MIN_VALUE_EV)
      .sort((a, b) => (b.prop.ev ?? 0) - (a.prop.ev ?? 0));
    for (const e of sorted) {
      const p = e.prop;
      const side = p.evSide ?? "Over";
      const price = side === "Under" ? p.underPrice : p.overPrice;
      if (price == null) continue;
      const pl = p.player.toLowerCase();
      if (seen.has(pl)) continue;
      seen.add(pl);
      out.push({
        player: p.player,
        athleteId: p.athleteId ?? null,
        headshot: p.headshot ?? null,
        teamLogo: e.teamLogo,
        teamAbbr: e.teamAbbr,
        gameLabel: e.gameLabel,
        startsAt: e.startsAt,
        marketKey: p.market,
        side,
        line: p.line,
        label: propMarketLabel(p.market),
        price,
        ev: p.ev as number,
      });
      if (out.length >= 5) break;
    }
    return out;
  })();

  const openValuePropDetail = (v: ValueProp) => {
    const pick =
      v.line != null ? `${v.player} ${v.side} ${v.line} ${v.label}` : `${v.player} ${v.label}`;
    router.push({
      pathname: "/prop/[id]",
      params: {
        id: v.athleteId ?? v.player,
        player: v.player,
        marketKey: v.marketKey,
        marketLabel: v.label,
        line: v.line != null ? String(v.line) : "",
        side: v.side,
        odds: String(v.price),
        game: v.gameLabel,
        sport,
        athleteId: v.athleteId ?? "",
        headshot: v.headshot ?? "",
        startsAt: v.startsAt,
        pick,
      },
    });
  };

  // Best (highest server-EV) prop per featured game — drives the honest "BEST
  // PROP / EDGE" cells under each Upcoming card. Only games whose props we've
  // already fetched appear here; everything else simply shows no insight cells
  // (we never fabricate an AI favorite or value side we can't compute).
  const bestPropByGame = (() => {
    const map = new Map<
      string,
      { player: string; side: "Over" | "Under"; line: number | null; label: string; ev: number }
    >();
    for (const e of propEntries) {
      if (e.prop.ev == null) continue;
      const cur = map.get(e.gameLabel);
      if (!cur || e.prop.ev > cur.ev) {
        map.set(e.gameLabel, {
          player: e.prop.player,
          side: e.prop.evSide ?? "Over",
          line: e.prop.line,
          label: propMarketLabel(e.prop.market),
          ev: e.prop.ev,
        });
      }
    }
    return map;
  })();

  // UPSET WATCH: real spots where the app's analytics (mlLean) favor the betting
  // underdog, scoped to the selected sport. Same engine as the coach used to use
  // (matchup-history → mlLean → dog-lean detection); every number is real (dog ML
  // price + edge), section hidden when there are none.
  const upsetsQ = useQuery({
    queryKey: ["home-upsets", sport],
    queryFn: async ({ signal }) => {
      try {
        return await fetchUpsetSpots([sport], signal);
      } catch {
        return [];
      }
    },
    staleTime: 2 * 60_000,
    // Tennis uses tennisAnalysis (rank/form/H2H), not team matchup-history mlLean.
    enabled: sport !== "tennis",
  });
  const upsets: UpsetSpot[] = sport === "tennis" ? [] : (upsetsQ.data ?? []);

  const refreshing =
    oddsQ.isFetching ||
    gamesQ.isFetching ||
    featuredGameQs.some((q) => q.isFetching) ||
    stealsQ.isFetching ||
    (sport !== "tennis" && upsetsQ.isFetching);

  const askCoach = (msg: string, silent = false) => {
    if (silent) markCoachHomeLaunch();
    router.push({
      pathname: "/coach",
      params: {
        autoMsg: msg,
        send: "1",
        ts: String(Date.now()),
      },
    });
  };

  // Open Coach without auto-sending — user can edit the prompt and tap send.
  const goCoach = (prefill?: string) =>
    router.push({
      pathname: "/coach",
      params: {
        ...(prefill ? { prefill } : {}),
        ts: String(Date.now()),
      },
    });

  const quickActions: {
    label: string;
    subtitle: string;
    icon: React.ComponentProps<typeof MaterialCommunityIcons>["name"];
    color: string;
    onPress: () => void;
  }[] = [
    {
      label: "Hot Picks",
      subtitle: "Tonight's top picks",
      icon: "flash",
      color: "#fb923c",
      onPress: () => askCoach("Build me the best parlay", true),
    },
    {
      label: "Easy Money",
      subtitle: "High win rate tonight",
      icon: "currency-usd",
      color: "#34d399",
      onPress: () => askCoach("Build me a safe parlay"),
    },
    {
      label: "Best Value",
      subtitle: "Top projected edges",
      icon: "bullseye-arrow",
      color: colors.primary,
      onPress: () =>
        router.push({ pathname: "/props", params: featuredEnabled ? { sp: sport } : {} }),
    },
    {
      label: "Longshots",
      subtitle: "High upside plays",
      icon: "rocket-launch",
      color: "#a78bfa",
      onPress: () => router.push("/steals"),
    },
  ];

  return (
    <ErrorBoundary FallbackComponent={HomeFeedErrorFallback}>
      <ScrollView
        contentContainerStyle={{
          paddingBottom: insets.bottom + 24 + slipClearance,
        }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              oddsQ.refetch();
              gamesQ.refetch();
              // Manual refetch() fires even on disabled queries, so only kick
              // the featured props fan-out for sports that actually have props.
              if (featuredEnabled) featuredGameQs.forEach((q) => q.refetch());
              stealsQ.refetch();
              upsetsQ.refetch();
            }}
            tintColor={colors.mutedForeground}
          />
        }
      >

        {/* Static hero — opens Coach for a fresh AI parlay (no stale leg cache). */}
        <BuildBestParlayHero onPress={() => askCoach("Build me the best parlay", true)} />

        {/* Quick actions — four shortcut cards in a single row. */}
        <View
          style={{
            flexDirection: "row",
            flexWrap: "wrap",
            paddingHorizontal: 16,
            gap: 8,
            marginTop: 4,
            marginBottom: 22,
          }}
        >
          {quickActions.map((a) => (
            <Pressable
              key={a.label}
              onPress={a.onPress}
              style={({ pressed }) => ({
                width: quickCardWidth,
                backgroundColor: colors.card,
                borderWidth: 1,
                borderColor: colors.border,
                borderRadius: 16,
                paddingVertical: 14,
                paddingHorizontal: 8,
                gap: 8,
                alignItems: "center",
                opacity: pressed ? 0.85 : 1,
              })}
            >
              <View
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: 10,
                  backgroundColor: `${a.color}22`,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <MaterialCommunityIcons name={a.icon} size={18} color={a.color} />
              </View>
              <Text
                style={{
                  color: colors.foreground,
                  fontFamily: FONT.semibold,
                  fontSize: 13,
                  textAlign: "center",
                }}
                numberOfLines={1}
              >
                {a.label}
              </Text>
              <Text
                style={{
                  color: colors.mutedForeground,
                  fontFamily: FONT.medium,
                  fontSize: 11,
                  lineHeight: 14,
                  textAlign: "center",
                }}
                numberOfLines={2}
              >
                {a.subtitle}
              </Text>
            </Pressable>
          ))}
        </View>

        {/* Today's Performance — real graded steal picks; honest empty state when none settled. */}
        <View style={{ marginHorizontal: 16, marginBottom: 22 }}>
          <Pressable
            onPress={() => router.push("/pick-performance")}
            style={({ pressed }) => ({
              backgroundColor: colors.card,
              borderWidth: 1,
              borderColor: colors.border,
              borderRadius: colors.radius,
              padding: 16,
              gap: 14,
              opacity: pressed ? 0.9 : 1,
            })}
          >
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Feather name="bar-chart-2" size={16} color={colors.primary} />
              <Text
                style={{
                  color: colors.foreground,
                  ...TYPE.button, fontFamily: FONT.bold,
                  fontSize: 16,
                  flex: 1,
                }}
              >
                Today&apos;s Performance
              </Text>
              <Text style={{ color: colors.primary, ...TYPE.secondary, fontFamily: FONT.bold }}>
                View all
              </Text>
            </View>
            <View
              style={{
                flexDirection: isWideLayout ? "row" : "column",
                alignItems: "center",
                gap: isWideLayout ? 18 : 10,
              }}
            >
              <View style={{ flexDirection: "row", flex: 1, alignSelf: "stretch" }}>
                {[
                  {
                    val: hasPerfData && perfWinPct != null ? `${perfWinPct}%` : "—",
                    label: "Win Rate",
                    tint: hasPerfData ? "#34d399" : colors.mutedForeground,
                  },
                  {
                    val: perfRecord ?? "—",
                    label: "Record",
                    tint: hasPerfData ? colors.foreground : colors.mutedForeground,
                  },
                  {
                    val: hasPerfData ? String(perfSummary.wins + perfSummary.losses + perfSummary.pushes) : "—",
                    label: "Graded",
                    tint: hasPerfData ? colors.foreground : colors.mutedForeground,
                  },
                ].map((m, i) => (
                  <View
                    key={m.label}
                    style={{
                      flex: 1,
                      alignItems: "center",
                      gap: 3,
                      borderLeftWidth: i === 0 ? 0 : 1,
                      borderLeftColor: colors.border,
                    }}
                  >
                    <Text style={{ color: m.tint, fontFamily: TYPE.cardTitle.fontFamily, fontSize: TYPE.cardTitle.fontSize, lineHeight: TYPE.cardTitle.lineHeight, ...TABULAR }}>{m.val}</Text>
                    <Text
                      style={{
                        color: colors.mutedForeground,
                        fontFamily: FONT.medium,
                        fontSize: 10,
                        letterSpacing: 0.4,
                        textTransform: "uppercase",
                      }}
                    >
                      {m.label}
                    </Text>
                  </View>
                ))}
              </View>
              {perfSeries.length >= 2 ? (
                <PerformanceSparkline
                  series={perfSeries}
                  width={isWideLayout ? Math.min(310, width * 0.42) : width - 64}
                />
              ) : null}
            </View>
            {!hasPerfData ? (
              <Text
                style={{
                  color: colors.mutedForeground,
                  fontFamily: FONT.medium,
                  fontSize: 12,
                  textAlign: "center",
                }}
              >
                No settled picks yet
              </Text>
            ) : null}
          </Pressable>
        </View>

        {/* Hot Picks Today — disabled for now; graded prop rail preserved below. */}
        {false && featuredEnabled && (hotLoading || topHot.length > 0) ? (
          <View style={{ marginBottom: 22 }}>
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                paddingHorizontal: 16,
                marginBottom: 4,
              }}
            >
              <Feather name="trending-up" size={16} color="#fb923c" />
              <Text
                style={{
                  color: colors.foreground,
                  ...TYPE.button, fontFamily: FONT.bold,
                  fontSize: 18,
                  marginLeft: 8,
                  flex: 1,
                }}
              >
                Hot Picks Today
              </Text>
              <Pressable
                hitSlop={8}
                onPress={() => router.push({ pathname: "/props", params: { sp: sport } })}
                style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
              >
                <Text style={{ color: colors.primary, ...TYPE.secondary, fontFamily: FONT.bold }}>
                  View all
                </Text>
              </Pressable>
            </View>
            {topHot.length === 0 ? (
              <View style={{ paddingHorizontal: 16 }}>
                <Loading label="Grading today's props…" />
              </View>
            ) : (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ paddingHorizontal: 16, gap: 12 }}
              >
                {topHot.map((c) => {
                  const hitPct = Math.round((c.hits / c.n) * 100);
                  const gradeA = c.grade.startsWith("A");
                  return (
                    <Pressable
                      key={c.key}
                      onPress={() =>
                        router.push({ pathname: "/props", params: { q: nickname(c.player), sp: sport } })
                      }
                      style={({ pressed }) => ({
                        width: hotCardWidth,
                        backgroundColor: colors.card,
                        borderWidth: 1,
                        borderColor: colors.border,
                        borderRadius: colors.radius,
                        padding: 14,
                        gap: 8,
                        alignItems: "center",
                        opacity: pressed ? 0.85 : 1,
                      })}
                    >
                      <FeaturedAvatar headshot={c.headshot} teamLogo={c.teamLogo} name={c.player} />
                      <Text
                        style={{
                          color: colors.foreground,
                          fontFamily: FONT.semibold,
                          fontSize: 14,
                          textAlign: "center",
                        }}
                        numberOfLines={1}
                      >
                        {c.player}
                      </Text>
                      <Text
                        style={{
                          color: colors.mutedForeground,
                          fontFamily: FONT.medium,
                          fontSize: 11.5,
                          textAlign: "center",
                        }}
                        numberOfLines={1}
                      >
                        {c.line != null ? `${c.side} ${c.line} ${c.label}` : c.label}
                      </Text>
                      <View
                        style={{
                          flexDirection: "row",
                          alignItems: "center",
                          marginTop: 2,
                          borderTopWidth: 1,
                          borderTopColor: colors.border,
                          paddingTop: 10,
                          width: "100%",
                        }}
                      >
                        <View style={{ flex: 1, alignItems: "center", gap: 2 }}>
                          <Text
                            style={{
                              color: gradeA ? "#34d399" : colors.foreground,
                              fontFamily: FONT.bold,
                              fontSize: 15,
                            }}
                          >
                            {c.grade}
                          </Text>
                          <Text
                            style={{ color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 8.5, letterSpacing: 0.3 }}
                          >
                            GRADE
                          </Text>
                        </View>
                        <View style={{ flex: 1, alignItems: "center", gap: 2, borderLeftWidth: 1, borderLeftColor: colors.border }}>
                          <Text style={{ color: colors.foreground, fontFamily: TYPE.button.fontFamily, fontSize: TYPE.button.fontSize, lineHeight: TYPE.button.lineHeight }}>
                            {hitPct}%
                          </Text>
                          <Text
                            style={{ color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 8.5, letterSpacing: 0.3 }}
                          >
                            L{c.n} HIT
                          </Text>
                        </View>
                        <View style={{ flex: 1, alignItems: "center", gap: 2, borderLeftWidth: 1, borderLeftColor: colors.border }}>
                          <Text style={{ color: colors.primary, fontFamily: TYPE.button.fontFamily, fontSize: TYPE.button.fontSize, lineHeight: TYPE.button.lineHeight }}>
                            {formatAmerican(c.price)}
                          </Text>
                          <Text
                            style={{ color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 8.5, letterSpacing: 0.3 }}
                          >
                            ODDS
                          </Text>
                        </View>
                      </View>
                    </Pressable>
                  );
                })}
              </ScrollView>
            )}
          </View>
        ) : null}

        {/* Value Props — disabled; ranked +EV list preserved for future reuse. */}
        {false && featuredEnabled && valueProps.length > 0 ? (
          <View style={{ marginBottom: 22 }}>
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                paddingHorizontal: 16,
                marginBottom: 4,
              }}
            >
              <Feather name="award" size={16} color={colors.primary} />
              <Text
                style={{
                  color: colors.foreground,
                  ...TYPE.button, fontFamily: FONT.bold,
                  fontSize: 18,
                  marginLeft: 8,
                  flex: 1,
                }}
              >
                Value Props
              </Text>
              <Pressable
                hitSlop={8}
                onPress={() => router.push({ pathname: "/props", params: { sp: sport } })}
                style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
              >
                <Text style={{ color: colors.primary, ...TYPE.secondary, fontFamily: FONT.bold }}>
                  View all
                </Text>
              </Pressable>
            </View>
            <Text
              style={{
                color: colors.mutedForeground,
                fontFamily: FONT.body,
                fontSize: 13,
                lineHeight: 18,
                paddingHorizontal: 16,
                marginBottom: 12,
              }}
            >
              Ranked by the model's edge over the market price.
            </Text>
            <View style={{ paddingHorizontal: 16, gap: 10 }}>
              {valueProps.map((v, i) => (
                <Pressable
                  key={`${v.player}-${i}`}
                  onPress={() => openValuePropDetail(v)}
                  style={({ pressed }) => ({
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 12,
                    backgroundColor: colors.card,
                    borderWidth: 1,
                    borderColor: colors.border,
                    borderRadius: colors.radius,
                    padding: 12,
                    opacity: pressed ? 0.85 : 1,
                  })}
                >
                  <View
                    style={{
                      width: 26,
                      height: 26,
                      borderRadius: 13,
                      backgroundColor: i === 0 ? colors.primary : colors.surface,
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <Text
                      style={{
                        color: i === 0 ? "#fff" : colors.mutedForeground,
                        fontFamily: FONT.bold,
                        fontSize: 13,
                      }}
                    >
                      {i + 1}
                    </Text>
                  </View>
                  <FeaturedAvatar headshot={v.headshot} teamLogo={v.teamLogo} name={v.player} />
                  <View style={{ flex: 1 }}>
                    <Text
                      style={{ color: colors.foreground, fontFamily: FONT.semibold, fontSize: 14 }}
                      numberOfLines={1}
                    >
                      {v.player}
                    </Text>
                    <Text
                      style={{ color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 12 }}
                      numberOfLines={1}
                    >
                      {v.line != null ? `${v.side} ${v.line} ${v.label}` : v.label}
                      {v.teamAbbr ? ` · ${v.teamAbbr}` : ""}
                    </Text>
                  </View>
                  <View style={{ alignItems: "flex-end", gap: 3 }}>
                    <Text style={{ color: colors.foreground, fontFamily: FONT.bold, fontSize: 14 }}>
                      {formatAmerican(v.price)}
                    </Text>
                    <View
                      style={{
                        backgroundColor: "rgba(52,211,153,0.16)",
                        borderRadius: 6,
                        paddingHorizontal: 7,
                        paddingVertical: 2,
                      }}
                    >
                      <Text style={{ color: "#34d399", fontFamily: FONT.bold, fontSize: 11 }}>
                        +{v.ev.toFixed(1)}% EV
                      </Text>
                    </View>
                  </View>
                </Pressable>
              ))}
            </View>
          </View>
        ) : null}

        {/* Live now */}
        {displayLiveGames.length > 0 ? (
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
                <Text style={{ color: colors.foreground, fontFamily: TYPE.playerName.fontFamily, fontSize: TYPE.playerName.fontSize, lineHeight: TYPE.playerName.lineHeight }}>
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
                {displayLiveGames.length} {displayLiveGames.length === 1 ? "Game" : "Games"} · Live
              </Text>
            </View>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ paddingHorizontal: 16, gap: 12 }}
            >
              {displayLiveGames.map((g) => (
                <View
                  key={g.id}
                  style={{
                    width: displayLiveGames.length === 1 ? width - 32 : 300,
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

                  <View style={{ flexDirection: "row", gap: 12, alignItems: "center" }}>
                    <Pressable
                      onPress={() => router.push({ pathname: "/game/[id]", params: { id: g.id, sport } })}
                      style={{ gap: 8, flex: 1 }}
                    >
                      {[
                        { name: g.awayTeam, abbr: g.awayAbbr, logo: g.awayLogo, score: g.awayScore },
                        { name: g.homeTeam, abbr: g.homeAbbr, logo: g.homeLogo, score: g.homeScore },
                      ].map((t, i) => (
                        <View key={i} style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                          {t.logo ? (
                            <Image source={{ uri: t.logo }} style={{ width: 24, height: 24 }} resizeMode="contain" />
                          ) : (
                            <View style={{ width: 24, height: 24 }} />
                          )}
                          <Text
                            style={{ color: colors.foreground, fontFamily: FONT.semibold, fontSize: 15, flex: 1 }}
                            numberOfLines={1}
                          >
                            {t.name || t.abbr || "—"}
                          </Text>
                          <Text style={{ color: colors.foreground, fontFamily: FONT.bold, fontSize: 18 }}>
                            {t.score ?? 0}
                          </Text>
                        </View>
                      ))}
                    </Pressable>
                    {sport === "mlb" ? <BaseballMiniPanel /> : null}
                  </View>

                  <Pressable
                    onPress={() =>
                      goCoach(`Give me your best bets for ${g.awayTeam} @ ${g.homeTeam}`)
                    }
                    style={({ pressed }) => ({
                      backgroundColor: "rgba(59,130,246,0.14)",
                      borderWidth: 1,
                      borderColor: colors.primary,
                      borderRadius: 999,
                      paddingVertical: 10,
                      alignItems: "center",
                      justifyContent: "center",
                      flexDirection: "row",
                      gap: 8,
                      opacity: pressed ? 0.85 : 1,
                    })}
                  >
                    <Text style={{ color: colors.primary, fontFamily: FONT.semibold, fontSize: 12 }}>
                      Build best parlay from this game
                    </Text>
                    <Feather name="arrow-right" size={14} color={colors.primary} />
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
                ...TYPE.button, fontFamily: FONT.bold,
                fontSize: 18,
              }}
            >
              Upcoming Games
            </Text>
            {displayUpcoming.length > 0 ? (
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
                    ...TYPE.caption,
                  fontFamily: FONT.bold,
                  }}
                >
                  {displayUpcoming.length}
                </Text>
              </View>
            ) : null}
          </View>
          {displayUpcoming.length > 0 ? (
            <Pressable
              hitSlop={8}
              onPress={() =>
                router.push({ pathname: "/upcoming", params: { sport } })
              }
              style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
            >
              <Text
                style={{
                  color: colors.primary,
                  ...TYPE.secondary,
                  fontFamily: FONT.bold,
                }}
              >
                View all
              </Text>
            </Pressable>
          ) : null}
        </View>
        {sportFeedLoading && displayUpcoming.length === 0 ? (
          <View style={{ paddingHorizontal: 16 }}>
            <Loading label="Loading live odds…" />
          </View>
        ) : oddsQ.isError && !oddsQ.data ? (
          <View style={{ paddingHorizontal: 16 }}>
            <ErrorState onRetry={() => oddsQ.refetch()} />
          </View>
        ) : displayUpcoming.length === 0 ? (
          <View style={{ paddingHorizontal: 16 }}>
            <EmptyState
              icon="calendar"
              title="No upcoming games"
              subtitle={`No ${SPORTS.find((s) => s.id === sport)?.label ?? sport} games are scheduled in the next week. Try another league.`}
            />
          </View>
        ) : (
          <View style={{ paddingHorizontal: 16, gap: 10 }}>
            {visibleUpcoming.map((g) => {
              const baseMeta = metaMap.get(
                `${nickname(g.awayTeam)}|${nickname(g.homeTeam)}`.toLowerCase(),
              );
              const meta =
                sport === "tennis"
                  ? withTennisFlags(baseMeta, tennisFlagsQ.data, g)
                  : sport === "ufc"
                    ? (withUfcFightPhotos(baseMeta, ufcPhotosQ.data, g.awayTeam, g.homeTeam) as GameMeta)
                    : baseMeta;
              const h2h = safeMarkets(g).find((m) => m.key === "h2h");
              const awayML = h2h?.outcomes?.find((o) => o.name === g.awayTeam)?.price;
              const homeML = h2h?.outcomes?.find((o) => o.name === g.homeTeam)?.price;
              const best = bestPropByGame.get(`${g.awayTeam} @ ${g.homeTeam}`);
              const rows = [
                { name: g.awayTeam, logo: meta?.awayLogo, ml: awayML },
                { name: g.homeTeam, logo: meta?.homeLogo, ml: homeML },
              ];
              return (
                <Pressable
                  key={g.id}
                  onPress={() => router.push({ pathname: "/game/[id]", params: { id: g.id, sport } })}
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
                      {nickname(g.awayTeam)} @ {nickname(g.homeTeam)}
                    </Text>
                    {g.commenceTime ? (
                      <Text
                        style={{ color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 11 }}
                      >
                        {new Date(g.commenceTime).toLocaleString([], {
                          weekday: "short",
                          hour: "numeric",
                          minute: "2-digit",
                        })}
                      </Text>
                    ) : null}
                  </View>

                  {rows.map((t, i) => (
                    <View key={i} style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                      <FighterAvatar
                        uri={t.logo}
                        name={t.name}
                        size={24}
                        photo={sport === "ufc"}
                      />
                      <Text
                        style={{
                          color: colors.foreground,
                          fontFamily: FONT.semibold,
                          fontSize: 15,
                          flex: 1,
                        }}
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

                  {best ? (
                    <View
                      style={{
                        flexDirection: "row",
                        borderTopWidth: 1,
                        borderTopColor: colors.border,
                        paddingTop: 10,
                        gap: 12,
                      }}
                    >
                      <View style={{ flex: 1 }}>
                        <Text
                          style={{
                            color: colors.mutedForeground,
                            fontFamily: FONT.medium,
                            fontSize: 9,
                            letterSpacing: 0.4,
                            textTransform: "uppercase",
                            marginBottom: 2,
                          }}
                        >
                          Best Prop
                        </Text>
                        <Text
                          style={{ color: colors.foreground, fontFamily: FONT.semibold, fontSize: 12 }}
                          numberOfLines={1}
                        >
                          {nickname(best.player)}{" "}
                          {best.line != null ? `${best.side} ${best.line} ` : ""}
                          {best.label}
                        </Text>
                      </View>
                      <View style={{ alignItems: "flex-end" }}>
                        <Text
                          style={{
                            color: colors.mutedForeground,
                            fontFamily: FONT.medium,
                            fontSize: 9,
                            letterSpacing: 0.4,
                            textTransform: "uppercase",
                            marginBottom: 2,
                          }}
                        >
                          Edge
                        </Text>
                        <Text style={{ color: "#34d399", fontFamily: FONT.bold, fontSize: 12 }}>
                          +{typeof best.ev === "number" ? best.ev.toFixed(1) : "—"}%
                        </Text>
                      </View>
                    </View>
                  ) : null}
                </Pressable>
              );
            })}
          </View>
        )}

        {/* Upset Watch — real spots where the app's analytics (mlLean) favor the
            betting underdog. Styled like the other home rails; hidden when there
            are no real upsets. Tap a spot to ask the coach about it. Every number
            is real (dog ML price + edge). Placed last on the home feed. */}
        {sport !== "tennis" && (upsetsQ.isLoading || upsets.length > 0) ? (
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
                <Text style={{ color: colors.foreground, fontFamily: TYPE.playerName.fontFamily, fontSize: TYPE.playerName.fontSize, lineHeight: TYPE.playerName.lineHeight }}>
                  Upset Watch
                </Text>
              </View>
              {upsets.length > 0 ? (
                <Text
                  style={{
                    color: colors.mutedForeground,
                    fontFamily: FONT.medium,
                    fontSize: 11,
                    letterSpacing: 0.5,
                    textTransform: "uppercase",
                  }}
                >
                  {upsets.length} {upsets.length === 1 ? "Spot" : "Spots"}
                </Text>
              ) : null}
            </View>
            <Text
              style={{
                color: colors.mutedForeground,
                fontFamily: FONT.body,
                fontSize: 13,
                lineHeight: 18,
                paddingHorizontal: 16,
                marginBottom: 12,
              }}
            >
              Games where our analytics lean to the betting underdog.
            </Text>
            {upsetsQ.isLoading ? (
              <View style={{ paddingHorizontal: 16 }}>
                <Loading label="Scanning for upsets…" />
              </View>
            ) : (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ paddingHorizontal: 16, gap: 12 }}
              >
                {upsets.slice(0, 8).map((u, idx) => (
                  <Pressable
                    key={`${u.game}-${idx}`}
                    onPress={() =>
                      askCoach(
                        `Tell me about the upset spot in ${u.game} — why do you like the underdog?`,
                      )
                    }
                    style={({ pressed }) => ({
                      width: 270,
                      backgroundColor: colors.card,
                      borderWidth: 1,
                      borderColor: colors.border,
                      borderRadius: colors.radius,
                      padding: 14,
                      gap: 8,
                      opacity: pressed ? 0.85 : 1,
                    })}
                  >
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                      <Text
                        style={{ color: colors.foreground, fontFamily: FONT.semibold, fontSize: 15, flex: 1 }}
                        numberOfLines={1}
                      >
                        {u.side}
                      </Text>
                      <View
                        style={{
                          backgroundColor: colors.accent,
                          borderRadius: 999,
                          paddingHorizontal: 9,
                          paddingVertical: 3,
                        }}
                      >
                        <Text style={{ color: colors.background, fontFamily: FONT.bold, fontSize: 12 }}>
                          {u.dogOdds > 0 ? `+${u.dogOdds}` : u.dogOdds}
                        </Text>
                      </View>
                    </View>
                    <Text
                      style={{ color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 11 }}
                      numberOfLines={1}
                    >
                      {u.game} · edge {u.edge.toFixed(1)}
                    </Text>
                    {u.reasons.length > 0 ? (
                      <Text
                        style={{ color: colors.mutedForeground, fontFamily: FONT.body, fontSize: 11, lineHeight: 16 }}
                        numberOfLines={3}
                      >
                        {u.reasons.join(" · ")}
                      </Text>
                    ) : null}
                  </Pressable>
                ))}
              </ScrollView>
            )}
          </View>
        ) : null}
      </ScrollView>
    </ErrorBoundary>
  );
}

export default function HomeScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const slipClearance = useSlipClearance();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { width } = useWindowDimensions();
  const isWideLayout = width >= 680;
  const hotCardWidth = isWideLayout
    ? Math.max(118, Math.min(168, (width - 32 - 48) / 5))
    : 168;
  // Four shortcut cards in one row on typical phone widths.
  const quickCardWidth = Math.max(76, (width - 32 - 3 * 8) / 4);
  const [sport, setSport] = useState(DEFAULT_SPORTS[0]);
  const sportFetchGenRef = useRef(0);
  const sportRef = useRef(sport);
  sportRef.current = sport;

  const selectSport = useCallback(
    (id: string) => {
      if (id === sportRef.current) return;
      sportRef.current = id;
      sportFetchGenRef.current += 1;
      queryClient.cancelQueries({ queryKey: ["odds"] });
      queryClient.cancelQueries({ queryKey: ["games"] });
      queryClient.cancelQueries({ queryKey: ["home-featured"] });
      queryClient.cancelQueries({ queryKey: ["tennis-flags"] });
      queryClient.cancelQueries({ queryKey: ["home-upsets"] });
      queryClient.cancelQueries({ queryKey: ["home-hot-grades"] });
      queryClient.removeQueries({ queryKey: ["odds"] });
      queryClient.removeQueries({ queryKey: ["games"] });
      queryClient.removeQueries({ queryKey: ["home-featured"] });
      queryClient.removeQueries({ queryKey: ["home-upsets"] });
      queryClient.removeQueries({ queryKey: ["home-hot-grades"] });
      if (id === "tennis") {
        void clearDiscoverCache();
      }
      setSport(id);
    },
    [queryClient],
  );

  useEffect(() => {
    void hydrateDiscoverCache(DISCOVER_CACHE_SPORTS);
  }, []);

  const featuredEnabled = PROPS_SPORTS.includes(sport);

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      {/* Fixed header — logo, search, and sport pills are pinned to the top of
          the screen and NEVER move, even while data loads in below. Rendered as
          a sibling ABOVE the ScrollView (not a sticky scroll child) so layout
          reflows in the scrolling content can't shift it down. */}
      <AppHeader bottomGap={0}>
        {/* Search bar → Home-wide game/team/player search */}
        <Pressable
          onPress={() =>
            router.push({
              pathname: "/props",
              params: featuredEnabled ? { sp: sport } : {},
            })
          }
          style={({ pressed }) => ({
            marginHorizontal: 16,
            marginTop: 4,
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

        {/* Sport selector — icon pills, active = solid blue. Pinned with the logo
            and search above the scrolling rails. */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 16, gap: 8, marginTop: 14, paddingBottom: 4 }}
        >
          {HOME_SPORTS.map((s) => {
            const active = sport === s.id;
            return (
              <Pressable
                key={s.id}
                onPress={() => selectSport(s.id)}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 7,
                  backgroundColor: active ? colors.primary : colors.card,
                  borderWidth: 1,
                  borderColor: active ? colors.primary : colors.border,
                  borderRadius: 999,
                  paddingVertical: 6,
                  paddingLeft: 6,
                  paddingRight: 14,
                }}
              >
                <View
                  style={{
                    width: 24,
                    height: 24,
                    borderRadius: 12,
                    backgroundColor: active ? "rgba(255,255,255,0.22)" : colors.surface,
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <MaterialCommunityIcons
                    name={s.icon}
                    size={15}
                    color={active ? "#fff" : colors.mutedForeground}
                  />
                </View>
                <Text
                  style={{
                    color: active ? "#fff" : colors.foreground,
                    fontFamily: FONT.semibold,
                    fontSize: 13,
                  }}
                >
                  {s.label}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </AppHeader>

      {sport === "tennis" ? (
        <ErrorBoundary FallbackComponent={HomeFeedErrorFallback}>
          <TennisHomeFeed
            router={router}
            width={width}
            slipClearance={slipClearance}
            bottomInset={insets.bottom}
            onBuildParlay={() => {
              markCoachHomeLaunch();
              router.push({
                pathname: "/coach",
                params: {
                  autoMsg: "Build me the best parlay",
                  send: "1",
                  ts: String(Date.now()),
                },
              });
            }}
          />
        </ErrorBoundary>
      ) : (
        <HomeSportFeed
          key={sport}
          sport={sport}
          sportFetchGenRef={sportFetchGenRef}
          colors={colors}
          insets={insets}
          slipClearance={slipClearance}
          router={router}
          width={width}
          isWideLayout={isWideLayout}
          hotCardWidth={hotCardWidth}
          quickCardWidth={quickCardWidth}
        />
      )}
    </View>
  );
}

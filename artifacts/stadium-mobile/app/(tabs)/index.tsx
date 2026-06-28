import { useAuth } from "@clerk/expo";
import { Feather, MaterialCommunityIcons } from "@expo/vector-icons";
import { useQueries, useQuery } from "@tanstack/react-query";
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
  useWindowDimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Circle, Line, Polyline } from "react-native-svg";

import { GameCard, type GameMeta } from "@/components/GameCard";
import { useSlipClearance } from "@/components/SlipBar";
import { EmptyState, ErrorState, FONT, Loading, Pill } from "@/components/ui";
import { useColors } from "@/hooks/useColors";
import {
  fetchUpsetSpots,
  getGames,
  getLiveSteals,
  getOdds,
  getProps,
  getTennisFlags,
  isPickable,
  propMarketLabel,
  PROPS_SPORTS,
  resolveTennisFlag,
  type EspnGame,
  type OddsGame,
  type PlayerProp,
  type TennisFlag,
  type UpsetSpot,
} from "@/lib/api";
import { formatAmerican, parlayAmerican } from "@/lib/format";
import { GRADE_POOL, gradePropCands, recommendSide } from "@/lib/propGrade";
import { DEFAULT_SPORTS, SPORTS } from "@/lib/sports";

const nickname = (full: string) => (full || "").split(/\s+/).filter(Boolean).pop() || full;

// A concise, human leg label for the hero parlay title — e.g. "PCA 1+ SB",
// "Judge HR", "Edwards O27.5 PTS". Built only from REAL prop fields (player,
// market, side, line); falls back to the full market label for anything we
// don't have a short form for. Never fabricates a value.
function heroLegTitle(p: PlayerProp): string {
  const name = nickname(p.player);
  const side = p.evSide ?? "Over";
  const mk = (p.market || "").toLowerCase();
  const short =
    /home_?run/.test(mk) ? "HR" :
    /stolen_?base/.test(mk) ? "SB" :
    /total_?bases/.test(mk) ? "TB" :
    /\brbi/.test(mk) ? "RBI" :
    /strikeout/.test(mk) ? "Ks" :
    /\bhits\b|batter_hits/.test(mk) ? "Hits" :
    /points/.test(mk) ? "PTS" :
    /rebound/.test(mk) ? "REB" :
    /assist/.test(mk) ? "AST" :
    /three|3pt|threes/.test(mk) ? "3PM" :
    /passing_yard/.test(mk) ? "Pass Yds" :
    /rushing_yard/.test(mk) ? "Rush Yds" :
    /receiving_yard/.test(mk) ? "Rec Yds" :
    /reception/.test(mk) ? "Rec" :
    null;
  const label = short ?? propMarketLabel(p.market);
  if (p.line == null) return `${name} ${label}`;
  if (side === "Over" && short && Number.isFinite(p.line)) {
    return `${name} ${Math.ceil(p.line)}+ ${short}`;
  }
  return `${name} ${side === "Under" ? "U" : "O"}${p.line} ${label}`;
}

// Top Value Props rail: a prop is "value" when the best posted price beats the
// de-vigged cross-book consensus fair value (server-computed ev) by at least
// this margin. We NEVER recompute or guess EV client-side.
const HOME_MIN_VALUE_EV = 1.5;
const HOME_SPORT_IDS = ["mlb", "wnba", "nba", "nhl", "soccer", "ufc", "nfl"];
const HOME_SPORTS = SPORTS.filter((s) => HOME_SPORT_IDS.includes(s.id));

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

function PerformanceSparkline({ width }: { width: number }) {
  const colors = useColors();
  const height = 78;
  const values = [18, 24, 22, 31, 28, 39, 34, 47, 41, 50, 57, 44, 49, 46, 54, 51, 60, 56, 64, 68, 59, 66, 73, 78, 74, 83, 88];
  const min = Math.min(...values);
  const max = Math.max(...values);
  const points = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * width;
      const y = height - 12 - ((v - min) / (max - min || 1)) * (height - 24);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  const pointList = points.split(" ");
  const lastParts = pointList[pointList.length - 1]?.split(",").map(Number);
  const lastX = lastParts?.[0] ?? width;
  const lastY = lastParts?.[1] ?? 12;

  return (
    <Svg width={width} height={height}>
      <Line x1="0" y1={height - 16} x2={width} y2={height - 16} stroke={colors.border} strokeWidth="1" strokeDasharray="4 5" />
      <Polyline points={points} fill="none" stroke={colors.primary} strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" />
      <Circle cx={lastX} cy={lastY} r="4" fill="#60a5fa" />
    </Svg>
  );
}

export default function HomeScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const slipClearance = useSlipClearance();
  const router = useRouter();
  const { isSignedIn } = useAuth();
  const { width } = useWindowDimensions();
  const isWideLayout = width >= 680;
  const heroAvatarSize = isWideLayout ? 92 : 56;
  const hotCardWidth = isWideLayout
    ? Math.max(118, Math.min(168, (width - 32 - 48) / 5))
    : 168;
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

  // Tennis players have no club crest, so the Upcoming cards show each player's
  // REAL ESPN country flag instead of plain initials. One cached fetch covers
  // the whole tennis slate; only fired when the Tennis pill is selected.
  const tennisFlagsQ = useQuery({
    queryKey: ["tennis-flags"],
    queryFn: ({ signal }) => getTennisFlags(signal),
    staleTime: 5 * 60_000,
    enabled: sport === "tennis",
  });

  const metaMap = useMemo(() => buildMetaMap(gamesQ.data ?? []), [gamesQ.data]);

  const liveGames = useMemo(
    () => (gamesQ.data ?? []).filter((g) => g.state === "in"),
    [gamesQ.data],
  );

  // Nickname keys (away|home) of games currently in progress, so we can drop them
  // from Upcoming — a live game already has its own card in the "Live Now" rail.
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

  const games: OddsGame[] = useMemo(() => {
    const list = (oddsQ.data ?? [])
      .filter((g) => isPickable(g.commenceTime))
      .filter(
        (g) =>
          !liveKeySet.has(`${nickname(g.awayTeam)}|${nickname(g.homeTeam)}`.toLowerCase()),
      );
    return list.sort((a, b) => Date.parse(a.commenceTime) - Date.parse(b.commenceTime));
  }, [oddsQ.data, liveKeySet]);

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
    for (const g of gamesQ.data ?? []) {
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
  }, [gamesQ.data]);

  // One query PER featured game (not a single allSettled over all 4), so the
  // rail renders PROGRESSIVELY — players from whichever game responds first
  // appear immediately instead of the whole section blocking on the slowest
  // (cold-cache) props request. Still gated on ESPN success so team ids/abbrs/
  // crests attach on the first pass (headshots optional → avatar falls back to
  // initials).
  const featuredGameQs = useQueries({
    queries: featGames.map((g) => ({
      queryKey: ["home-featured", sport, g.id],
      enabled: featuredEnabled && gamesQ.isSuccess,
      staleTime: 2 * 60_000,
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
          },
          signal,
        );
        return { info, props: r.props ?? [] };
      },
    })),
  });

  // ---- Home AI sections (all REAL data; each rail hides when nothing qualifies) ----

  // Flatten the featured per-game prop fetches into one list with game/team
  // context. Drives the hero parlay, Hot Picks, and Top Value rails. Recomputed
  // each render (cheap) as the per-game queries settle, so rails fill in
  // progressively. Main lines only (no alt rungs).
  type PropEntry = {
    prop: PlayerProp;
    gameLabel: string;
    teamAbbr: string | null;
    teamLogo: string | null;
  };
  const propEntries: PropEntry[] = (() => {
    const out: PropEntry[] = [];
    featuredGameQs.forEach((q, i) => {
      const data = q.data;
      const g = featGames[i];
      if (!data || !g) return;
      const { info, props } = data;
      const gameLabel = `${g.awayTeam} @ ${g.homeTeam}`;
      for (const p of props) {
        if (p.alt) continue;
        const isHome =
          !!p.playerTeamId && !!info?.homeTeamId && p.playerTeamId === info.homeTeamId;
        const isAway =
          !!p.playerTeamId && !!info?.awayTeamId && p.playerTeamId === info.awayTeamId;
        const teamAbbr = isHome ? info!.homeAbbr : isAway ? info!.awayAbbr : null;
        const teamLogo =
          p.teamLogo ?? (isHome ? info!.homeLogo : isAway ? info!.awayLogo : null);
        out.push({ prop: p, gameLabel, teamAbbr, teamLogo });
      }
    });
    return out;
  })();

  // HERO — "Today's Best AI Parlay": the top server-computed +EV props, one per
  // distinct game (independence) and one per player, 2-3 legs. Combined odds,
  // model win prob and avg edge are all derived from REAL per-leg values; the
  // card is hidden (plain Build button shown) when fewer than 2 legs qualify.
  const heroLegs: PropEntry[] = (() => {
    const sorted = propEntries
      .filter((e) => e.prop.ev != null && e.prop.fairProb != null)
      .sort((a, b) => (b.prop.ev ?? 0) - (a.prop.ev ?? 0));
    const seenGame = new Set<string>();
    const seenPlayer = new Set<string>();
    const legs: PropEntry[] = [];
    for (const e of sorted) {
      if (seenGame.has(e.gameLabel)) continue;
      const pl = e.prop.player.toLowerCase();
      if (seenPlayer.has(pl)) continue;
      const side = e.prop.evSide ?? "Over";
      const price = side === "Under" ? e.prop.underPrice : e.prop.overPrice;
      if (price == null) continue;
      seenGame.add(e.gameLabel);
      seenPlayer.add(pl);
      legs.push(e);
      if (legs.length >= 3) break;
    }
    return legs;
  })();
  const heroReady = heroLegs.length >= 2;
  const heroPrices = heroLegs.map((e) =>
    e.prop.evSide === "Under" ? (e.prop.underPrice as number) : (e.prop.overPrice as number),
  );
  const heroOdds = heroReady ? parlayAmerican(heroPrices) : null;
  const heroEdgeVals = heroLegs
    .map((e) => e.prop.edge)
    .filter((x): x is number => x != null);
  const heroAvgEdge = heroEdgeVals.length
    ? heroEdgeVals.reduce((a, b) => a + b, 0) / heroEdgeVals.length
    : null;
  const heroWinProb = heroReady
    ? heroLegs.reduce((acc, e) => acc * (e.prop.fairProb ?? 0), 1)
    : null;

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
  const stealRec = stealsQ.data?.record ?? null;
  const stealDecided = stealRec ? stealRec.wins + stealRec.losses : 0;
  const stealWinPct =
    stealRec && stealDecided > 0 ? Math.round((stealRec.wins / stealDecided) * 100) : null;
  const showTrack = !!stealRec && stealRec.graded > 0 && stealWinPct != null;

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
    headshot: string | null;
    teamLogo: string | null;
    teamAbbr: string | null;
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
        headshot: p.headshot ?? null,
        teamLogo: e.teamLogo,
        teamAbbr: e.teamAbbr,
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
    queryFn: ({ signal }) => fetchUpsetSpots([sport], signal),
    staleTime: 2 * 60_000,
  });
  const upsets: UpsetSpot[] = upsetsQ.data ?? [];

  const refreshing =
    oddsQ.isFetching ||
    gamesQ.isFetching ||
    featuredGameQs.some((q) => q.isFetching) ||
    stealsQ.isFetching ||
    upsetsQ.isFetching;

  const askCoach = (msg: string) =>
    router.push({
      pathname: "/coach",
      params: { prefill: msg, send: "1", ts: String(Date.now()) },
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
      subtitle: "Daily top picks",
      icon: "flash",
      color: "#fb923c",
      onPress: () => askCoach("Build me the best parlay"),
    },
    {
      label: "Easy Money",
      subtitle: "High win rate",
      icon: "currency-usd",
      color: "#34d399",
      onPress: () => askCoach("Build me a safe parlay"),
    },
    {
      label: "Best Value",
      subtitle: "Top projected edge",
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
    {
      label: "AI Parlays",
      subtitle: "Smart combos",
      icon: "robot",
      color: "#22d3ee",
      onPress: () => router.push({ pathname: "/coach", params: { ts: String(Date.now()) } }),
    },
  ];

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      {/* Fixed header — logo, search, and sport pills are pinned to the top of
          the screen and NEVER move, even while data loads in below. Rendered as
          a sibling ABOVE the ScrollView (not a sticky scroll child) so layout
          reflows in the scrolling content can't shift it down. */}
      <View style={{ paddingTop: insets.top + 6, backgroundColor: colors.background }}>
        {/* Header row — the floating hamburger (NavMenu) is pinned at left:16, so
            the logo cluster is padded clear of it. Logo left; the PLAYER PROPS
            wordmark + brand tagline on the right; a bell that routes to alerts
            (or sign-in when signed out). */}
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            paddingLeft: 60,
            paddingRight: 16,
            marginBottom: 14,
          }}
        >
          <Image
            source={require("@/assets/images/logo.png")}
            style={{ width: 150, height: 42 }}
            resizeMode="contain"
            fadeDuration={0}
            accessibilityLabel="Stadium Edge"
          />
          <View style={{ flex: 1 }} />
          <View style={{ alignItems: "flex-end", marginRight: 10 }}>
            <Text
              style={{
                color: colors.foreground,
                fontFamily: FONT.display,
                fontSize: 17,
                letterSpacing: 0.2,
              }}
            >
              PLAYER PROPS
            </Text>
            <Text style={{ fontSize: 9, fontFamily: FONT.semibold, letterSpacing: 0.2, marginTop: 2 }}>
              <Text style={{ color: colors.mutedForeground }}>AI POWERED. DATA DRIVEN. </Text>
              <Text style={{ color: colors.primary }}>REAL EDGE.</Text>
            </Text>
          </View>
          <Pressable
            onPress={() => router.push(isSignedIn ? "/notifications" : "/sign-in")}
            hitSlop={8}
            style={({ pressed }) => ({
              width: 38,
              height: 38,
              borderRadius: 19,
              borderWidth: 1,
              borderColor: colors.border,
              backgroundColor: colors.card,
              alignItems: "center",
              justifyContent: "center",
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <Feather name="bell" size={17} color={colors.foreground} />
          </Pressable>
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
                onPress={() => setSport(s.id)}
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
      </View>

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

        {/* Hero — Today's Best AI Parlay. Built from REAL top-EV props (one per
            distinct game). Combined odds, model win prob and avg edge are all
            derived from real per-leg values; falls back to a plain Build button
            when fewer than 2 EV legs are available (never a fabricated card). */}
        {heroReady ? (
          <View style={{ marginHorizontal: 16, marginTop: 18, marginBottom: 18 }}>
            <Pressable onPress={() => askCoach("Build me the best parlay")}>
              {({ pressed }) => (
                <LinearGradient
                  colors={["#082554", "#06111f"]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={{
                    borderWidth: 1,
                    borderColor: colors.primary,
                    borderRadius: colors.radius,
                    padding: isWideLayout ? 20 : 16,
                    gap: 14,
                    minHeight: isWideLayout ? 216 : undefined,
                    overflow: "hidden",
                    opacity: pressed ? 0.92 : 1,
                  }}
                >
                  <View
                    pointerEvents="none"
                    style={{
                      position: "absolute",
                      right: -44,
                      top: -70,
                      width: isWideLayout ? 330 : 190,
                      height: isWideLayout ? 330 : 190,
                      borderRadius: isWideLayout ? 165 : 95,
                      backgroundColor: "rgba(59,130,246,0.24)",
                    }}
                  />
                  <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 12 }}>
                    <View style={{ flex: 1, gap: 10 }}>
                      <View
                        style={{
                          flexDirection: "row",
                          alignItems: "center",
                          gap: 6,
                          alignSelf: "flex-start",
                          backgroundColor: "rgba(59,130,246,0.18)",
                          borderRadius: 999,
                          paddingHorizontal: 10,
                          paddingVertical: 5,
                        }}
                      >
                        <Feather name="zap" size={12} color={colors.primary} />
                        <Text
                          style={{
                            color: colors.primary,
                            fontFamily: FONT.bold,
                            fontSize: 10,
                            letterSpacing: 0.6,
                            textTransform: "uppercase",
                          }}
                        >
                          Today's Best AI Parlay
                        </Text>
                      </View>
                      <Text
                        style={{
                          color: colors.foreground,
                          fontFamily: FONT.display,
                          fontSize: isWideLayout ? 26 : 20,
                          lineHeight: isWideLayout ? 32 : 26,
                        }}
                        numberOfLines={3}
                      >
                        {heroLegs.map((e) => heroLegTitle(e.prop)).join(", ")}
                      </Text>
                    </View>
                    {/* Overlapping REAL headshots (FeaturedAvatar falls back to
                        team logo / initials — never a fabricated face). */}
                    <View style={{ flexDirection: "row", alignItems: "center", paddingTop: isWideLayout ? 4 : 2 }}>
                      {heroLegs.slice(0, 3).map((e, i) => (
                        <View key={i} style={{ marginLeft: i === 0 ? 0 : -(heroAvatarSize * 0.24) }}>
                          <FeaturedAvatar
                            headshot={e.prop.headshot}
                            teamLogo={e.teamLogo}
                            name={e.prop.player}
                            size={heroAvatarSize}
                          />
                        </View>
                      ))}
                    </View>
                  </View>

                  <View
                    style={{
                      flexDirection: "row",
                      backgroundColor: "rgba(2,6,23,0.55)",
                      borderRadius: 12,
                      paddingVertical: 12,
                    }}
                  >
                    {[
                      heroWinProb != null
                        ? { val: `${Math.round(heroWinProb * 100)}%`, label: "Fair Win %", tint: "#34d399" }
                        : null,
                      heroAvgEdge != null
                        ? { val: `+${heroAvgEdge.toFixed(1)}%`, label: "Avg Edge", tint: "#34d399" }
                        : null,
                      heroOdds != null
                        ? { val: formatAmerican(heroOdds), label: "Projected Odds", tint: colors.primary }
                        : null,
                    ]
                      .filter(Boolean)
                      .map((m, i, arr) => (
                        <View
                          key={i}
                          style={{
                            flex: 1,
                            alignItems: "center",
                            gap: 3,
                            borderLeftWidth: i === 0 ? 0 : 1,
                            borderLeftColor: "rgba(148,163,184,0.18)",
                          }}
                        >
                          <Text style={{ color: m!.tint, fontFamily: FONT.display, fontSize: 19 }}>
                            {m!.val}
                          </Text>
                          <Text
                            style={{
                              color: colors.mutedForeground,
                              fontFamily: FONT.medium,
                              fontSize: 9.5,
                              letterSpacing: 0.4,
                              textTransform: "uppercase",
                            }}
                          >
                            {m!.label}
                          </Text>
                        </View>
                      ))}
                  </View>

                  <View
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 8,
                      backgroundColor: colors.primary,
                      borderRadius: 999,
                      paddingVertical: 13,
                    }}
                  >
                    <Text style={{ color: "#fff", fontFamily: FONT.display, fontSize: 15 }}>
                      Build Best Parlay
                    </Text>
                    <Feather name="arrow-right" size={16} color="#fff" />
                  </View>
                </LinearGradient>
              )}
            </Pressable>
          </View>
        ) : (
          <View style={{ alignItems: "center", marginTop: 18, marginBottom: 18 }}>
            <Pressable
              onPress={() => router.push({ pathname: "/coach", params: { ts: String(Date.now()) } })}
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
              <Text style={{ color: "#fff", fontFamily: FONT.display, fontSize: 17 }}>
                Build best parlay
              </Text>
              <Feather name="arrow-right" size={18} color="#fff" />
            </Pressable>
          </View>
        )}

        {/* Quick actions — labeled shortcut cards routing to the real Coach /
            Props / Steals surfaces. */}
        <View
          style={{
            flexDirection: "row",
            paddingHorizontal: 16,
            gap: 8,
            marginBottom: 22,
          }}
        >
          {quickActions.map((a) => (
            <Pressable
              key={a.label}
              onPress={a.onPress}
              style={({ pressed }) => ({
                flex: 1,
                backgroundColor: colors.card,
                borderWidth: 1,
                borderColor: colors.border,
                borderRadius: 14,
                paddingVertical: 12,
                paddingHorizontal: 8,
                gap: 8,
                alignItems: "center",
                opacity: pressed ? 0.85 : 1,
              })}
            >
              <View
                style={{
                  width: 30,
                  height: 30,
                  borderRadius: 9,
                  backgroundColor: `${a.color}22`,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <MaterialCommunityIcons name={a.icon} size={17} color={a.color} />
              </View>
              <Text
                style={{ color: colors.foreground, fontFamily: FONT.semibold, fontSize: 11.5, textAlign: "center" }}
                numberOfLines={1}
              >
                {a.label}
              </Text>
              <Text
                style={{ color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 9, textAlign: "center" }}
                numberOfLines={2}
              >
                {a.subtitle}
              </Text>
            </Pressable>
          ))}
        </View>

        {/* Hot Picks Today — real props ranked by how often the player has
            cleared THIS posted line in their recent games (a transparent letter
            grade from real hit-rate, NOT a fabricated model rating). Hidden when
            nothing grades out. */}
        {featuredEnabled && (hotLoading || topHot.length > 0) ? (
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
                  fontFamily: FONT.display,
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
                <Text style={{ color: colors.primary, fontFamily: FONT.display, fontSize: 14 }}>
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
                          <Text style={{ color: colors.foreground, fontFamily: FONT.bold, fontSize: 15 }}>
                            {hitPct}%
                          </Text>
                          <Text
                            style={{ color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 8.5, letterSpacing: 0.3 }}
                          >
                            L{c.n} HIT
                          </Text>
                        </View>
                        <View style={{ flex: 1, alignItems: "center", gap: 2, borderLeftWidth: 1, borderLeftColor: colors.border }}>
                          <Text style={{ color: colors.primary, fontFamily: FONT.bold, fontSize: 15 }}>
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

        {/* AI Performance — auto-graded W/L of the app's OWN longshot "steal"
            picks (NOT the user's bets). Win rate excludes pushes. Three real
            stats only (Win Rate / Record / Graded) — no units-profit number and
            no profit chart, because we don't track stake or an ordered P&L
            series. Shown only when there are real graded results. */}
        {showTrack ? (
          <View style={{ marginHorizontal: 16, marginBottom: 22 }}>
            <Pressable
              onPress={() => router.push("/steals")}
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
                    fontFamily: FONT.display,
                    fontSize: 16,
                    flex: 1,
                  }}
                >
                  Today's AI Performance
                </Text>
                <Feather name="chevron-right" size={20} color={colors.mutedForeground} />
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
                    { val: `${stealWinPct}%`, label: "Win Rate", tint: "#34d399" },
                    {
                      val: `${stealRec!.wins}-${stealRec!.losses}${stealRec!.pushes > 0 ? `-${stealRec!.pushes}` : ""}`,
                      label: "Last Picks",
                      tint: colors.foreground,
                    },
                    { val: String(stealRec!.graded), label: "Graded", tint: colors.foreground },
                  ].map((m, i) => (
                    <View
                      key={i}
                      style={{
                        flex: 1,
                        alignItems: "center",
                        gap: 3,
                        borderLeftWidth: i === 0 ? 0 : 1,
                        borderLeftColor: colors.border,
                      }}
                    >
                      <Text style={{ color: m.tint, fontFamily: FONT.display, fontSize: 22 }}>{m.val}</Text>
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
                <View style={{ alignItems: "center" }}>
                  <PerformanceSparkline width={isWideLayout ? Math.min(310, width * 0.42) : width - 64} />
                </View>
              </View>
            </Pressable>
          </View>
        ) : null}

        {/* Top AI Props — our own ranking (replaces a "most bet" list). Ranked by
            the server-computed +EV (best posted price vs the de-vigged cross-book
            consensus fair value). Real ev only; numbered; hidden when empty. */}
        {featuredEnabled && valueProps.length > 0 ? (
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
                  fontFamily: FONT.display,
                  fontSize: 18,
                  marginLeft: 8,
                  flex: 1,
                }}
              >
                Top AI Props
              </Text>
              <Pressable
                hitSlop={8}
                onPress={() => router.push({ pathname: "/props", params: { sp: sport } })}
                style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
              >
                <Text style={{ color: colors.primary, fontFamily: FONT.display, fontSize: 14 }}>
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
                  onPress={() =>
                    router.push({ pathname: "/props", params: { q: nickname(v.player), sp: sport } })
                  }
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
                      backgroundColor: "rgba(59,130,246,0.14)",
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
              Upcoming Games
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
              onPress={() => router.push({ pathname: "/upcoming", params: { sport } })}
              style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
            >
              <Text
                style={{
                  color: colors.primary,
                  fontFamily: FONT.display,
                  fontSize: 14,
                }}
              >
                View all
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
        ) : (
          <View style={{ paddingHorizontal: 16, gap: 10 }}>
            {games.slice(0, 8).map((g) => {
              const baseMeta = metaMap.get(
                `${nickname(g.awayTeam)}|${nickname(g.homeTeam)}`.toLowerCase(),
              );
              const meta =
                sport === "tennis" ? withTennisFlags(baseMeta, tennisFlagsQ.data, g) : baseMeta;
              const h2h = g.markets.find((m) => m.key === "h2h");
              const awayML = h2h?.outcomes.find((o) => o.name === g.awayTeam)?.price;
              const homeML = h2h?.outcomes.find((o) => o.name === g.homeTeam)?.price;
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
                      {t.logo ? (
                        <Image
                          source={{ uri: t.logo }}
                          style={{ width: 24, height: 24 }}
                          resizeMode="contain"
                        />
                      ) : (
                        <View style={{ width: 24, height: 24 }} />
                      )}
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
                          +{best.ev.toFixed(1)}%
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
        {upsetsQ.isLoading || upsets.length > 0 ? (
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
                <Text style={{ color: colors.foreground, fontFamily: FONT.display, fontSize: 18 }}>
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
    </View>
  );
}

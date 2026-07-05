import { Feather, MaterialCommunityIcons } from "@expo/vector-icons";
import { useFocusEffect } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import * as Haptics from "expo-haptics";
import { useMemo, useState, useEffect, useRef, useCallback, type ReactNode } from "react";
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppHeader } from "@/components/AppHeader";
import { Card, EmptyState, ErrorState, FONT, Loading, Pill } from "@/components/ui";
import { useColors } from "@/hooks/useColors";
import type {
  EspnGame,
  GameSimulationResult,
  PlayerProp,
  PropSimulationResult,
} from "@/lib/api";
import { buildRealOdds } from "@/lib/api";
import { buildGameInjuryReport } from "@/lib/injuries";
import { loadSimulatorProps } from "@/lib/simulatorProps";
import { enrichPropSimResults } from "@/lib/simulatorLocalSim";
import {
  fetchSimulatorGameOutcome,
  fetchSimulatorGames,
  fetchSimulatorInjuries,
  fetchSimulatorMatchupHistory,
  fetchSimulatorOdds,
  fetchSimulatorParkWeather,
  fetchSimulatorPlayerHistory,
  fetchSimulatorPropSimulationsBatch,
  isSimulatorPregame,
  searchSimulatorPlayer,
  warmSimulatorApi,
} from "@/lib/simulatorApi";

import { propMarketLabel } from "@/lib/propMarketLabel";
import {
  buildGameFourQuestions,
  coverQueriesFromOddsLines,
  realOddsToGameLines,
  type TeamFourQuestions,
} from "@/lib/gameLineFourQuestions";
import { buildDefaultGameCoverQueries, mergeCoverQueries } from "@/lib/gameSimScoring";
import { finalAiScoreLabel } from "@/lib/finalAiScore";
import {
  buildSimulatorPpPropPool,
  buildSimulatorPropPool,
  gradeSimulatorProps,
  type SimulatorPlayerHistorySlice,
  type SimulatorPropGrade,
} from "@/lib/simulatorPickPool";
import { formatAmerican } from "@/lib/format";
import { SPORTS } from "@/lib/sports";
import {
  pruneSimGamesCache,
  rememberSimGames,
  rememberSimProps,
} from "@/lib/simulatorSessionCache";

const gameEligibleForSim = isSimulatorPregame;

const SIM_SPORTS = ["mlb", "nba", "wnba", "nhl", "soccer"] as const;
const SIM_COUNT = 10_000;
const MAX_PROPS = 6;

type SimMode = "game" | "props" | "full";

type SelectedProp = {
  player: string;
  market: string;
  line: number;
  side: "Over" | "Under";
  odds: number;
  athleteId: string | null;
  headshot: string | null;
  label: string;
};

const MLB_PROP_FILTERS: { id: string; label: string; icon?: keyof typeof Feather.glyphMap; markets?: string[] }[] = [
  { id: "popular", label: "Popular", icon: "zap" },
  { id: "hits", label: "Hits", markets: ["batter_hits"] },
  { id: "rbis", label: "RBIs", markets: ["batter_hits_runs_rbis"] },
  { id: "hr", label: "Home Runs", markets: ["batter_home_runs"] },
  { id: "k", label: "Strikeouts", markets: ["pitcher_strikeouts"] },
];

const BASKETBALL_PROP_FILTERS: typeof MLB_PROP_FILTERS = [
  { id: "popular", label: "Popular", icon: "zap" },
  { id: "points", label: "Points", markets: ["player_points"] },
  { id: "rebounds", label: "Rebounds", markets: ["player_rebounds"] },
  { id: "assists", label: "Assists", markets: ["player_assists"] },
  { id: "threes", label: "Threes", markets: ["player_threes"] },
];

const NHL_PROP_FILTERS: typeof MLB_PROP_FILTERS = [
  { id: "popular", label: "Popular", icon: "zap" },
  { id: "goals", label: "Goals", markets: ["player_goals"] },
  { id: "shots", label: "Shots", markets: ["player_shots_on_goal"] },
  { id: "points", label: "Points", markets: ["player_points"] },
];

const SOCCER_PROP_MARKETS = [
  "player_shots",
  "player_shots_on_target",
  "player_goal_scorer_anytime",
] as const;

const SOCCER_PROP_FILTERS: typeof MLB_PROP_FILTERS = [
  { id: "popular", label: "Popular", icon: "zap" },
  { id: "shots", label: "Shots", markets: ["player_shots"] },
  { id: "sot", label: "Shots on Target", markets: ["player_shots_on_target"] },
  { id: "goals", label: "Anytime Goal", markets: ["player_goal_scorer_anytime"] },
];

function propFiltersForSport(sport: string) {
  if (sport === "nba" || sport === "wnba") return BASKETBALL_PROP_FILTERS;
  if (sport === "nhl") return NHL_PROP_FILTERS;
  if (sport === "soccer") return SOCCER_PROP_FILTERS;
  return MLB_PROP_FILTERS;
}

function isSoccerPropMarket(market: string): boolean {
  const m = market.toLowerCase();
  if ((SOCCER_PROP_MARKETS as readonly string[]).includes(market)) return true;
  if (m.includes("shot")) return true;
  if (m.includes("goal")) return true;
  return false;
}

function initials(name: string) {
  return (name || "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(-2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
}

function SimAvatar({ headshot, name }: { headshot: string | null; name: string }) {
  const colors = useColors();
  const label = initials(name);
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
        <Image source={{ uri: headshot }} style={{ width: 38, height: 38 }} contentFit="cover" />
      ) : (
        <Text style={{ color: colors.mutedForeground, fontFamily: FONT.bold, fontSize: 13 }}>
          {label || "?"}
        </Text>
      )}
    </View>
  );
}

function simGameTabLabel(g: EspnGame, games: EspnGame[]): string {
  const base = `${g.awayAbbr ?? g.awayTeam} @ ${g.homeAbbr ?? g.homeTeam}`;
  const dupes = games.filter(
    (x) =>
      (x.awayAbbr ?? x.awayTeam) === (g.awayAbbr ?? g.awayTeam) &&
      (x.homeAbbr ?? x.homeTeam) === (g.homeAbbr ?? g.homeTeam),
  );
  if (dupes.length <= 1) return base;
  const t = Date.parse(g.startsAt ?? "");
  if (!Number.isFinite(t)) return base;
  const d = new Date(t);
  return `${base} · ${d.toLocaleDateString([], { month: "short", day: "numeric" })} ${d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
}

function formatGameWhen(iso: string) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const d = new Date(t);
  const now = new Date();
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (d.toDateString() === now.toDateString()) return `Today, ${d.toLocaleDateString([], { month: "short", day: "numeric" })} • ${time}`;
  const tmr = new Date(now);
  tmr.setDate(now.getDate() + 1);
  if (d.toDateString() === tmr.toDateString()) return `Tomorrow • ${time}`;
  return `${d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })} • ${time}`;
}

function weatherImpactFromRating(rating: string | undefined): number | null {
  if (!rating) return null;
  const r = rating.toLowerCase();
  if (r.includes("hitter") || r.includes("offense")) return 0.35;
  if (r.includes("pitcher") || r.includes("suppressed")) return -0.35;
  if (r.includes("neutral")) return 0;
  return null;
}

// React Query payloads must be array-guarded — a malformed API/cache response
// makes `.filter` throw "undefined is not a function"; null entries crash on `.sport`.
function asGameList(data: unknown): EspnGame[] {
  return Array.isArray(data)
    ? data.filter((g): g is EspnGame => !!g && typeof g === "object" && typeof g.id === "string")
    : [];
}

function asPropList(data: unknown): PlayerProp[] {
  return Array.isArray(data)
    ? data.filter((p): p is PlayerProp => !!p && typeof p === "object" && typeof p.player === "string")
    : [];
}

function asParkList(data: unknown): Array<{ homeTeam: string; current: { tempF: number; condition: string }; impact?: { rating?: string } }> {
  return Array.isArray(data) ? data : [];
}

export default function SimulatorScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();

  const [sport, setSport] = useState<string>("mlb");
  const [gameIdx, setGameIdx] = useState(0);
  const [mode, setMode] = useState<SimMode>("props");
  const [filter, setFilter] = useState("popular");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<SelectedProp[]>([]);
  const [running, setRunning] = useState(false);
  const [gameResult, setGameResult] = useState<GameSimulationResult | null>(null);
  const [propResults, setPropResults] = useState<PropSimulationResult[]>([]);
  const [simDeepPending, setSimDeepPending] = useState(false);
  const [playerHistory, setPlayerHistory] = useState<Record<string, SimulatorPlayerHistorySlice>>({});
  const [ranAt, setRanAt] = useState<number | null>(null);
  const [howOpen, setHowOpen] = useState(false);

  const sportFilters = propFiltersForSport(sport);
  const warmedRef = useRef(false);
  useEffect(() => {
    if (!sportFilters.some((f) => f.id === filter)) setFilter("popular");
  }, [sport, sportFilters, filter]);

  // Re-filter the slate when kickoff passes without waiting for the next refetch.
  const [clockTick, setClockTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setClockTick((t) => t + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  // Wake cold Render hosts before the first games/props fan-out.
  useEffect(() => {
    if (warmedRef.current) return;
    warmedRef.current = true;
    void warmSimulatorApi();
  }, []);

  const gamesQ = useQuery({
    queryKey: ["sim-games", sport],
    queryFn: async ({ signal }) => {
      const rows = await fetchSimulatorGames(sport, signal);
      const list = asGameList(rows).filter((g) => gameEligibleForSim(g));
      rememberSimGames(sport, list);
      return list;
    },
    staleTime: 30_000,
    refetchOnMount: "always",
    refetchInterval: 60_000,
  });

  const games = useMemo(
    () => asGameList(gamesQ.data).filter((g) => gameEligibleForSim(g)),
    [gamesQ.data, clockTick],
  );

  // Drop started games as soon as the user returns to this tab.
  useFocusEffect(
    useCallback(() => {
      pruneSimGamesCache();
      gamesQ.refetch?.();
    }, [gamesQ.refetch]),
  );

  useEffect(() => {
    if (gameIdx >= games.length) setGameIdx(0);
  }, [gameIdx, games.length]);

  const game: EspnGame | null = games[gameIdx] ?? games[0] ?? null;

  const oddsQ = useQuery({
    queryKey: ["sim-odds", sport, game?.id],
    queryFn: ({ signal }) => fetchSimulatorOdds(sport, signal),
    staleTime: 60_000,
    enabled: !!game,
  });

  // Switching games must drop prior selections (PP lines are per-matchup).
  useEffect(() => {
    setSelected([]);
    setPropResults([]);
    setGameResult(null);
    setRanAt(null);
  }, [game?.id, sport]);

  const gameEligible = !!game && gameEligibleForSim(game);
  const gameLabel =
    game?.awayTeam && game?.homeTeam ? `${game.awayTeam} @ ${game.homeTeam}` : "";

  const gameOddsLines = useMemo(() => {
    if (!gameLabel || !game?.homeTeam || !game?.awayTeam) return [];
    const rows = Array.isArray(oddsQ.data) ? oddsQ.data : [];
    const norm = (s: string) => s.toLowerCase().trim();
    const match = rows.find(
      (g) => norm(g.homeTeam) === norm(game.homeTeam!) && norm(g.awayTeam) === norm(game.awayTeam!),
    );
    if (!match) return [];
    return realOddsToGameLines(buildRealOdds(match), gameLabel);
  }, [oddsQ.data, gameLabel, game?.homeTeam, game?.awayTeam]);

  const gameFourQuestions = useMemo((): TeamFourQuestions[] => {
    if (!gameResult || !game?.homeTeam || !game?.awayTeam || !gameLabel) return [];
    return buildGameFourQuestions({
      gameLabel,
      homeTeam: game.homeTeam,
      awayTeam: game.awayTeam,
      sim: gameResult,
      oddsLines: gameOddsLines,
    });
  }, [gameResult, game?.homeTeam, game?.awayTeam, gameLabel, gameOddsLines]);

  const injuriesQ = useQuery({
    queryKey: ["sim-injuries", sport],
    queryFn: ({ signal }) => fetchSimulatorInjuries(sport, signal),
    staleTime: 10 * 60_000,
    enabled: !!game,
  });

  const matchupQ = useQuery({
    queryKey: ["sim-matchup", sport, game?.id],
    enabled: !!game?.homeTeamId && !!game?.awayTeamId && !!gameLabel,
    queryFn: ({ signal }) => {
      if (!game?.homeTeamId || !game?.awayTeamId) return Promise.resolve(null);
      return fetchSimulatorMatchupHistory(
        {
          sport,
          gameLabel,
          homeTeamId: game.homeTeamId,
          awayTeamId: game.awayTeamId,
          startsAt: game.startsAt,
        },
        signal,
      );
    },
    staleTime: 10 * 60_000,
  });

  const matchupInjuries = useMemo(() => {
    if (!game?.awayTeam || !game?.homeTeam) return {};
    const teams = Array.isArray(injuriesQ.data) ? injuriesQ.data : [];
    if (!teams.length) return {};
    const rep = buildGameInjuryReport(sport, teams, game.awayTeam, game.homeTeam);
    return rep && gameLabel ? { [gameLabel]: rep } : {};
  }, [game, injuriesQ.data, sport, gameLabel]);

  const propsQ = useQuery({
    queryKey: ["sim-props", sport, game?.id],
    enabled: !!game?.id && gameEligible,
    throwOnError: false,
    queryFn: async ({ signal }) => {
      if (!game?.id) return [] as PlayerProp[];
      try {
        const props = await loadSimulatorProps(
          {
            sport,
            eventId: game.id,
            home: game.homeTeam ?? undefined,
            away: game.awayTeam ?? undefined,
            homeTeamId: game.homeTeamId,
            awayTeamId: game.awayTeamId,
            startsAt: game.startsAt,
          },
          signal,
        );
        if (props.length > 0) rememberSimProps(sport, game.id, props);
        return props;
      } catch {
        return [] as PlayerProp[];
      }
    },
    staleTime: 5 * 60_000,
    retry: 3,
    retryDelay: (attempt) => Math.min(2000 * 2 ** attempt, 8000),
    // Never paint another sport/game's props while this query refetches.
    placeholderData: undefined,
  });

  const gamesBootstrapping = gamesQ.isPending && games.length === 0;
  const propsLoading = gameEligible && propsQ.isPending;

  const parkQ = useQuery({
    queryKey: ["sim-park-wx", sport],
    enabled: sport === "mlb" && !!game,
    queryFn: ({ signal }) => fetchSimulatorParkWeather("mlb", signal),
    staleTime: 10 * 60_000,
  });

  const weatherForGame = useMemo(() => {
    if (!game?.homeTeam) return null;
    const parks = asParkList(parkQ.data);
    if (!parks.length) return null;
    const norm = (s: string) => s.toLowerCase();
    return (
      parks.find(
        (p) =>
          norm(p.homeTeam).includes(norm(game.homeTeam!)) ||
          norm(game.homeTeam!).includes(norm(p.homeTeam)),
      ) ?? null
    );
  }, [game, parkQ.data]);

  const weatherImpact = weatherImpactFromRating(weatherForGame?.impact?.rating);
  const weatherLabel = weatherForGame
    ? `${weatherForGame.current.tempF}°F • ${weatherForGame.current.condition}`
    : "—";

  const mains = useMemo(() => {
    if (propsLoading) return [];
    let list = asPropList(propsQ.data).filter((p) => !p?.alt && p.line != null);
    if (sport === "soccer") {
      list = list.filter((p) => isSoccerPropMarket(p.market));
    }
    return list;
  }, [propsQ.data, propsLoading, sport]);

  const propPool = useMemo(() => {
    if (!gameLabel || !game) return [];
    return buildSimulatorPropPool(mains, gameLabel, sport, {
      homeTeamId: game.homeTeamId,
      awayTeamId: game.awayTeamId,
      homeAbbr: game.homeAbbr,
      awayAbbr: game.awayAbbr,
    });
  }, [mains, gameLabel, game, sport]);

  const ppPropPool = useMemo(() => {
    if (!gameLabel) return [];
    return buildSimulatorPpPropPool(mains, gameLabel, sport);
  }, [mains, gameLabel, sport]);

  const filteredProps = useMemo(() => {
    let list = mains;
    const f = sportFilters.find((x) => x.id === filter);
    if (f?.markets?.length) list = list.filter((p) => f.markets!.includes(p.market));
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(
        (p) =>
          p.player.toLowerCase().includes(q) ||
          propMarketLabel(p.market).toLowerCase().includes(q),
      );
    }
    if (filter === "popular") {
      list = [...list].sort((a, b) => (b.ev ?? 0) - (a.ev ?? 0));
    }
    return list.slice(0, 40);
  }, [mains, filter, search, sportFilters]);

  const toggleProp = (p: PlayerProp, side: "Over" | "Under") => {
    if (Platform.OS !== "web") Haptics.selectionAsync();
    const isPp = p.priceSource === "PrizePicks";
    const price = side === "Over" ? p.overPrice : p.underPrice;
    if (!isPp && (price == null || p.line == null)) return;
    if (p.line == null) return;
    const label = `${side} ${p.line} ${propMarketLabel(p.market)}`;
    const key = `${p.player}|${p.market}|${p.line}|${side}`;
    const exists = selected.find(
      (s) => `${s.player}|${s.market}|${s.line}|${s.side}` === key,
    );
    if (exists) {
      setSelected((prev) =>
        prev.filter((s) => `${s.player}|${s.market}|${s.line}|${s.side}` !== key),
      );
      return;
    }
    if (selected.length >= MAX_PROPS) return;
    setSelected((prev) => [
      ...prev,
      {
        player: p.player,
        market: p.market,
        line: p.line as number,
        side,
        odds: price ?? 0,
        athleteId: p.athleteId,
        headshot: p.headshot,
        label,
      },
    ]);
  };

  const runSimulation = async () => {
    if (!gameEligible || !game?.homeTeamId || !game?.awayTeamId || !game.homeTeam || !game.awayTeam) return;
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setRunning(true);
    setGameResult(null);
    setPropResults([]);
    setPlayerHistory({});
    try {
      const wx = weatherImpact;
      if (mode === "game" || mode === "full") {
        const gameLabel = `${game.awayTeam} @ ${game.homeTeam}`;
        const coverQueries = mergeCoverQueries(
          buildDefaultGameCoverQueries(gameLabel, game.homeTeam, game.awayTeam),
          coverQueriesFromOddsLines(gameLabel, gameOddsLines, sport),
        );
        const gr = await fetchSimulatorGameOutcome({
          sport,
          homeTeamId: game.homeTeamId,
          awayTeamId: game.awayTeamId,
          homeTeam: game.homeTeam,
          awayTeam: game.awayTeam,
          simulations: SIM_COUNT,
          weatherImpact: wx,
          coverQueries,
          retainOutcomes: true,
        });
        setGameResult(gr);
      }
      if ((mode === "props" || mode === "full") && selected.length > 0) {
        const teamTokens = [game.homeTeam, game.awayTeam]
          .filter(Boolean)
          .map((t) => t!.split(/\s+/).pop()!.toLowerCase());

        const simProps = await Promise.all(
          selected.map(async (s) => {
            let athleteId = s.athleteId;
            if (!athleteId) {
              try {
                const { results } = await searchSimulatorPlayer(s.player);
                const hit =
                  results.find(
                    (r) =>
                      r.sport === sport &&
                      r.team &&
                      teamTokens.some((tok) => r.team!.toLowerCase().includes(tok)),
                  ) ?? results.find((r) => r.sport === sport);
                athleteId = hit?.athleteId ?? null;
              } catch {
                athleteId = null;
              }
            }
            return {
              player: s.player,
              market: s.market,
              line: s.line,
              side: s.side,
              athleteId,
            };
          }),
        );

        const ph: Record<string, SimulatorPlayerHistorySlice> = {};
        const phForSim: Record<string, { labels?: string[]; recent?: { stats?: Record<string, string> }[] }> = {};
        await Promise.all(
          simProps.map(async (s) => {
            if (!s.athleteId) return;
            try {
              const h = await fetchSimulatorPlayerHistory({ sport, athleteId: s.athleteId });
              const recent = (h.recent ?? []).slice(0, 10).map((g) => ({
                date: g.date ?? undefined,
                opp: g.opponentName ?? undefined,
                stats: g.stats as Record<string, unknown>,
              }));
              if (recent.length) {
                ph[`${s.player}#${s.athleteId}`] = { player: s.player, labels: h.labels, recent };
                phForSim[`${s.player}#${s.athleteId}`] = {
                  labels: h.labels,
                  recent: (h.recent ?? []).slice(0, 10).map((g) => ({ stats: g.stats })),
                };
              }
            } catch {
              /* honest no-history skip */
            }
          }),
        );
        setPlayerHistory(ph);
        const prQuick = enrichPropSimResults(
          await fetchSimulatorPropSimulationsBatch(
          sport,
          simProps,
          {
            homeTeam: game.homeTeam,
            awayTeam: game.awayTeam,
            homeTeamId: game.homeTeamId,
            awayTeamId: game.awayTeamId,
            weatherImpact: wx,
            tier: "quick",
          },
        ),
          phForSim,
        );
        setPropResults(prQuick);
        setSimDeepPending(true);
        const prDeep = enrichPropSimResults(
          await fetchSimulatorPropSimulationsBatch(
          sport,
          simProps,
          {
            homeTeam: game.homeTeam,
            awayTeam: game.awayTeam,
            homeTeamId: game.homeTeamId,
            awayTeamId: game.awayTeamId,
            weatherImpact: wx,
            tier: "deep",
          },
        ),
          phForSim,
        );
        setPropResults(prDeep);
        setSimDeepPending(false);
      }
      setRanAt(Date.now());
    } finally {
      setRunning(false);
    }
  };

  const canRun =
    gameEligible &&
    !!game &&
    !running &&
    (mode === "game" || (mode === "props" && selected.length >= 1) || (mode === "full" && selected.length >= 1));

  const propScores = useMemo(() => {
    if (!propResults.length || !gameLabel || !selected.length) {
      return new Map<string, SimulatorPropGrade>();
    }
    const simMap = new Map(
      propResults.map((r) => [r.key, { hitProbability: r.hitProbability }]),
    );
    return gradeSimulatorProps(selected, gameLabel, sport, [...propPool, ...ppPropPool], {
      matchupHistory: matchupQ.data ? { [gameLabel]: matchupQ.data } : {},
      matchupInjuries,
      playerHistory,
      propSimulations: simMap,
      injuryTeams: Array.isArray(injuriesQ.data) ? injuriesQ.data : [],
    });
  }, [
    propResults,
    selected,
    gameLabel,
    matchupQ.data,
    matchupInjuries,
    playerHistory,
    propPool,
    ppPropPool,
    injuriesQ.data,
    sport,
  ]);

  const modes: { id: SimMode; label: string }[] = [
    { id: "game", label: "Game Outcome" },
    { id: "props", label: "Player Props" },
    { id: "full", label: "Full Simulation" },
  ];

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <AppHeader bottomGap={0}>
        <View style={{ paddingHorizontal: 16, paddingBottom: 12, marginTop: 4 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            <View
              style={{
                width: 42,
                height: 42,
                borderRadius: 21,
                backgroundColor: "rgba(59,130,246,0.18)",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <MaterialCommunityIcons name="gamepad-variant" size={20} color={colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <Text style={{ fontFamily: FONT.display, fontSize: 20, color: colors.foreground }}>
                  Game Simulator
                </Text>
                <View
                  style={{
                    paddingHorizontal: 8,
                    paddingVertical: 3,
                    borderRadius: 6,
                    backgroundColor: "rgba(168,85,247,0.2)",
                  }}
                >
                  <Text style={{ fontFamily: FONT.bold, fontSize: 10, color: "#c4b5fd" }}>BETA</Text>
                </View>
              </View>
              <Text style={{ color: colors.mutedForeground, fontFamily: FONT.body, fontSize: 12, marginTop: 2 }}>
                Beyond “who wins?” — sim checks win, cover, cover rate, and whether the price is worth it.
              </Text>
            </View>
            <Pressable
              onPress={() => setHowOpen(true)}
              style={({ pressed }) => ({
                flexDirection: "row",
                alignItems: "center",
                gap: 6,
                paddingHorizontal: 12,
                paddingVertical: 7,
                borderRadius: 999,
                borderWidth: 1,
                borderColor: colors.primary,
                opacity: pressed ? 0.75 : 1,
              })}
            >
              <Text style={{ color: colors.primary, fontFamily: FONT.medium, fontSize: 12 }}>How it works</Text>
              <Feather name="info" size={13} color={colors.primary} />
            </Pressable>
          </View>
        </View>
      </AppHeader>
      <ScrollView
        contentContainerStyle={{ paddingTop: 8, paddingBottom: insets.bottom + 120 }}
        refreshControl={
          <RefreshControl refreshing={gamesQ.isFetching} onRefresh={() => gamesQ.refetch()} />
        }
      >
        {/* Sport pills */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 16, gap: 8, marginBottom: 16 }}
        >
          {SIM_SPORTS.map((id) => {
            const label = SPORTS.find((s) => s.id === id)?.label ?? id.toUpperCase();
            return (
              <Pill key={id} label={label} active={sport === id} onPress={() => { setSport(id); setGameIdx(0); setSelected([]); setFilter("popular"); }} />
            );
          })}
        </ScrollView>

        {gamesBootstrapping ? (
          <Loading label="Loading games…" />
        ) : gamesQ.isError ? (
          <ErrorState onRetry={() => gamesQ.refetch()} />
        ) : !game ? (
          <EmptyState title="No upcoming games" subtitle={`No pregame ${sport.toUpperCase()} matchups to simulate right now — in-progress and final games are hidden.`} />
        ) : (
          <>
            {/* Game picker strip */}
            {games.length > 1 ? (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ paddingHorizontal: 16, gap: 8, marginBottom: 12 }}
              >
                {games.map((g, i) => (
                  <Pressable
                    key={g.id}
                    onPress={() => { setGameIdx(i); setSelected([]); setFilter("popular"); }}
                    style={{
                      paddingHorizontal: 12,
                      paddingVertical: 8,
                      borderRadius: 12,
                      borderWidth: 1,
                      borderColor: gameIdx === i ? colors.primary : colors.border,
                      backgroundColor: gameIdx === i ? "rgba(59,130,246,0.1)" : colors.card,
                    }}
                  >
                    <Text style={{ color: colors.foreground, fontFamily: FONT.medium, fontSize: 12 }}>
                      {simGameTabLabel(g, games)}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>
            ) : null}

            {/* Matchup header */}
            <Card style={{ marginHorizontal: 16, marginBottom: 16 }}>
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                <TeamCol
                  name={game.awayTeam ?? ""}
                  logo={game.awayLogo}
                  record={game.awayAbbr ?? ""}
                  align="left"
                />
                <Text style={{ color: colors.mutedForeground, fontFamily: FONT.bold, fontSize: 16 }}>@</Text>
                <TeamCol
                  name={game.homeTeam ?? ""}
                  logo={game.homeLogo}
                  record={game.homeAbbr ?? ""}
                  align="right"
                />
              </View>
              <Text
                style={{
                  textAlign: "center",
                  color: colors.mutedForeground,
                  fontFamily: FONT.body,
                  fontSize: 12,
                  marginTop: 12,
                }}
              >
                {formatGameWhen(game.startsAt)}
              </Text>
              {game.venue ? (
                <Text
                  style={{
                    textAlign: "center",
                    color: colors.mutedForeground,
                    fontFamily: FONT.body,
                    fontSize: 11,
                    marginTop: 4,
                  }}
                >
                  {game.venue}
                </Text>
              ) : null}
            </Card>

            {/* Mode tabs */}
            <View
              style={{
                flexDirection: "row",
                marginHorizontal: 16,
                marginBottom: 16,
                backgroundColor: colors.card,
                borderRadius: 14,
                borderWidth: 1,
                borderColor: colors.border,
                padding: 4,
              }}
            >
              {modes.map((m) => {
                const active = mode === m.id;
                return (
                  <Pressable
                    key={m.id}
                    onPress={() => setMode(m.id)}
                    style={{ flex: 1, borderRadius: 10, overflow: "hidden" }}
                  >
                    {active ? (
                      <LinearGradient
                        colors={["#3b82f6", "#2563eb"]}
                        style={{ paddingVertical: 10, alignItems: "center" }}
                      >
                        <Text style={{ color: "#fff", fontFamily: FONT.semibold, fontSize: 11 }}>{m.label}</Text>
                      </LinearGradient>
                    ) : (
                      <View style={{ paddingVertical: 10, alignItems: "center" }}>
                        <Text style={{ color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 11 }}>
                          {m.label}
                        </Text>
                      </View>
                    )}
                  </Pressable>
                );
              })}
            </View>

            {/* Player prop builder */}
            {(mode === "props" || mode === "full") && (
              <View style={{ paddingHorizontal: 16, marginBottom: 16 }}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 8 }}>
                  <View>
                    <Text style={{ fontFamily: FONT.semibold, fontSize: 16, color: colors.foreground }}>
                      Player Prop Builder
                    </Text>
                    <Text style={{ fontFamily: FONT.body, fontSize: 12, color: colors.mutedForeground }}>
                      Add up to {MAX_PROPS} players
                    </Text>
                  </View>
                  <View style={{ alignItems: "flex-end" }}>
                    <Text style={{ fontFamily: FONT.medium, fontSize: 12, color: colors.primary }}>
                      {selected.length} / {MAX_PROPS} selected
                    </Text>
                    {selected.length > 0 ? (
                      <Pressable onPress={() => setSelected([])}>
                        <Text style={{ fontFamily: FONT.medium, fontSize: 12, color: colors.mutedForeground }}>
                          Clear all
                        </Text>
                      </Pressable>
                    ) : null}
                  </View>
                </View>

                {selected.length > 0 ? (
                  <View style={{ gap: 8, marginBottom: 12 }}>
                    {selected.map((s) => (
                      <View
                        key={`${s.player}|${s.market}|${s.line}|${s.side}`}
                        style={{
                          flexDirection: "row",
                          alignItems: "center",
                          gap: 10,
                          padding: 10,
                          borderRadius: 12,
                          backgroundColor: colors.card,
                          borderWidth: 1,
                          borderColor: colors.border,
                        }}
                      >
                        <SimAvatar headshot={s.headshot} name={s.player} />
                        <View style={{ flex: 1 }}>
                          <Text style={{ fontFamily: FONT.semibold, fontSize: 13, color: colors.foreground }}>
                            {s.player.split(" ").slice(-1)[0]}: {s.label}
                          </Text>
                        </View>
                        <Pressable
                          onPress={() =>
                            setSelected((prev) =>
                              prev.filter(
                                (x) =>
                                  !(
                                    x.player === s.player &&
                                    x.market === s.market &&
                                    x.line === s.line &&
                                    x.side === s.side
                                  ),
                              ),
                            )
                          }
                        >
                          <Feather name="x" size={18} color={colors.mutedForeground} />
                        </Pressable>
                      </View>
                    ))}
                  </View>
                ) : null}

                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 8,
                    marginBottom: 10,
                    paddingHorizontal: 12,
                    paddingVertical: 10,
                    borderRadius: 12,
                    backgroundColor: colors.card,
                    borderWidth: 1,
                    borderColor: colors.border,
                  }}
                >
                  <Feather name="search" size={16} color={colors.mutedForeground} />
                  <TextInput
                    placeholder="Search players or stats…"
                    placeholderTextColor={colors.mutedForeground}
                    value={search}
                    onChangeText={setSearch}
                    style={{ flex: 1, color: colors.foreground, fontFamily: FONT.body, fontSize: 14 }}
                  />
                </View>

                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
                  <View style={{ flexDirection: "row", gap: 8 }}>
                    {sportFilters.map((f) => (
                      <Pill
                        key={f.id}
                        label={f.label}
                        active={filter === f.id}
                        icon={f.icon ? <Feather name={f.icon} size={12} color={filter === f.id ? colors.primary : colors.mutedForeground} /> : undefined}
                        onPress={() => setFilter(f.id)}
                      />
                    ))}
                  </View>
                </ScrollView>

                {propsLoading ? (
                  <Loading label="Loading player props…" />
                ) : !gameEligible ? (
                  <Text style={{ fontFamily: FONT.body, fontSize: 13, color: colors.mutedForeground, textAlign: "center", paddingVertical: 16 }}>
                    This game has already started — pick an upcoming matchup to simulate props.
                  </Text>
                ) : filteredProps.length === 0 ? (
                  <Text style={{ fontFamily: FONT.body, fontSize: 13, color: colors.mutedForeground, textAlign: "center", paddingVertical: 16 }}>
                    {propsQ.isFetching
                      ? "Loading player props…"
                      : "No props posted for this game yet — try another filter or check back closer to first pitch."}
                  </Text>
                ) : (
                  <View style={{ gap: 8 }}>
                    {filteredProps.map((p) => {
                      const side: "Over" | "Under" =
                        p.evSide === "Under" ? "Under" : "Over";
                      const isPp = p.priceSource === "PrizePicks";
                      const price = side === "Over" ? p.overPrice : p.underPrice;
                      if (!isPp && price == null) return null;
                      const picked = selected.some(
                        (s) =>
                          s.player === p.player &&
                          s.market === p.market &&
                          s.line === p.line &&
                          s.side === side,
                      );
                      return (
                        <View
                          key={`${p.player}|${p.market}|${p.line}`}
                          style={{
                            flexDirection: "row",
                            alignItems: "center",
                            gap: 10,
                            padding: 12,
                            borderRadius: 14,
                            backgroundColor: colors.card,
                            borderWidth: 1,
                            borderColor: colors.border,
                          }}
                        >
                          <SimAvatar headshot={p.headshot} name={p.player} />
                          <View style={{ flex: 1 }}>
                            <Text style={{ fontFamily: FONT.semibold, fontSize: 14, color: colors.foreground }}>
                              {p.player}
                            </Text>
                            <Text style={{ fontFamily: FONT.body, fontSize: 12, color: colors.mutedForeground }}>
                              {side} {p.line} {propMarketLabel(p.market)}
                            </Text>
                          </View>
                          <Text style={{ fontFamily: FONT.semibold, fontSize: 13, color: colors.foreground }}>
                            {isPp ? "DFS line" : formatAmerican(price!)}
                          </Text>
                          <Pressable
                            onPress={() => toggleProp(p, side)}
                            style={{
                              width: 32,
                              height: 32,
                              borderRadius: 16,
                              backgroundColor: picked ? colors.primary : "rgba(59,130,246,0.15)",
                              alignItems: "center",
                              justifyContent: "center",
                            }}
                          >
                            <Feather name={picked ? "check" : "plus"} size={18} color={picked ? "#0f172a" : colors.primary} />
                          </Pressable>
                        </View>
                      );
                    })}
                  </View>
                )}
              </View>
            )}

            {/* Settings */}
            <Card style={{ marginHorizontal: 16, marginBottom: 16 }}>
              <Text style={{ fontFamily: FONT.semibold, fontSize: 15, color: colors.foreground, marginBottom: 12 }}>
                Simulation Settings
              </Text>
              <SettingRow label="Simulation Count" value={`${SIM_COUNT.toLocaleString()}`} />
              <SettingRow label="Weather" value={weatherLabel} icon="cloud" />
              <SettingRow label="Home Field" value={game.venue ?? game.homeTeam ?? "—"} icon="map-pin" />
            </Card>

            {/* Run */}
            <Pressable
              onPress={runSimulation}
              disabled={!canRun}
              style={{ marginHorizontal: 16, marginBottom: 20, opacity: canRun ? 1 : 0.5 }}
            >
              <LinearGradient
                colors={["#3b82f6", "#2563eb"]}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 10,
                  paddingVertical: 16,
                  borderRadius: 16,
                }}
              >
                {running ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Feather name="play" size={20} color="#fff" />
                )}
                <Text style={{ color: "#fff", fontFamily: FONT.bold, fontSize: 16 }}>
                  {running ? "Running…" : "Run Simulation"}
                </Text>
              </LinearGradient>
            </Pressable>

            {/* Results */}
            {(gameResult || propResults.length > 0) && (
              <View style={{ paddingHorizontal: 16 }}>
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                  <Text style={{ fontFamily: FONT.semibold, fontSize: 17, color: colors.foreground }}>
                    Simulation Results
                  </Text>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                    <View
                      style={{
                        paddingHorizontal: 8,
                        paddingVertical: 4,
                        borderRadius: 8,
                        backgroundColor: "rgba(59,130,246,0.15)",
                      }}
                    >
                      <Text style={{ fontFamily: FONT.bold, fontSize: 10, color: colors.primary }}>
                        {SIM_COUNT.toLocaleString()} Sims
                      </Text>
                    </View>
                    {ranAt ? (
                      <Text style={{ fontFamily: FONT.body, fontSize: 11, color: colors.mutedForeground }}>
                        Updated just now
                      </Text>
                    ) : null}
                  </View>
                </View>

                {gameResult && game.homeTeam && game.awayTeam ? (
                  <>
                    <View style={{ flexDirection: "row", gap: 10, marginBottom: 12 }}>
                      <ResultCol title="Projected Score (Avg)">
                        <ScorePair
                          away={gameResult.awayProjectedScore}
                          home={gameResult.homeProjectedScore}
                          awayLogo={game.awayLogo}
                          homeLogo={game.homeLogo}
                        />
                      </ResultCol>
                      <ResultCol title="Win Probability">
                        <WinBar
                          awayPct={gameResult.awayWinProbability}
                          homePct={gameResult.homeWinProbability}
                          awayLabel={game.awayAbbr ?? game.awayTeam}
                          homeLabel={game.homeAbbr ?? game.homeTeam}
                        />
                      </ResultCol>
                    </View>
                    {gameFourQuestions.length > 0 ? (
                      <Card style={{ marginBottom: 12 }}>
                        <Text style={{ fontFamily: FONT.semibold, fontSize: 14, color: colors.foreground, marginBottom: 4 }}>
                          Four-Question Check
                        </Text>
                        <Text style={{ fontFamily: FONT.body, fontSize: 11, color: colors.mutedForeground, marginBottom: 12, lineHeight: 16 }}>
                          Same 10,000-run draw — not just who wins, but cover, frequency, and line value.
                        </Text>
                        {gameFourQuestions.map((team) => (
                          <FourQuestionsBlock key={team.teamSide} team={team} />
                        ))}
                      </Card>
                    ) : null}
                  </>
                ) : null}

                {propResults.length > 0 ? (
                  <Card style={{ marginBottom: 16 }}>
                    <Text style={{ fontFamily: FONT.semibold, fontSize: 14, color: colors.foreground, marginBottom: 4 }}>
                      Player Prop Projections
                    </Text>
                    <Text style={{ fontFamily: FONT.body, fontSize: 11, color: colors.mutedForeground, marginBottom: 10, lineHeight: 16 }}>
                      Final AI Score (30% sim · 20% line value · 15% matchup · 10% injuries · 10% form · 5% each sharp/line move/shopping) rolls every grounded signal into one grade — simulation is the anchor, not the only input.
                      {simDeepPending ? " Simulation updating…" : ""}
                    </Text>
                    {propResults.map((r) => {
                      const graded = propScores.get(r.key);
                      const combined = graded?.rubric;
                      const finalAi = graded?.finalAiScore;
                      const simBadge = finalAiScoreLabel(finalAi);
                      const gradeColor =
                        combined?.composite == null
                          ? colors.mutedForeground
                          : combined.composite >= 7
                            ? colors.success
                            : combined.composite >= 5.5
                              ? colors.primary
                              : colors.mutedForeground;
                      const edgeColor =
                        combined?.edgePct == null
                          ? colors.mutedForeground
                          : combined.edgePct >= 0
                            ? colors.success
                            : colors.destructive;
                      return (
                        <View
                          key={r.key}
                          style={{
                            paddingVertical: 10,
                            borderTopWidth: 1,
                            borderTopColor: colors.border,
                          }}
                        >
                          <Text style={{ fontFamily: FONT.semibold, fontSize: 13, color: colors.foreground }}>
                            {r.player} — {r.side} {r.line} {propMarketLabel(r.market)}
                          </Text>
                          {simBadge ? (
                            <View
                              style={{
                                alignSelf: "flex-start",
                                marginTop: 6,
                                paddingHorizontal: 8,
                                paddingVertical: 3,
                                borderRadius: 6,
                                backgroundColor: finalAi?.highRiskValuePlay
                                  ? "rgba(234,179,8,0.2)"
                                  : "rgba(34,197,94,0.15)",
                              }}
                            >
                              <Text
                                style={{
                                  fontFamily: FONT.bold,
                                  fontSize: 10,
                                  color: finalAi?.highRiskValuePlay ? "#eab308" : colors.success,
                                }}
                              >
                                {simBadge}
                              </Text>
                            </View>
                          ) : null}
                          {r.hitProbability == null && r.sampleGames < 3 ? (
                            <Text style={{ fontFamily: FONT.body, fontSize: 11, color: colors.mutedForeground, marginTop: 4 }}>
                              Not enough recent game log to simulate this line.
                            </Text>
                          ) : null}
                          <View style={{ flexDirection: "row", gap: 12, marginTop: 8, flexWrap: "wrap" }}>
                            <MiniStat label="Final AI Score" value={finalAi?.grade ?? combined?.grade ?? "—"} valueColor={gradeColor} />
                            <MiniStat
                              label="Confidence"
                              value={finalAi?.confidencePct != null ? `${finalAi.confidencePct}%` : combined?.confidencePct != null ? `${combined.confidencePct}%` : "—"}
                            />
                            <MiniStat
                              label="Edge"
                              value={combined?.edgePct != null ? `${combined.edgePct > 0 ? "+" : ""}${combined.edgePct}%` : "—"}
                              valueColor={edgeColor}
                            />
                          </View>
                          <View style={{ flexDirection: "row", gap: 16, marginTop: 8 }}>
                            <MiniStat label="Sim Hit %" value={r.hitProbability != null ? `${Math.round(r.hitProbability * 100)}%` : "—"} />
                            <MiniStat label="Likely" value={r.mostLikelyLine != null ? String(r.mostLikelyLine) : "—"} />
                            <MiniStat label="Sim Conf" value={r.confidenceScore != null ? String(r.confidenceScore) : "—"} />
                          </View>
                        </View>
                      );
                    })}
                  </Card>
                ) : null}
              </View>
            )}
          </>
        )}
      </ScrollView>

      <Modal visible={howOpen} transparent animationType="fade" onRequestClose={() => setHowOpen(false)}>
        <Pressable style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "center", padding: 24 }} onPress={() => setHowOpen(false)}>
          <Pressable onPress={(e) => e.stopPropagation()}>
            <Card>
              <Text style={{ fontFamily: FONT.semibold, fontSize: 17, color: colors.foreground, marginBottom: 10 }}>
                How it works
              </Text>
              <Text style={{ fontFamily: FONT.body, fontSize: 14, color: colors.mutedForeground, lineHeight: 21 }}>
                Each run performs {SIM_COUNT.toLocaleString()} Monte Carlo draws using real recent game logs, pace,
                minutes, injuries, matchup splits, and park weather. One draw set powers every market on that game.
                For each team we ask: Does the team win? Do they cover? How often do they cover? Is the price worth it?
                The Final AI Score rolls those answers together with matchup, form, injuries, and line shopping.
              </Text>
            </Card>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

function TeamCol({
  name,
  logo,
  record,
  align,
}: {
  name: string;
  logo?: string | null;
  record: string;
  align: "left" | "right";
}) {
  const colors = useColors();
  return (
    <View style={{ flex: 1, alignItems: align === "left" ? "flex-start" : "flex-end", gap: 6 }}>
      {logo ? (
        <Image source={{ uri: logo }} style={{ width: 40, height: 40 }} contentFit="contain" />
      ) : (
        <View
          style={{
            width: 40,
            height: 40,
            borderRadius: 10,
            backgroundColor: colors.surface,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Text style={{ fontFamily: FONT.bold, fontSize: 12, color: colors.mutedForeground }}>{initials(name)}</Text>
        </View>
      )}
      <Text style={{ fontFamily: FONT.semibold, fontSize: 13, color: colors.foreground, textAlign: align }}>
        {name.split(" ").slice(-1)[0]}
      </Text>
      <Text style={{ fontFamily: FONT.body, fontSize: 11, color: colors.mutedForeground }}>{record}</Text>
    </View>
  );
}

function SettingRow({
  label,
  value,
  icon,
}: {
  label: string;
  value: string;
  icon?: keyof typeof Feather.glyphMap;
}) {
  const colors = useColors();
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        paddingVertical: 10,
        borderTopWidth: 1,
        borderTopColor: colors.border,
      }}
    >
      <Text style={{ fontFamily: FONT.medium, fontSize: 13, color: colors.mutedForeground }}>{label}</Text>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        {icon ? <Feather name={icon} size={14} color={colors.mutedForeground} /> : null}
        <Text style={{ fontFamily: FONT.semibold, fontSize: 13, color: colors.foreground }}>{value}</Text>
      </View>
    </View>
  );
}

function FourQuestionsBlock({ team }: { team: TeamFourQuestions }) {
  const colors = useColors();
  return (
    <View
      style={{
        paddingVertical: 10,
        borderTopWidth: 1,
        borderTopColor: colors.border,
      }}
    >
      <Text style={{ fontFamily: FONT.semibold, fontSize: 13, color: colors.foreground, marginBottom: 8 }}>
        {team.team}
      </Text>
      {team.questions.map((q) => (
        <View key={q.question} style={{ marginBottom: 6 }}>
          <Text style={{ fontFamily: FONT.medium, fontSize: 11, color: colors.mutedForeground }}>
            {q.question}
          </Text>
          <Text style={{ fontFamily: FONT.semibold, fontSize: 13, color: colors.foreground, marginTop: 2 }}>
            {q.answer}
            {q.detail ? (
              <Text style={{ fontFamily: FONT.body, fontSize: 11, color: colors.mutedForeground }}>
                {" "}
                — {q.detail}
              </Text>
            ) : null}
          </Text>
        </View>
      ))}
    </View>
  );
}

function ResultCol({ title, children }: { title: string; children: ReactNode }) {
  const colors = useColors();
  return (
    <View style={{ flex: 1, backgroundColor: colors.card, borderRadius: 14, borderWidth: 1, borderColor: colors.border, padding: 10 }}>
      <Text style={{ fontFamily: FONT.medium, fontSize: 10, color: colors.mutedForeground, marginBottom: 8 }}>{title}</Text>
      {children}
    </View>
  );
}

function WinBar({
  awayPct,
  homePct,
  awayLabel,
  homeLabel,
}: {
  awayPct: number;
  homePct: number;
  awayLabel: string;
  homeLabel: string;
}) {
  const colors = useColors();
  return (
    <View style={{ gap: 6 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <View style={{ flex: awayPct, height: 8, borderRadius: 4, backgroundColor: "#ef4444" }} />
        <View style={{ flex: homePct, height: 8, borderRadius: 4, backgroundColor: "#eab308" }} />
      </View>
      <Text style={{ fontSize: 10, color: colors.mutedForeground, fontFamily: FONT.body }}>
        {awayLabel} {(awayPct * 100).toFixed(1)}%
      </Text>
      <Text style={{ fontSize: 10, color: colors.mutedForeground, fontFamily: FONT.body }}>
        {homeLabel} {(homePct * 100).toFixed(1)}%
      </Text>
    </View>
  );
}

function ScorePair({
  away,
  home,
  awayLogo,
  homeLogo,
}: {
  away: number;
  home: number;
  awayLogo?: string | null;
  homeLogo?: string | null;
}) {
  const colors = useColors();
  return (
    <View style={{ gap: 8 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        {awayLogo ? <Image source={{ uri: awayLogo }} style={{ width: 18, height: 18 }} contentFit="contain" /> : null}
        <Text style={{ fontFamily: FONT.bold, fontSize: 16, color: colors.foreground }}>{away.toFixed(2)}</Text>
      </View>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        {homeLogo ? <Image source={{ uri: homeLogo }} style={{ width: 18, height: 18 }} contentFit="contain" /> : null}
        <Text style={{ fontFamily: FONT.bold, fontSize: 16, color: colors.foreground }}>{home.toFixed(2)}</Text>
      </View>
    </View>
  );
}

function MiniStat({
  label,
  value,
  valueColor,
}: {
  label: string;
  value: string;
  valueColor?: string;
}) {
  const colors = useColors();
  return (
    <View>
      <Text style={{ fontFamily: FONT.body, fontSize: 10, color: colors.mutedForeground }}>{label}</Text>
      <Text style={{ fontFamily: FONT.semibold, fontSize: 13, color: valueColor ?? colors.foreground }}>{value}</Text>
    </View>
  );
}

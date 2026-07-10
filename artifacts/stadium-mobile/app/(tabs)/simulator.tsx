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
import { Card, EmptyState, FONT, Loading, Pill } from "@/components/ui";
import { useColors } from "@/hooks/useColors";
import type {
  EspnGame,
  GameSimulationResult,
  OddsGame,
  PlayerProp,
  PropSimulationResult,
} from "@/lib/api";
import { buildGameInjuryReport } from "@/lib/injuries";
import { loadSimulatorProps } from "@/lib/simulatorProps";
import { enrichPropSimResults } from "@/lib/simulatorLocalSim";
import {
  fetchSimulatorGameOutcome,
  fetchSimulatorGames,
  fetchSimulatorInjuries,
  fetchSimulatorMatchupHistory,
  fetchSimulatorMlbProbables,
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
  realOddsToGameLines,
  type TeamFourQuestions,
} from "@/lib/gameLineFourQuestions";
import { buildAllEvalGameLines } from "@/lib/api";
import {
  coverQueriesFromEvalLines,
  recommendBestLinesForGame,
  type EvaluatedGameLine,
} from "@/lib/gameLineOptimizer";
import { buildDefaultGameCoverQueries, mergeCoverQueries } from "@/lib/gameSimScoring";
import { finalAiScoreLabel } from "@/lib/finalAiScore";
import {
  classifyGameSimRecommendation,
  deriveGameSimLineMetrics,
  NO_POSITIVE_EDGE_MESSAGE,
  qualifiesForBestLines,
} from "@/lib/gameSimQualityGates";
import {
  buildSimulationSummary,
  normalizeGameWinDisplay,
  weatherSettingLabel,
  type SimulationSummary,
} from "@/lib/gameSimDisplay";
import { analyzeFullSimulation, type FullSimulationAnalytics } from "@/lib/fullSimulationAnalytics";
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
  cachedSimGames,
  pruneSimGamesCache,
  rememberSimGames,
  rememberSimProps,
} from "@/lib/simulatorSessionCache";
import {
  buildSimInputFingerprint,
  fingerprintKey,
  fingerprintInjuries,
  fingerprintLineups,
  fingerprintOddsLines,
  fingerprintWeather,
  getCachedGameSim,
  rememberGameSim,
} from "@/lib/simulatorResultCache";
import { isUfcFightRow } from "@/lib/ufcSimulatorGames";
import { fetchUfcSimulatorGameOutcome } from "@/lib/ufcSimulatorSim";

const gameEligibleForSim = isSimulatorPregame;

function simulatorGameEligible(sport: string, g: EspnGame): boolean {
  if (!gameEligibleForSim(g)) return false;
  const s = sport.toLowerCase();
  if ((s === "ufc" || s === "mma") && !isUfcFightRow(g)) return false;
  return true;
}

const SIM_SPORTS = ["mlb", "nba", "wnba", "nhl", "soccer", "tennis", "ufc"] as const;

function isGameLinesOnlySport(sport: string): boolean {
  return sport === "tennis" || sport === "ufc" || sport === "mma";
}

function isNameOnlySimSport(sport: string): boolean {
  return isGameLinesOnlySport(sport);
}
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

function formatPropProjectedStat(r: PropSimulationResult): string {
  const raw = r.medianProjection ?? r.meanProjection ?? r.mostLikelyLine;
  if (raw == null || !Number.isFinite(raw)) return "—";
  return Number.isInteger(raw) ? String(raw) : raw.toFixed(1);
}

function formatPropSimConf(
  r: PropSimulationResult,
  rubricConf?: number | null,
): string {
  const score = r.confidenceScore ?? rubricConf;
  if (score == null || !Number.isFinite(score)) return "—";
  return String(Math.round(score));
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
  const [linesScanStep, setLinesScanStep] = useState(0);
  const [linesRevealReady, setLinesRevealReady] = useState(false);

  const sportFilters = propFiltersForSport(sport);
  const warmedRef = useRef(false);
  const runInFlightRef = useRef(false);
  const lastAutoRunKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (!sportFilters.some((f) => f.id === filter)) setFilter("popular");
  }, [sport, sportFilters, filter]);

  const isGameLinesOnly = isGameLinesOnlySport(sport);
  useEffect(() => {
    if (isGameLinesOnly) setMode("game");
  }, [isGameLinesOnly]);

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
    queryKey: ["sim-games-v3", sport],
    queryFn: async ({ signal }) => {
      try {
        const rows = await fetchSimulatorGames(sport, signal);
        const list = asGameList(rows).filter((g) => simulatorGameEligible(sport, g));
        rememberSimGames(sport, list);
        return list;
      } catch {
        return [] as EspnGame[];
      }
    },
    staleTime: 30_000,
    refetchOnMount: "always",
    refetchInterval: 60_000,
    retry: false,
    throwOnError: false,
    placeholderData: (previousData, previousQuery) => {
      const qSport = previousQuery?.queryKey?.[1];
      if (qSport !== sport) {
        const cached = cachedSimGames(sport);
        return cached.length > 0 ? cached : undefined;
      }
      // Never paint a UFC event placeholder (venue/time but no fighters).
      if (sport === "ufc" || sport === "mma") return undefined;
      const prev = asGameList(previousData).filter((g) => simulatorGameEligible(sport, g));
      return prev.length > 0 ? prev : undefined;
    },
  });

  const games = useMemo(
    () => asGameList(gamesQ.data).filter((g) => simulatorGameEligible(sport, g)),
    [gamesQ.data, sport, clockTick],
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
  const ufcFightIncomplete =
    (sport === "ufc" || sport === "mma") && !!game && !isUfcFightRow(game);

  useEffect(() => {
    if (ufcFightIncomplete) void gamesQ.refetch();
  }, [ufcFightIncomplete, gamesQ.refetch]);

  const oddsQ = useQuery({
    queryKey: ["sim-odds", sport, game?.id],
    queryFn: ({ signal }) => fetchSimulatorOdds(sport, signal),
    staleTime: 60_000,
    enabled: !!game,
  });

  // Switching games must drop prior prop selections (PP lines are per-matchup).
  useEffect(() => {
    setSelected([]);
    setPropResults([]);
    setPlayerHistory({});
    setSimDeepPending(false);
    setGameResult(null);
    setRanAt(null);
    lastAutoRunKeyRef.current = null;
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
    return buildAllEvalGameLines(match);
  }, [oddsQ.data, gameLabel, game?.homeTeam, game?.awayTeam]);

  const matchedOddsGame = useMemo((): OddsGame | null => {
    if (!game?.homeTeam || !game?.awayTeam) return null;
    const rows = Array.isArray(oddsQ.data) ? oddsQ.data : [];
    const norm = (s: string) => s.toLowerCase().trim();
    return (
      rows.find(
        (g) => norm(g.homeTeam) === norm(game.homeTeam!) && norm(g.awayTeam) === norm(game.awayTeam!),
      ) ?? null
    );
  }, [oddsQ.data, game?.homeTeam, game?.awayTeam]);

  const sportsbooksScanned = useMemo(() => {
    if (!matchedOddsGame?.markets?.length) return 20;
    const books = new Set<string>();
    for (const m of matchedOddsGame.markets) {
      for (const o of m.outcomes ?? []) {
        for (const b of o.books ?? []) {
          if (b.book) books.add(b.book);
        }
      }
    }
    return books.size > 0 ? books.size : 20;
  }, [matchedOddsGame]);

  const gameFourQuestions = useMemo((): TeamFourQuestions[] => {
    if (!gameResult || !game?.homeTeam || !game?.awayTeam || !gameLabel) return [];
    const oddsLines = realOddsToGameLines(gameOddsLines, gameLabel);
    return buildGameFourQuestions({
      gameLabel,
      homeTeam: game.homeTeam,
      awayTeam: game.awayTeam,
      sim: gameResult,
      oddsLines,
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

  const gameLineRecs = useMemo(() => {
    if (!gameResult || !game?.homeTeam || !game?.awayTeam || !gameOddsLines.length) return null;
    return recommendBestLinesForGame({
      awayTeam: game.awayTeam,
      homeTeam: game.homeTeam,
      evalLines: gameOddsLines,
      gameSim: gameResult,
      matchupHistory: matchupQ.data ? { [gameLabel]: matchupQ.data } : {},
      matchupInjuries,
    });
  }, [gameResult, game?.homeTeam, game?.awayTeam, gameOddsLines, gameLabel, matchupQ.data, matchupInjuries]);

  const gameSimRecommendation = useMemo(() => {
    if (!gameResult || !gameLineRecs) return null;
    return classifyGameSimRecommendation(gameLineRecs, gameResult);
  }, [gameResult, gameLineRecs]);

  const displayBestLines = useMemo(() => {
    if (!gameLineRecs) return [];
    return gameLineRecs.ranked.filter(qualifiesForBestLines);
  }, [gameLineRecs]);

  const normalizedWin = useMemo(
    () => (gameResult ? normalizeGameWinDisplay(gameResult) : null),
    [gameResult],
  );

  const simulationSummary = useMemo(
    () => buildSimulationSummary(displayBestLines[0], gameSimRecommendation),
    [displayBestLines, gameSimRecommendation],
  );

  const fullSimAnalytics = useMemo(() => {
    if (!gameResult || !game?.homeTeam || !game?.awayTeam || !gameLabel) return null;
    return analyzeFullSimulation({
      result: gameResult,
      evalLines: gameOddsLines,
      gameLabel,
      awayTeam: game.awayTeam,
      homeTeam: game.homeTeam,
    });
  }, [gameResult, gameOddsLines, gameLabel, game?.homeTeam, game?.awayTeam]);

  const bestLinesAnalyzing =
    running ||
    (Boolean(gameResult) && (mode === "game" || mode === "full") && !linesRevealReady);

  useEffect(() => {
    if (running) {
      setLinesRevealReady(false);
      setLinesScanStep(0);
      return;
    }
    if (!gameResult || mode === "props") {
      setLinesRevealReady(false);
      return;
    }
    setLinesRevealReady(false);
    const reveal = setTimeout(() => setLinesRevealReady(true), 1400);
    return () => clearTimeout(reveal);
  }, [gameResult, running, mode]);

  useEffect(() => {
    if (!bestLinesAnalyzing) {
      setLinesScanStep(0);
      return;
    }
    setLinesScanStep(0);
    const id = setInterval(() => {
      setLinesScanStep((s) => (s >= 2 ? 0 : s + 1));
    }, 550);
    return () => clearInterval(id);
  }, [bestLinesAnalyzing]);

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

  const gamesBootstrapping =
    (gamesQ.isPending || (gamesQ.isFetching && gamesQ.fetchStatus === "fetching" && !gamesQ.data)) &&
    games.length === 0;
  const propsLoading = gameEligible && propsQ.isPending;

  const parkQ = useQuery({
    queryKey: ["sim-park-wx", sport],
    enabled: sport === "mlb" && !!game,
    queryFn: ({ signal }) => fetchSimulatorParkWeather("mlb", signal),
    staleTime: 10 * 60_000,
  });

  const probablesQ = useQuery({
    queryKey: ["sim-mlb-probables"],
    enabled: sport === "mlb" && !!game,
    queryFn: ({ signal }) => fetchSimulatorMlbProbables(signal),
    staleTime: 5 * 60_000,
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

  const weatherImpact = weatherForGame?.climateControlled
    ? null
    : weatherImpactFromRating(weatherForGame?.impact?.rating);
  const weatherLabel = weatherSettingLabel({
    climateControlled: weatherForGame?.climateControlled,
    venue: game?.venue,
    tempF: weatherForGame?.current?.tempF ?? null,
    condition: weatherForGame?.current?.condition ?? null,
  });
  const showWeatherRow = weatherLabel != null;

  const simInputFingerprint = useMemo(() => {
    if (!game?.id || !game.homeTeam || !game.awayTeam) return null;
    const injuryTeams = Array.isArray(injuriesQ.data) ? injuriesQ.data : [];
    const injuryRep = buildGameInjuryReport(sport, injuryTeams, game.awayTeam, game.homeTeam);
    const homeProb =
      sport === "mlb" && game.homeTeamId ? probablesQ.data?.probables?.[game.homeTeamId] : null;
    const awayProb =
      sport === "mlb" && game.awayTeamId ? probablesQ.data?.probables?.[game.awayTeamId] : null;
    return buildSimInputFingerprint({
      odds: fingerprintOddsLines(gameOddsLines),
      injuries: fingerprintInjuries(injuryRep),
      weather: fingerprintWeather(
        weatherForGame
          ? {
              tempF: weatherForGame.current?.tempF,
              condition: weatherForGame.current?.condition,
              climateControlled: (weatherForGame as { climateControlled?: boolean }).climateControlled,
              impactRating: weatherForGame.impact?.rating,
            }
          : null,
        weatherImpact,
      ),
      lineups: fingerprintLineups({
        homeStarterId: homeProb?.athleteId,
        awayStarterId: awayProb?.athleteId,
        homeStarterName: homeProb?.name,
        awayStarterName: awayProb?.name,
      }),
    });
  }, [
    game,
    sport,
    gameOddsLines,
    injuriesQ.data,
    weatherForGame,
    weatherImpact,
    probablesQ.data,
  ]);

  const simInputsReady =
    gameEligible &&
    !!game?.id &&
    !!game.homeTeam &&
    !!game.awayTeam &&
    (isNameOnlySimSport(sport) || (!!game.homeTeamId && !!game.awayTeamId)) &&
    oddsQ.isFetched &&
    (isNameOnlySimSport(sport) || injuriesQ.isFetched) &&
    (sport !== "mlb" || parkQ.isFetched) &&
    (sport !== "mlb" || probablesQ.isFetched);

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

  const runSimulation = useCallback(
    async (opts?: { force?: boolean; auto?: boolean }) => {
      if (
        !gameEligible ||
        !game?.homeTeam ||
        !game?.awayTeam ||
        !game.id ||
        (!isNameOnlySimSport(sport) && (!game.homeTeamId || !game.awayTeamId))
      ) {
        return;
      }
      if (runInFlightRef.current) return;

      const fp = simInputFingerprint;
      if (!opts?.force && fp) {
        const cached = getCachedGameSim(sport, game.id, fp);
        if (cached) {
          setGameResult(cached.gameResult);
          setRanAt(cached.ranAt);
          lastAutoRunKeyRef.current = fingerprintKey(fp);
          return;
        }
      }

      const runGame = opts?.auto || mode === "game" || mode === "full";
      const runProps = !opts?.auto && (mode === "props" || mode === "full") && selected.length > 0;
      if (!runGame && !runProps) return;

      if (!opts?.force && !opts?.auto) {
        if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      }

      runInFlightRef.current = true;
      setRunning(true);
      if (opts?.force) {
        setGameResult(null);
        setPropResults([]);
        setPlayerHistory({});
      } else if (!opts?.auto) {
        setGameResult(null);
        setPropResults([]);
        setPlayerHistory({});
      }

      try {
        const wx = weatherImpact;
        if (runGame) {
          const label = `${game.awayTeam} @ ${game.homeTeam}`;
          const evalMap = new Map([[label, gameOddsLines]]);
          const coverQueries = mergeCoverQueries(
            buildDefaultGameCoverQueries(label, game.homeTeam, game.awayTeam),
            coverQueriesFromEvalLines(evalMap),
          );
          const fetchOutcome =
            sport === "ufc" || sport === "mma"
              ? fetchUfcSimulatorGameOutcome
              : fetchSimulatorGameOutcome;
          const gr = await fetchOutcome({
            sport,
            homeTeamId: game.homeTeamId ?? "",
            awayTeamId: game.awayTeamId ?? "",
            homeTeam: game.homeTeam,
            awayTeam: game.awayTeam,
            simulations: SIM_COUNT,
            weatherImpact: wx,
            coverQueries,
            retainOutcomes: true,
          });
          if (gr) {
            setGameResult(gr);
            const ran = Date.now();
            setRanAt(ran);
            if (fp) {
              rememberGameSim(sport, game.id, { gameResult: gr, ranAt: ran, fingerprint: fp });
              lastAutoRunKeyRef.current = fingerprintKey(fp);
            }
          } else if (opts?.auto) {
            lastAutoRunKeyRef.current = null;
          }
        }
        if (runProps) {
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
          const phForSim: Record<string, { labels?: string[]; recent?: { stats?: Record<string, string> }[] }> =
            {};
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
        if (!runGame) setRanAt(Date.now());
      } finally {
        runInFlightRef.current = false;
        setRunning(false);
      }
    },
    [
      gameEligible,
      game,
      simInputFingerprint,
      sport,
      mode,
      selected,
      gameOddsLines,
      weatherImpact,
    ],
  );

  // Auto-run game outcome sim when a game opens; reuse cache when inputs are unchanged.
  useEffect(() => {
    if (!simInputsReady || !game?.id || !simInputFingerprint) return;

    const fpKey = fingerprintKey(simInputFingerprint);
    const cached = getCachedGameSim(sport, game.id, simInputFingerprint);
    if (cached) {
      setGameResult(cached.gameResult);
      setRanAt(cached.ranAt);
      lastAutoRunKeyRef.current = fpKey;
      return;
    }

    if (lastAutoRunKeyRef.current !== fpKey) {
      setGameResult(null);
      setRanAt(null);
    }
    if (lastAutoRunKeyRef.current === fpKey || runInFlightRef.current) return;
    lastAutoRunKeyRef.current = fpKey;
    void runSimulation({ auto: true });
  }, [simInputsReady, game?.id, sport, simInputFingerprint, runSimulation]);

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
              <Pill key={id} label={label} active={sport === id} onPress={() => { setSport(id); setGameIdx(0); setSelected([]); setFilter("popular"); if (isGameLinesOnlySport(id)) setMode("game"); }} />
            );
          })}
        </ScrollView>

        {gamesBootstrapping || ufcFightIncomplete ? (
          <Loading
            label={
              ufcFightIncomplete
                ? "Loading UFC fights…"
                : "Loading games…"
            }
          />
        ) : !game ? (
          <EmptyState
            title="No upcoming games"
            subtitle={
              gamesQ.isError
                ? sport === "ufc"
                  ? "Couldn't load UFC fights from the odds feed. Pull down to refresh."
                  : isGameLinesOnly
                    ? sport === "tennis"
                      ? "Couldn't reach the tennis slate right now. Pull down to refresh — or check back when pregame ATP/WTA matches are in the next 48 hours."
                      : "Couldn't reach the UFC fight card right now. Pull down to refresh."
                    : `Couldn't reach the ${sport.toUpperCase()} slate right now. Pull down to refresh.`
                : sport === "ufc"
                  ? "No pregame UFC fights in the next 48 hours — matchups load from the posted odds feed, not ESPN event cards."
                  : isGameLinesOnly
                    ? sport === "tennis"
                      ? "No pregame tennis matchups in the next 48 hours right now. Live and completed matches are hidden."
                      : "No pregame UFC fights in the next 48 hours right now. Live and completed bouts are hidden."
                    : `No pregame ${sport.toUpperCase()} matchups to simulate right now — in-progress and final games are hidden.`
            }
          />
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

            {/* Mode tabs — tennis/UFC are game-lines only (no player props). */}
            {!isGameLinesOnly ? (
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
            ) : null}

            {/* Player prop builder */}
            {(mode === "props" || mode === "full") && !isGameLinesOnly && (
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
              {showWeatherRow ? (
                <SettingRow label="Weather" value={weatherLabel!} icon="cloud" />
              ) : null}
              <SettingRow
                label={sport === "ufc" || sport === "mma" ? "Venue" : "Home Field"}
                value={
                  sport === "ufc" || sport === "mma"
                    ? game.venue ?? "Neutral site"
                    : game.venue ?? game.homeTeam ?? "—"
                }
                icon="map-pin"
              />
            </Card>

            {/* Run */}
            <Pressable
              onPress={() => runSimulation({ force: true })}
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

            {(running || gameResult) && mode !== "props" ? (
              <SimulationSummaryCard
                analyzing={bestLinesAnalyzing}
                linesScanStep={linesScanStep}
                postedLines={gameOddsLines.length}
                sportsbooks={sportsbooksScanned}
                summary={simulationSummary}
              />
            ) : null}

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
                      {!isGameLinesOnlySport(sport) || sport === "tennis" ? (
                        <ResultCol title="Projected Score (Avg)">
                          <ScorePair
                            away={gameResult.awayProjectedScore ?? 0}
                            home={gameResult.homeProjectedScore ?? 0}
                            awayLogo={game.awayLogo}
                            homeLogo={game.homeLogo}
                          />
                        </ResultCol>
                      ) : null}
                      <ResultCol title="Win Probability">
                        {normalizedWin ? (
                          <WinBar
                            awayPct={normalizedWin.awayPct}
                            homePct={normalizedWin.homePct}
                            tiePct={normalizedWin.tiePct}
                            awayLabel={game.awayAbbr ?? game.awayTeam}
                            homeLabel={game.homeAbbr ?? game.homeTeam}
                          />
                        ) : null}
                      </ResultCol>
                    </View>
                    {sport === "ufc" && gameResult.methodRates ? (
                      <Card style={{ marginBottom: 12 }}>
                        <Text style={{ fontFamily: FONT.semibold, fontSize: 14, color: colors.foreground, marginBottom: 8 }}>
                          Method of Victory (Sim)
                        </Text>
                        <MethodRatesBlock
                          awayLabel={game.awayAbbr ?? game.awayTeam}
                          homeLabel={game.homeAbbr ?? game.homeTeam}
                          rates={gameResult.methodRates}
                        />
                      </Card>
                    ) : null}
                    {gameSimRecommendation ? (
                      <Card style={{ marginBottom: 12 }}>
                        <Text style={{ fontFamily: FONT.semibold, fontSize: 14, color: colors.foreground, marginBottom: 6 }}>
                          Recommendation
                        </Text>
                        <Text style={{ fontFamily: FONT.bold, fontSize: 15, color: colors.foreground }}>
                          {gameSimRecommendation.emoji} {gameSimRecommendation.label}
                        </Text>
                        <Text style={{ fontFamily: FONT.body, fontSize: 12, color: colors.mutedForeground, marginTop: 4, lineHeight: 17 }}>
                          {gameSimRecommendation.detail}
                        </Text>
                      </Card>
                    ) : null}
                    {bestLinesAnalyzing ? (
                      <BestLinesLoadingCard
                        step={linesScanStep}
                        postedLines={gameOddsLines.length}
                        sportsbooks={sportsbooksScanned}
                      />
                    ) : displayBestLines.length > 0 ? (
                      <Card style={{ marginBottom: 12 }}>
                        <Text style={{ fontFamily: FONT.semibold, fontSize: 14, color: colors.foreground, marginBottom: 4 }}>
                          Best Lines (Final AI Score)
                        </Text>
                        <Text style={{ fontFamily: FONT.body, fontSize: 11, color: colors.mutedForeground, marginBottom: 12, lineHeight: 16 }}>
                          Every ML, spread, alt spread, total, alt total, and team total rung scored against the same 10,000-run draw — only lines with full sim hit, fair odds, EV, edge, grade, and confidence are shown.
                        </Text>
                        {displayBestLines.map((row) => (
                          <RecommendedLineRow key={`${row.entry.market}|${row.entry.pick}`} row={row} />
                        ))}
                      </Card>
                    ) : (
                      <Card style={{ marginBottom: 12 }}>
                        <Text style={{ fontFamily: FONT.semibold, fontSize: 14, color: colors.foreground, marginBottom: 4 }}>
                          Best Lines (Final AI Score)
                        </Text>
                        <Text style={{ fontFamily: FONT.body, fontSize: 13, color: colors.mutedForeground, marginTop: 8, lineHeight: 18 }}>
                          {NO_POSITIVE_EDGE_MESSAGE}
                        </Text>
                      </Card>
                    )}
                    {mode === "full" && fullSimAnalytics ? (
                      <FullSimulationPanel analytics={fullSimAnalytics} />
                    ) : null}
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
                            <MiniStat label="Projected Stat" value={formatPropProjectedStat(r)} />
                            <MiniStat
                              label="Sim Conf"
                              value={formatPropSimConf(r, finalAi?.confidencePct ?? combined?.confidencePct)}
                            />
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

function SimulationSummaryCard({
  analyzing,
  linesScanStep,
  postedLines,
  sportsbooks,
  summary,
}: {
  analyzing: boolean;
  linesScanStep: number;
  postedLines: number;
  sportsbooks: number;
  summary: SimulationSummary;
}) {
  const colors = useColors();
  const hasBet = summary.bestBet != null && summary.grade != null;

  return (
    <Card style={{ marginHorizontal: 16, marginBottom: 16 }}>
      <Text style={{ fontFamily: FONT.semibold, fontSize: 15, color: colors.foreground, marginBottom: 10 }}>
        Simulation Summary
      </Text>
      {analyzing ? (
        <View style={{ gap: 8 }}>
          <Text style={{ fontFamily: FONT.medium, fontSize: 13, color: colors.foreground }}>
            Calculating best betting lines…
          </Text>
          {[
            `Evaluating ${postedLines || 84} posted lines`,
            `Comparing ${sportsbooks} sportsbooks`,
            "Computing EV and Fair Odds",
          ].map((line, i) => (
            <Text
              key={line}
              style={{
                fontFamily: FONT.body,
                fontSize: 12,
                color: linesScanStep >= i ? colors.foreground : colors.mutedForeground,
              }}
            >
              {linesScanStep >= i ? "✔" : "…"} {line}
            </Text>
          ))}
        </View>
      ) : hasBet ? (
        <View style={{ gap: 6 }}>
          <SummaryLine label="Best Bet" value={summary.bestBet!} />
          <SummaryLine label="AI Grade" value={summary.grade!} />
          {summary.confidence != null ? (
            <SummaryLine label="Confidence" value={String(summary.confidence)} />
          ) : null}
          {summary.edgePct != null ? (
            <SummaryLine label="Edge" value={`+${summary.edgePct}%`} />
          ) : null}
          {summary.fairOdds != null ? (
            <SummaryLine label="Fair Odds" value={formatAmerican(summary.fairOdds)} />
          ) : null}
          {summary.bookOdds != null ? (
            <SummaryLine label="Sportsbook" value={formatAmerican(summary.bookOdds)} />
          ) : null}
          <SummaryLine label="Recommendation" value={summary.recommendation} accent />
        </View>
      ) : (
        <Text style={{ fontFamily: FONT.medium, fontSize: 13, color: colors.mutedForeground, lineHeight: 18 }}>
          Recommendation: {summary.recommendation}
        </Text>
      )}
    </Card>
  );
}

function SummaryLine({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  const colors = useColors();
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 12 }}>
      <Text style={{ fontFamily: FONT.medium, fontSize: 12, color: colors.mutedForeground }}>{label}</Text>
      <Text
        style={{
          fontFamily: FONT.semibold,
          fontSize: 12,
          color: accent ? colors.primary : colors.foreground,
          flexShrink: 1,
          textAlign: "right",
        }}
      >
        {value}
      </Text>
    </View>
  );
}

function BestLinesLoadingCard({
  step,
  postedLines,
  sportsbooks,
}: {
  step: number;
  postedLines: number;
  sportsbooks: number;
}) {
  const colors = useColors();
  const lines = [
    `Evaluating ${postedLines || 84} posted lines`,
    `Comparing ${sportsbooks} sportsbooks`,
    "Computing EV and Fair Odds",
  ];
  return (
    <Card style={{ marginBottom: 12 }}>
      <Text style={{ fontFamily: FONT.semibold, fontSize: 14, color: colors.foreground, marginBottom: 4 }}>
        Best Lines (Final AI Score)
      </Text>
      <Text style={{ fontFamily: FONT.medium, fontSize: 13, color: colors.foreground, marginTop: 8 }}>
        Calculating best betting lines…
      </Text>
      <View style={{ gap: 8, marginTop: 12 }}>
        {lines.map((line, i) => (
          <Text
            key={line}
            style={{
              fontFamily: FONT.body,
              fontSize: 12,
              color: step >= i ? colors.foreground : colors.mutedForeground,
            }}
          >
            {step >= i ? "✔" : "…"} {line}
          </Text>
        ))}
      </View>
    </Card>
  );
}

function FullSimulationPanel({ analytics }: { analytics: FullSimulationAnalytics }) {
  const colors = useColors();
  return (
    <Card style={{ marginBottom: 12 }}>
      <Text style={{ fontFamily: FONT.semibold, fontSize: 14, color: colors.foreground, marginBottom: 4 }}>
        Full Simulation
      </Text>
      <Text style={{ fontFamily: FONT.body, fontSize: 11, color: colors.mutedForeground, marginBottom: 12, lineHeight: 16 }}>
        Deep read on the same 10,000-run draw — score shapes, cover rates, and leverage spots you cannot get from a single projected score.
      </Text>

      <Text style={{ fontFamily: FONT.semibold, fontSize: 12, color: colors.foreground, marginBottom: 6 }}>
        Most Common Final Scores
      </Text>
      {analytics.topScores.map((s) => (
        <Text key={s.label} style={{ fontFamily: FONT.body, fontSize: 11, color: colors.mutedForeground, marginBottom: 4 }}>
          {s.away}–{s.home} ({s.pct}%)
        </Text>
      ))}

      <Text style={{ fontFamily: FONT.semibold, fontSize: 12, color: colors.foreground, marginTop: 12, marginBottom: 6 }}>
        Total Run Distribution
      </Text>
      {analytics.runDistribution.map((r) => (
        <Text key={r.totalRuns} style={{ fontFamily: FONT.body, fontSize: 11, color: colors.mutedForeground, marginBottom: 4 }}>
          {r.totalRuns} runs — {r.pct}%
        </Text>
      ))}

      {analytics.totalLine != null && analytics.totalOverProb != null ? (
        <>
          <Text style={{ fontFamily: FONT.semibold, fontSize: 12, color: colors.foreground, marginTop: 12, marginBottom: 6 }}>
            Total Over {analytics.totalLine}
          </Text>
          <Text style={{ fontFamily: FONT.body, fontSize: 11, color: colors.mutedForeground }}>
            Hits in {analytics.totalOverProb}% of sims
          </Text>
        </>
      ) : null}

      {analytics.coverFrequencies.length > 0 ? (
        <>
          <Text style={{ fontFamily: FONT.semibold, fontSize: 12, color: colors.foreground, marginTop: 12, marginBottom: 6 }}>
            Cover Frequency by Spread
          </Text>
          {analytics.coverFrequencies.slice(0, 10).map((c) => (
            <Text key={`${c.market}|${c.pick}`} style={{ fontFamily: FONT.body, fontSize: 11, color: colors.mutedForeground, marginBottom: 4 }}>
              {c.pick} — {c.hitPct}%
            </Text>
          ))}
        </>
      ) : null}

      {analytics.teamTotalProbs.length > 0 ? (
        <>
          <Text style={{ fontFamily: FONT.semibold, fontSize: 12, color: colors.foreground, marginTop: 12, marginBottom: 6 }}>
            Team Total Probabilities
          </Text>
          {analytics.teamTotalProbs.map((t) => (
            <Text key={t.pick} style={{ fontFamily: FONT.body, fontSize: 11, color: colors.mutedForeground, marginBottom: 4 }}>
              {t.pick} — {t.hitPct}%
            </Text>
          ))}
        </>
      ) : null}

      <Text style={{ fontFamily: FONT.semibold, fontSize: 12, color: colors.foreground, marginTop: 12, marginBottom: 6 }}>
        Game Script
      </Text>
      <Text style={{ fontFamily: FONT.body, fontSize: 11, color: colors.mutedForeground, marginBottom: 4 }}>
        Tie / push rate — {analytics.tieProb}%
      </Text>
      <Text style={{ fontFamily: FONT.body, fontSize: 11, color: colors.mutedForeground, marginBottom: 4 }}>
        One-run games — {analytics.oneRunGameProb}%
      </Text>
      {analytics.underdogWinProb != null ? (
        <Text style={{ fontFamily: FONT.body, fontSize: 11, color: colors.mutedForeground }}>
          Underdog wins outright — {analytics.underdogWinProb}%
        </Text>
      ) : null}
    </Card>
  );
}

function RecommendedLineRow({ row }: { row: EvaluatedGameLine }) {
  const colors = useColors();
  const metrics = deriveGameSimLineMetrics(row);
  if (!metrics) return null;
  const badge = finalAiScoreLabel(row.finalAiScore);
  const edgeColor = metrics.edgePct >= 0 ? colors.success : colors.destructive;
  const evColor = metrics.evPct >= 0 ? colors.success : colors.destructive;
  return (
    <View
      style={{
        paddingVertical: 10,
        borderTopWidth: 1,
        borderTopColor: colors.border,
      }}
    >
      <Text style={{ fontFamily: FONT.semibold, fontSize: 13, color: colors.foreground }}>
        {row.entry.pick}
        <Text style={{ fontFamily: FONT.body, fontSize: 11, color: colors.mutedForeground }}>
          {" "}
          ({row.entry.market})
        </Text>
      </Text>
      {badge ? (
        <View
          style={{
            alignSelf: "flex-start",
            marginTop: 6,
            paddingHorizontal: 8,
            paddingVertical: 3,
            borderRadius: 6,
            backgroundColor: row.finalAiScore.highRiskValuePlay
              ? "rgba(234,179,8,0.2)"
              : "rgba(34,197,94,0.15)",
          }}
        >
          <Text
            style={{
              fontFamily: FONT.bold,
              fontSize: 10,
              color: row.finalAiScore.highRiskValuePlay ? "#eab308" : colors.success,
            }}
          >
            {badge}
          </Text>
        </View>
      ) : null}
      <View style={{ flexDirection: "row", gap: 12, marginTop: 8, flexWrap: "wrap" }}>
        <MiniStat label="Sim Hit %" value={`${Math.round(metrics.simHit * 100)}%`} />
        <MiniStat
          label="Fair Odds"
          value={formatAmerican(metrics.fairOdds)}
        />
        <MiniStat label="Book Odds" value={formatAmerican(metrics.bookOdds)} />
        <MiniStat
          label="EV"
          value={`${metrics.evPct > 0 ? "+" : ""}${metrics.evPct}%`}
          valueColor={evColor}
        />
        <MiniStat
          label="Edge"
          value={`${metrics.edgePct > 0 ? "+" : ""}${metrics.edgePct}%`}
          valueColor={edgeColor}
        />
        <MiniStat label="Final AI" value={metrics.grade} />
        <MiniStat label="Confidence" value={`${metrics.confidencePct}`} />
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

function MethodRatesBlock({
  awayLabel,
  homeLabel,
  rates,
}: {
  awayLabel: string;
  homeLabel: string;
  rates: NonNullable<GameSimulationResult["methodRates"]>;
}) {
  const colors = useColors();
  const rows: { key: keyof typeof rates.away; label: string }[] = [
    { key: "ko", label: "KO" },
    { key: "tko", label: "TKO" },
    { key: "sub", label: "Sub" },
    { key: "decision", label: "Decision" },
  ];
  return (
    <View style={{ gap: 10 }}>
      {[awayLabel, homeLabel].map((label, idx) => {
        const side = idx === 0 ? rates.away : rates.home;
        return (
          <View key={label}>
            <Text style={{ fontFamily: FONT.medium, fontSize: 11, color: colors.foreground, marginBottom: 4 }}>
              {label}
            </Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
              {rows.map((r) => (
                <View
                  key={`${label}-${r.key}`}
                  style={{
                    paddingHorizontal: 8,
                    paddingVertical: 4,
                    borderRadius: 8,
                    backgroundColor: colors.surface,
                    borderWidth: 1,
                    borderColor: colors.border,
                  }}
                >
                  <Text style={{ fontFamily: FONT.body, fontSize: 10, color: colors.mutedForeground }}>
                    {r.label} {(side[r.key] * 100).toFixed(1)}%
                  </Text>
                </View>
              ))}
            </View>
          </View>
        );
      })}
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
  tiePct,
  awayLabel,
  homeLabel,
}: {
  awayPct: number;
  homePct: number;
  tiePct?: number;
  awayLabel: string;
  homeLabel: string;
}) {
  const colors = useColors();
  const tie = tiePct ?? 0;
  const showTie = tie >= 0.003;
  const awayDisplay = awayPct * (1 - tie) * 100;
  const homeDisplay = homePct * (1 - tie) * 100;
  return (
    <View style={{ gap: 6 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
        <View style={{ flex: awayPct, height: 8, borderRadius: 4, backgroundColor: "#ef4444" }} />
        {showTie ? (
          <View style={{ width: Math.max(6, tie * 80), height: 8, borderRadius: 4, backgroundColor: colors.mutedForeground }} />
        ) : null}
        <View style={{ flex: homePct, height: 8, borderRadius: 4, backgroundColor: "#eab308" }} />
      </View>
      <Text style={{ fontSize: 10, color: colors.mutedForeground, fontFamily: FONT.body }}>
        {awayLabel} {awayDisplay.toFixed(1)}%
      </Text>
      <Text style={{ fontSize: 10, color: colors.mutedForeground, fontFamily: FONT.body }}>
        {homeLabel} {homeDisplay.toFixed(1)}%
      </Text>
      {showTie ? (
        <Text style={{ fontSize: 10, color: colors.mutedForeground, fontFamily: FONT.body }}>
          Tie / push {(tie * 100).toFixed(1)}%
        </Text>
      ) : null}
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

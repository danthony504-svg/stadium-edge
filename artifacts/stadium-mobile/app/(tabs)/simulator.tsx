import { formatPropProjectedStat, propSimulationCount, propSimulationEvidence, propSimulationSummaryLabel, simulatorPropPick } from "@/lib/simulatorPropMetrics";
import Feather from "@expo/vector-icons/Feather";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
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

import { SimulatorPlayerBoxScore, supportsSimulatorBoxScore } from "@/components/SimulatorPlayerBoxScore";
import { GameReplay } from "@/components/NflDriveReplay";
import { AppHeader } from "@/components/AppHeader";
import { PremiumFeatureGate } from "@/components/PremiumFeatureGate";
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
import { isBinaryNullLineMarket } from "@/lib/binaryPropMarket";
import { enrichPropSimResults } from "@/lib/simulatorLocalSim";
import {
  fetchSimulatorFirstBasket,
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
import { normalizeSimulatorPropLines } from "@/lib/simulatorPickPool";
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
import { resolveUfcFightPhotos } from "@/lib/ufcFighterPhotos";

const gameEligibleForSim = isSimulatorPregame;

function simulatorGameEligible(sport: string, g: EspnGame): boolean {
  if (!gameEligibleForSim(g)) return false;
  const s = sport.toLowerCase();
  if ((s === "ufc" || s === "mma") && !isUfcFightRow(g)) return false;
  return true;
}

const SIM_SPORTS = ["mlb", "nba", "wnba", "nhl", "soccer", "tennis", "ufc", "nfl", "ncaaf"] as const;

function isGameLinesOnlySport(sport: string): boolean {
  return sport === "tennis" || sport === "ufc" || sport === "mma";
}

function isNameOnlySimSport(sport: string): boolean {
  return isGameLinesOnlySport(sport);
}
const SIM_COUNT = 10_000;
const MAX_PROPS = 6;

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

const SOCCER_PROP_MARKETS = [
  "player_shots",
  "player_shots_on_target",
  "player_goal_scorer_anytime",
] as const;



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

function asParkList(data: unknown): Awaited<ReturnType<typeof fetchSimulatorParkWeather>> {
  return Array.isArray(data) ? data : [];
}

function SimulatorScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();

  const [sport, setSport] = useState<string>("mlb");
  const [gameIdx, setGameIdx] = useState(0);
  const [firstBasketOpen, setFirstBasketOpen] = useState(false);
  const [expandedPlayer, setExpandedPlayer] = useState<string | null>(null);
  const [visiblePlayerCount, setVisiblePlayerCount] = useState(6);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<SelectedProp[]>([]);
  const [running, setRunning] = useState(false);
  const [scopedGameResult, setScopedGameResult] = useState<{ scope: string; result: GameSimulationResult } | null>(null);
  const [propResults, setPropResults] = useState<PropSimulationResult[]>([]);
  const [simDeepPending, setSimDeepPending] = useState(false);
  const [boxScoreScope, setBoxScoreScope] = useState<string | null>(null);
  const [ranAt, setRanAt] = useState<number | null>(null);
  const [howOpen, setHowOpen] = useState(false);
  const [linesScanStep, setLinesScanStep] = useState(0);

  const warmedRef = useRef(false);
  const runInFlightRef = useRef<AbortController | null>(null);
  const lastAutoRunKeyRef = useRef<string | null>(null);
  const isGameLinesOnly = isGameLinesOnlySport(sport);

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

  const ufcPhotosQ = useQuery({
    queryKey: ["ufc-fight-photos", game?.awayTeam, game?.homeTeam],
    queryFn: ({ signal }) =>
      resolveUfcFightPhotos(game!.awayTeam!, game!.homeTeam!, signal),
    staleTime: 24 * 60 * 60_000,
    enabled: (sport === "ufc" || sport === "mma") && !!game?.awayTeam && !!game?.homeTeam,
  });

  const awayFighterImage =
    (sport === "ufc" || sport === "mma") && game
      ? ufcPhotosQ.data?.away ?? game.awayLogo ?? null
      : game?.awayLogo ?? null;
  const homeFighterImage =
    (sport === "ufc" || sport === "mma") && game
      ? ufcPhotosQ.data?.home ?? game.homeLogo ?? null
      : game?.homeLogo ?? null;

  const gameScope = JSON.stringify([sport, game?.id]);
  useEffect(() => setVisiblePlayerCount(6), [gameScope, search]);
  const gameResult = scopedGameResult?.scope === gameScope ? scopedGameResult.result : null;
  const setGameResult = useCallback((result: GameSimulationResult | null) => {
    setScopedGameResult((previous) => {
      if (!result) return null;
      if (previous?.scope === gameScope && previous.result === result) return previous;
      return { scope: gameScope, result };
    });
  }, [gameScope]);

  // Switching games must drop prior prop selections (PP lines are per-matchup).
  useEffect(() => {
    setSelected([]);
    setPropResults([]);
    setSimDeepPending(false);
    setScopedGameResult(null);
    setRanAt(null);
    setRunning(false);
    lastAutoRunKeyRef.current = null;
    return () => {
      runInFlightRef.current?.abort();
      runInFlightRef.current = null;
    };
  }, [gameScope]);

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

  const replayAway = gameResult?.outcomes?.awayScores[0];
  const replayHome = gameResult?.outcomes?.homeScores[0];
  const replayData = sport === "nfl" && gameResult?.driveReplay?.length
    ? { sport: "nfl" as const, drives: gameResult.driveReplay }
    : sport === "nba" && replayAway != null && replayHome != null &&
        Number.isFinite(replayAway) && Number.isFinite(replayHome)
      ? { sport: "nba" as const, finalScore: { away: replayAway, home: replayHome } }
      : null;

  const showReplay = replayData != null;

  const gameFourQuestions = useMemo((): TeamFourQuestions[] => {
    if (showReplay || !gameResult || !game?.homeTeam || !game?.awayTeam || !gameLabel) return [];
    const oddsLines = realOddsToGameLines(gameOddsLines, gameLabel);
    return buildGameFourQuestions({
      gameLabel,
      homeTeam: game.homeTeam,
      awayTeam: game.awayTeam,
      sim: gameResult,
      oddsLines,
    });
  }, [showReplay, gameResult, game?.homeTeam, game?.awayTeam, gameLabel, gameOddsLines]);

  const scoringInput = useMemo(() => {
    if (showReplay || !gameResult || !game?.homeTeam || !game?.awayTeam || !gameOddsLines.length) return null;
    return {
      awayTeam: game.awayTeam,
      homeTeam: game.homeTeam,
      evalLines: gameOddsLines,
      gameSim: gameResult,
      matchupHistory: matchupQ.data ? { [gameLabel]: matchupQ.data } : {},
      matchupInjuries,
    };
  }, [showReplay, gameResult, game?.homeTeam, game?.awayTeam, gameOddsLines, gameLabel, matchupQ.data, matchupInjuries]);
  const [linePageSize, setLinePageSize] = useState(20);
  const [scoredLines, setScoredLines] = useState<{
    input: NonNullable<typeof scoringInput>;
    recommendations: Awaited<ReturnType<typeof recommendBestLinesForGame>>;
  } | null>(null);
  useEffect(() => {
    if (!scoringInput) return;
    setLinePageSize(20);
    const controller = new AbortController();
    void recommendBestLinesForGame(scoringInput, controller.signal).then(
      (recommendations) => {
        if (!controller.signal.aborted) setScoredLines({ input: scoringInput, recommendations });
      },
      () => {
        if (!controller.signal.aborted) setScoredLines({ input: scoringInput, recommendations: null });
      },
    );
    return () => controller.abort();
  }, [scoringInput]);
  const gameLineRecs = scoredLines?.input === scoringInput ? scoredLines.recommendations : null;

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

  const [analyticsResult, setAnalyticsResult] = useState<GameSimulationResult | null>(null);
  const analyticsOpen = gameResult != null && analyticsResult === gameResult;
  const fullSimAnalytics = useMemo(() => {
    if (!analyticsOpen || !gameResult || !game?.homeTeam || !game?.awayTeam || !gameLabel) return null;
    return analyzeFullSimulation({
      result: gameResult,
      evalLines: gameOddsLines,
      gameLabel,
      awayTeam: game.awayTeam,
      homeTeam: game.homeTeam,
    });
  }, [analyticsOpen, gameResult, gameOddsLines, gameLabel, game?.homeTeam, game?.awayTeam]);

  const bestLinesAnalyzing = gameResult ? !!scoringInput && scoredLines?.input !== scoringInput : running;

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

  const showPropPicker = !isGameLinesOnly;
  const propsQ = useQuery({
    queryKey: ["sim-props", sport, game?.id],
    enabled: !!game?.id && gameEligible && showPropPicker,
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

  const firstBasketQ = useQuery({
    queryKey: ["sim-first-basket", game?.id, game?.homeTeamId, game?.awayTeamId],
    enabled: showPropPicker && sport === "nba" && firstBasketOpen && gameEligible &&
      !!game?.id && !!game.homeTeamId && !!game.awayTeamId,
    queryFn: ({ signal }) => fetchSimulatorFirstBasket(game!.id, game!.homeTeamId!, game!.awayTeamId!, signal),
    staleTime: 5 * 60_000,
    retry: false,
  });

  const gamesBootstrapping =
    (gamesQ.isPending || (gamesQ.isFetching && gamesQ.fetchStatus === "fetching" && !gamesQ.data)) &&
    games.length === 0;
  const propsLoading = showPropPicker && gameEligible && propsQ.isPending;

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
    if (!showPropPicker || propsLoading) return [];
    let list = normalizeSimulatorPropLines(asPropList(propsQ.data)).filter((p) => !p?.alt && p.line != null && p.market !== "player_first_basket");
    if (sport === "soccer") {
      list = list.filter((p) => isSoccerPropMarket(p.market));
    }
    return list;
  }, [propsQ.data, propsLoading, showPropPicker, sport]);

  const filteredProps = useMemo(() => {
    let list = mains;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(
        (p) =>
          p.player.toLowerCase().includes(q) ||
          propMarketLabel(p.market).toLowerCase().includes(q),
      );
    }
    return [...list].sort((a, b) => (b.ev ?? 0) - (a.ev ?? 0));
  }, [mains, search]);

  const playerGroups = useMemo(() => {
    const groups = new Map<string, PlayerProp[]>();
    for (const prop of filteredProps) {
      const key = JSON.stringify([prop.playerTeamId, prop.athleteId ?? prop.player]);
      const group = groups.get(key);
      if (group) group.push(prop);
      else groups.set(key, [prop]);
    }
    return [...groups.entries()];
  }, [filteredProps]);

  const toggleProp = (p: PlayerProp) => {
    const side = p.overPrice != null || p.underPrice == null ? "Over" : "Under";
    if (Platform.OS !== "web") Haptics.selectionAsync();
    const isPp = p.priceSource === "PrizePicks";
    const price = side === "Over" ? p.overPrice : p.underPrice;
    if (!isPp && (price == null || p.line == null)) return;
    if (p.line == null) return;
    const label = isBinaryNullLineMarket(p.market) ? propMarketLabel(p.market) : `${p.line} ${propMarketLabel(p.market)}`;
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

  const simulatorScroll = useRef<ScrollView>(null);
  const propPickerOffset = useRef(0);

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

      const runProps = !opts?.auto && !isGameLinesOnly && selected.length > 0;

      if (!opts?.force && !opts?.auto) {
        if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      }

      const controller = new AbortController();
      const { signal } = controller;
      runInFlightRef.current = controller;
      setRunning(true);
      if (opts?.force) {
        setGameResult(null);
        setPropResults([]);
      } else if (!opts?.auto) {
        setGameResult(null);
        setPropResults([]);
      }

      try {
        const wx = weatherImpact;
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
          includeDriveReplay: sport === "nfl",
        }, signal);
        if (signal.aborted) return;
        if (gr) {
          setGameResult(gr);
          if (opts?.force && ((sport === "nfl" && gr.driveReplay?.length) ||
              (sport === "nba" && gr.outcomes?.homeScores.length && gr.outcomes?.awayScores.length))) {
            simulatorScroll.current?.scrollTo({ y: 0, animated: true });
          }
          const ran = Date.now();
          setRanAt(ran);
          if (!opts?.auto) setBoxScoreScope(JSON.stringify([sport, game.id]));
          if (fp) {
            rememberGameSim(sport, game.id, { gameResult: gr, ranAt: ran, fingerprint: fp });
            lastAutoRunKeyRef.current = fingerprintKey(fp);
          }
        } else if (opts?.auto) {
          lastAutoRunKeyRef.current = null;
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
                  const { results } = await searchSimulatorPlayer(s.player, signal);
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

          if (signal.aborted) return;
          const phForSim: Record<string, { labels?: string[]; recent?: { stats?: Record<string, string> }[] }> =
            {};
          await Promise.all(
            simProps.map(async (s) => {
              if (!s.athleteId) return;
              try {
                const h = await fetchSimulatorPlayerHistory({ sport, athleteId: s.athleteId }, signal);
                const recent = (h.recent ?? []).slice(0, 10).map((g) => ({ stats: g.stats }));
                if (recent.length) {
                  phForSim[`${s.player}#${s.athleteId}`] = { labels: h.labels, recent };
                }
              } catch {
                /* honest no-history skip */
              }
            }),
          );
          if (signal.aborted) return;
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
              signal,
            ),
            phForSim,
          );
          if (signal.aborted) return;
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
              signal,
            ),
            phForSim,
          );
          if (signal.aborted) return;
          setPropResults(prDeep);
          setSimDeepPending(false);
        }
      } finally {
        if (runInFlightRef.current === controller) {
          runInFlightRef.current = null;
          setRunning(false);
        }
      }
    },
    [
      gameEligible,
      game,
      simInputFingerprint,
      sport,
      isGameLinesOnly,
      selected,
      gameOddsLines,
      setGameResult,
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
  }, [simInputsReady, game?.id, sport, simInputFingerprint, runSimulation, setGameResult]);

  const canRun = gameEligible && !!game && !running;

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
        ref={simulatorScroll}
        keyboardShouldPersistTaps="handled"
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
              <Pill key={id} label={label} active={sport === id} onPress={() => { setSport(id); setGameIdx(0); setSelected([]); setFirstBasketOpen(false); setExpandedPlayer(null); }} />
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
            <Text style={{ color: colors.foreground, fontFamily: FONT.semibold, marginHorizontal: 16, marginBottom: 8 }}>
              1. Pick Game
            </Text>
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
                    onPress={() => { setGameIdx(i); setSelected([]); setFirstBasketOpen(false); setExpandedPlayer(null); }}
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

            {gameResult && replayData ? (
              <View style={{ paddingHorizontal: 16 }}>
                <GameReplay
                  key={`${game.id}:${ranAt}`}
                  {...replayData}
                  awayLogo={game.awayLogo}
                  homeLogo={game.homeLogo}
                  props={propResults}
                  selectedProps={selected}
                  propsRunning={running && selected.length > 0}
                  onSelectProps={() => simulatorScroll.current?.scrollTo({ y: propPickerOffset.current, animated: true })}
                  simulations={gameResult.simulations}
                  away={game.awayAbbr ?? game.awayTeam ?? "Away"}
                  home={game.homeAbbr ?? game.homeTeam ?? "Home"}
                />
              </View>
            ) : null}

            {/* Matchup header */}
            <Card style={{ marginHorizontal: 16, marginBottom: 16 }}>
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                <TeamCol
                  name={game.awayTeam ?? ""}
                  logo={awayFighterImage}
                  record={game.awayAbbr ?? ""}
                  align="left"
                  photo={sport === "ufc" || sport === "mma"}
                />
                <Text style={{ color: colors.mutedForeground, fontFamily: FONT.bold, fontSize: 16 }}>@</Text>
                <TeamCol
                  name={game.homeTeam ?? ""}
                  logo={homeFighterImage}
                  record={game.homeAbbr ?? ""}
                  align="right"
                  photo={sport === "ufc" || sport === "mma"}
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

            {/* Player prop builder */}
            {showPropPicker && (
              <View
                style={{ paddingHorizontal: 16, marginBottom: 16 }}
                onLayout={({ nativeEvent }) => {
                  propPickerOffset.current = nativeEvent.layout.y;

                }}
              >
                <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 8 }}>
                  <View>
                    <Text style={{ fontFamily: FONT.semibold, fontSize: 16, color: colors.foreground }}>
                      2. Add Player Props
                    </Text>
                    <Text style={{ fontFamily: FONT.body, fontSize: 12, color: colors.mutedForeground }}>
                      Optional · Add up to {MAX_PROPS} props
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
                            {s.player} · {s.label}
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

                {sport === "nba" && gameEligible ? (
                  <Card style={{ marginBottom: 12, gap: 8 }}>
                    <Pressable accessibilityRole="button" accessibilityState={{ expanded: firstBasketOpen }}
                      onPress={() => setFirstBasketOpen((open) => !open)}
                      style={{ minHeight: 44, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                      <Text style={{ color: colors.foreground, fontFamily: FONT.semibold }}>First Basket</Text>
                      <Feather name={firstBasketOpen ? "chevron-up" : "chevron-down"} size={16} color={colors.mutedForeground} />
                    </Pressable>
                    {firstBasketOpen ? (
                      firstBasketQ.data?.pick ? (
                        <>
                          <Text style={{ color: colors.primary, fontFamily: FONT.semibold }}>
                            {firstBasketQ.data.pick.player} · History-based pick
                          </Text>
                          <Text style={{ color: colors.mutedForeground }}>
                            Made the game's first field goal in {firstBasketQ.data.pick.hits} of {firstBasketQ.data.pick.starts} verified recent starts. Uses recent starters.
                          </Text>
                        </>
                      ) : (
                        <Text style={{ color: colors.mutedForeground }}>
                          {firstBasketQ.isFetching ? "Checking recent opening baskets…" : firstBasketQ.isError
                            ? "Couldn’t load opening basket history."
                            : "No First Basket pick from the verified recent starts."}
                        </Text>
                      )
                    ) : null}
                  </Card>
                ) : null}

                {propsLoading ? (
                  <Loading label="Loading player props…" />
                ) : !gameEligible ? (
                  <Text style={{ fontFamily: FONT.body, fontSize: 13, color: colors.mutedForeground, textAlign: "center", paddingVertical: 16 }}>
                    This game has already started — pick an upcoming matchup to simulate props.
                  </Text>
                ) : playerGroups.length === 0 ? (
                  <Text style={{ fontFamily: FONT.body, fontSize: 13, color: colors.mutedForeground, textAlign: "center", paddingVertical: 16 }}>
                    {propsQ.isFetching
                      ? "Loading player props…"
                      : search.trim() ? "No matching players or stats." : "No player props posted for this game yet."}
                  </Text>
                ) : (
                  <View style={{ gap: 8 }}>
                    {playerGroups.slice(0, visiblePlayerCount).map(([key, props]) => {
                      const player = props[0]!;
                      const expanded = expandedPlayer === key;
                      return (
                        <Card key={key} style={{ gap: 8, padding: 10 }}>
                          <Pressable accessibilityRole="button" accessibilityState={{ expanded }}
                            onPress={() => setExpandedPlayer(expanded ? null : key)}
                            style={{ minHeight: 44, flexDirection: "row", alignItems: "center", gap: 8 }}>
                            <SimAvatar headshot={player.headshot} name={player.player} />
                            <Text style={{ flex: 1, fontFamily: FONT.semibold, color: colors.foreground }}>{player.player}</Text>
                            <Feather name={expanded ? "chevron-up" : "chevron-down"} size={16} color={colors.mutedForeground} />
                          </Pressable>
                          {expanded ? props.map((p) => {
                            const added = selected.some((pick) => pick.player === p.player &&
                              pick.market === p.market && pick.line === p.line);
                            const model = added ? propResults.find((result) =>
                              result.player === p.player && result.market === p.market && result.line === p.line,
                            ) : undefined;
                            const modelPick = model ? simulatorPropPick(model) : null;
                            const binary = isBinaryNullLineMarket(p.market);
                            const playsAtHome = p.playerTeamId === game.homeTeamId;
                            const opponent = playsAtHome ? game.awayTeam : game.homeTeam;
                            const opponentPace = playsAtHome ? matchupQ.data?.awayPace : matchupQ.data?.homePace;
                            const matchupNote = sport === "nba" && opponentPace != null &&
                              Number.isFinite(opponentPace)
                              ? ` · Opp. pace ${opponentPace.toFixed(1)} possessions per 48 min`
                              : p.position ? ` · ${p.position}` : "";
                            return (
                              <View key={`${p.market}|${p.line}`} style={{ borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 8 }}>
                                <Text style={{ color: colors.foreground, fontFamily: FONT.semibold }}>{propMarketLabel(p.market)}</Text>
                                <Text style={{ color: colors.mutedForeground }}>
                                  vs {opponent ?? "selected opponent"}{matchupNote}
                                </Text>
                                <Pressable
                                  accessibilityRole="button"
                                  accessibilityLabel={`${added ? "Remove" : "Add"} ${p.player}, ${propMarketLabel(p.market)}${binary ? "" : `, ${p.line}`}`}
                                  accessibilityState={{ selected: added }}
                                  onPress={() => toggleProp(p)}
                                  style={{ minHeight: 44, justifyContent: "center", paddingHorizontal: 8 }}
                                >
                                  <Text style={{ color: colors.foreground, fontFamily: FONT.semibold }}>
                                    {added ? "Added ✓" : "Add prop"}{binary ? "" : ` · Line ${p.line}`}
                                  </Text>
                                </Pressable>
                                {modelPick ? (
                                  <Text style={{ color: colors.primary, fontFamily: FONT.semibold }}>
                                    Simulator pick · {binary
                                      ? modelPick.side === "Over" ? "Yes" : "No"
                                      : `${modelPick.side} ${p.line}`} · {(modelPick.probability * 100).toFixed(1)}% sim hit
                                  </Text>
                                ) : null}
                              </View>
                            );
                          }) : null}
                        </Card>
                      );
                    })}
                    {visiblePlayerCount < playerGroups.length ? (
                      <Pressable accessibilityRole="button" onPress={() => setVisiblePlayerCount((count) => count + 6)}
                        style={{ minHeight: 44, justifyContent: "center" }}>
                        <Text style={{ color: colors.primary, fontFamily: FONT.semibold }}>Show more players</Text>
                      </Pressable>
                    ) : null}
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
                  {running ? "Running…" : showPropPicker ? "3. Run Simulation" : "Run Simulation"}
                </Text>
              </LinearGradient>
            </Pressable>

            {!showReplay && (running || gameResult) ? (
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
                        {`${SIM_COUNT.toLocaleString()} game sims`}
                      </Text>
                    </View>
                    {ranAt ? (
                      <Text style={{ fontFamily: FONT.body, fontSize: 11, color: colors.mutedForeground }}>
                        Updated just now
                      </Text>
                    ) : null}
                  </View>
                </View>

                {gameResult && ranAt != null && boxScoreScope === gameScope &&
                  game.homeTeamId && game.awayTeamId && game.startsAt && supportsSimulatorBoxScore(sport) ? (
                  <SimulatorPlayerBoxScore
                    key={gameScope}
                    sport={sport}
                    homeTeamId={game.homeTeamId}
                    awayTeamId={game.awayTeamId}
                    home={game.homeTeam ?? "Home"}
                    away={game.awayTeam ?? "Away"}
                    startsAt={game.startsAt}
                    run={ranAt}
                  />
                ) : null}

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
                    {showReplay ? null : bestLinesAnalyzing ? (
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
                        {displayBestLines.slice(0, linePageSize).map((row, index) => (
                          <RecommendedLineRow key={`${row.entry.market}|${row.entry.pick}|${index}`} row={row} />
                        ))}
                        {linePageSize < displayBestLines.length ? (
                          <Pressable
                            accessibilityRole="button"
                            onPress={() => setLinePageSize((size) => size + 20)}
                            style={{ minHeight: 44, justifyContent: "center" }}
                          >
                            <Text style={{ color: colors.primary, fontFamily: FONT.semibold }}>
                              Show more lines ({Math.min(linePageSize, displayBestLines.length)} of {displayBestLines.length})
                            </Text>
                          </Pressable>
                        ) : null}
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
                    {gameResult.outcomes ? (
                      <>
                        <Pressable
                          accessibilityRole="button"
                          accessibilityState={{ expanded: analyticsOpen }}
                          onPress={() => setAnalyticsResult(analyticsOpen ? null : gameResult)}
                          style={{ minHeight: 44, justifyContent: "center", marginBottom: 12 }}
                        >
                          <Text style={{ color: colors.primary, fontFamily: FONT.semibold }}>
                            {analyticsOpen ? "Hide game analytics" : "Show game analytics"}
                          </Text>
                        </Pressable>
                        {fullSimAnalytics ? <FullSimulationPanel analytics={fullSimAnalytics} /> : null}
                      </>
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
                      Simulator Picks
                    </Text>
                    <Text style={{ color: colors.mutedForeground, fontSize: 11, marginBottom: 8 }}>
                      {propSimulationSummaryLabel(propResults)}
                    </Text>
                    {simDeepPending ? (
                      <Text style={{ color: colors.mutedForeground }}>Simulation updating…</Text>
                    ) : null}
                    {propResults.map((r) => {
                      const pick = simulatorPropPick(r);
                      const binary = isBinaryNullLineMarket(r.market);
                      const selection = pick && (binary
                        ? `${pick.side === "Over" ? "Yes" : "No"} · ${propMarketLabel(r.market)}`
                        : `${pick.side} ${r.line} ${propMarketLabel(r.market)}`);
                      const projected = formatPropProjectedStat(r);
                      return (
                        <View key={r.key} style={{ paddingVertical: 10, borderTopWidth: 1, borderTopColor: colors.border }}>
                          <Text style={{ fontFamily: FONT.semibold, fontSize: 14, color: pick ? colors.primary : colors.foreground }}>
                            {r.player} · {selection ?? "No simulator pick"}
                          </Text>
                          <Text style={{ color: colors.mutedForeground, marginTop: 4 }}>
                            {pick
                              ? `Why: This side hit in ${(pick.probability * 100).toFixed(1)}% of simulations.${!binary && projected !== "—" ? ` Projected ${propMarketLabel(r.market).toLowerCase()}: ${projected}.` : ""}`
                              : propSimulationCount(r) ? "The simulation didn’t establish a side above 50%." : "A simulation is unavailable for this prop."}
                          </Text>
                          <Text style={{ color: colors.mutedForeground, fontSize: 11, marginTop: 4 }}>{propSimulationEvidence(r)}</Text>
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
                Deep simulations target {SIM_COUNT.toLocaleString()} Monte Carlo draws. Each prop shows its actual draw count;
                history estimates are labeled separately. Model edge is the estimated hit chance minus the price's
                break-even chance, in percentage points. Quality and model scores are not win probabilities.
                Binary props show Yes/No outcomes. Supported models use recent game logs and applicable context.
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

export default function SimulatorScreenGated() {
  return (
    <PremiumFeatureGate featureId="simulator">
      <SimulatorScreen />
    </PremiumFeatureGate>
  );
}

function TeamCol({
  name,
  logo,
  record,
  align,
  photo = false,
}: {
  name: string;
  logo?: string | null;
  record: string;
  align: "left" | "right";
  photo?: boolean;
}) {
  const colors = useColors();
  return (
    <View style={{ flex: 1, alignItems: align === "left" ? "flex-start" : "flex-end", gap: 6 }}>
      {logo ? (
        <Image
          source={{ uri: logo }}
          style={{
            width: 40,
            height: 40,
            borderRadius: photo ? 20 : 10,
            backgroundColor: colors.surface,
          }}
          contentFit={photo ? "cover" : "contain"}
        />
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

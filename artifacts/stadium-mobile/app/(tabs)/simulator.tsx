import Feather from "@expo/vector-icons/Feather";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { useFocusEffect } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { Image } from "expo-image";
import { useMemo, useState, useEffect, useRef, useCallback, type ReactNode } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
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
} from "@/lib/api";
import { buildGameInjuryReport } from "@/lib/injuries";
import {
  fetchSimulatorGameOutcome,
  fetchSimulatorGames,
  fetchSimulatorInjuries,
  fetchSimulatorMatchupHistory,
  fetchSimulatorMlbProbables,
  fetchSimulatorOdds,
  fetchSimulatorParkWeather,
  isSimulatorPregame,
  warmSimulatorApi,
} from "@/lib/simulatorApi";

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
import { formatAmerican } from "@/lib/format";
import { SPORTS } from "@/lib/sports";
import {
  cachedSimGames,
  pruneSimGamesCache,
  rememberSimGames,
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

function asParkList(data: unknown): Awaited<ReturnType<typeof fetchSimulatorParkWeather>> {
  return Array.isArray(data) ? data : [];
}

function SimulatorScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();

  const [sport, setSport] = useState<string>("mlb");
  const [gameIdx, setGameIdx] = useState(0);
  const [running, setRunning] = useState(false);
  const [scopedGameResult, setScopedGameResult] = useState<{ scope: string; result: GameSimulationResult } | null>(null);
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
  const gameResult = scopedGameResult?.scope === gameScope ? scopedGameResult.result : null;
  const setGameResult = useCallback((result: GameSimulationResult | null) => {
    setScopedGameResult((previous) => {
      if (!result) return null;
      if (previous?.scope === gameScope && previous.result === result) return previous;
      return { scope: gameScope, result };
    });
  }, [gameScope]);

  // Switching games clears the previous simulation and cancels any pending run.
  useEffect(() => {
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

  const gamesBootstrapping =
    (gamesQ.isPending || (gamesQ.isFetching && gamesQ.fetchStatus === "fetching" && !gamesQ.data)) &&
    games.length === 0;

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

  const runSimulation = useCallback(
    async () => {
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
      if (fp) {
        const cached = getCachedGameSim(sport, game.id, fp);
        if (cached) {
          setGameResult(cached.gameResult);
          setRanAt(cached.ranAt);
          lastAutoRunKeyRef.current = fingerprintKey(fp);
          return;
        }
      }


      const controller = new AbortController();
      const { signal } = controller;
      runInFlightRef.current = controller;
      setRunning(true);

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
          const ran = Date.now();
          setRanAt(ran);
          if (fp) {
            rememberGameSim(sport, game.id, { gameResult: gr, ranAt: ran, fingerprint: fp });
            lastAutoRunKeyRef.current = fingerprintKey(fp);
          }
        } else {
          lastAutoRunKeyRef.current = null;
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
    void runSimulation();
  }, [simInputsReady, game?.id, sport, simInputFingerprint, runSimulation, setGameResult]);

  const playerBoxScore = gameResult && ranAt != null && game?.homeTeamId && game.awayTeamId &&
    game.startsAt && supportsSimulatorBoxScore(sport) ? (
    <SimulatorPlayerBoxScore
      key={gameScope}
      eventId={game.id}
      sport={sport}
      homeTeamId={game.homeTeamId}
      awayTeamId={game.awayTeamId}
      home={game.homeTeam ?? "Home"}
      away={game.awayTeam ?? "Away"}
      startsAt={game.startsAt}
      run={ranAt}
    />
  ) : null;


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
              <Pill key={id} label={label} active={sport === id} onPress={() => { setSport(id); setGameIdx(0); }} />
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
                    onPress={() => { setGameIdx(i); }}
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
                  matchupTime={formatGameWhen(game.startsAt)}
                  endOfGame={playerBoxScore}
                  simulations={gameResult.simulations}
                  away={game.awayAbbr ?? game.awayTeam ?? "Away"}
                  home={game.homeAbbr ?? game.homeTeam ?? "Home"}
                />
              </View>
            ) : null}

            {!showReplay ? (
              <View style={{ marginHorizontal: 16, marginBottom: 16, flexDirection: "row", alignItems: "center", gap: 8 }}>
                {awayFighterImage ? (
                  <Image source={{ uri: awayFighterImage }} style={{ width: 28, height: 28 }} contentFit="contain" />
                ) : null}
                <View style={{ flex: 1 }}>
                  <Text style={{ color: colors.foreground, fontFamily: FONT.semibold }}>
                    {game.awayTeam ?? "Away"} @ {game.homeTeam ?? "Home"}
                  </Text>
                  <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>{formatGameWhen(game.startsAt)}</Text>
                </View>
                {homeFighterImage ? (
                  <Image source={{ uri: homeFighterImage }} style={{ width: 28, height: 28 }} contentFit="contain" />
                ) : null}
              </View>
            ) : null}

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

            {running && !gameResult ? (
              <View accessibilityLiveRegion="polite" style={{ flexDirection: "row", alignItems: "center", gap: 8, marginHorizontal: 16, marginBottom: 16 }}>
                <ActivityIndicator color={colors.primary} />
                <Text style={{ color: colors.mutedForeground }}>Running simulation…</Text>
              </View>
            ) : null}

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
            {gameResult && (
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

                {!showReplay ? playerBoxScore : null}

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
                Deep simulations target {SIM_COUNT.toLocaleString()} Monte Carlo draws. The player box score samples recent game logs.
                Model edge is the estimated hit chance minus the price's break-even chance, in percentage points.
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

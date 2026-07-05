import { Feather, MaterialCommunityIcons } from "@expo/vector-icons";
import { useFocusEffect } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import * as Haptics from "expo-haptics";
import { useMemo, useState, useEffect, useRef, useCallback } from "react";
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
  SimRunStats,
} from "@/lib/api";
import {
  formatSimCountLabel,
  isFullDeepSimulation,
  mergeSimRuns,
  REQUESTED_DEEP_SIMS,
} from "@/lib/simRunDisplay";
import { buildGameInjuryReport } from "@/lib/injuries";
import { loadSimulatorProps } from "@/lib/simulatorProps";
import { enrichPropSimResults, mergeServerOverLocal } from "@/lib/propSimFallback";
import {
  fetchSimulatorGameOutcome,
  fetchSimulatorGames,
  fetchSimulatorInjuries,
  fetchSimulatorMatchupHistory,
  fetchSimulatorParkWeather,
  fetchSimulatorPlayerHistory,
  fetchSimulatorPropSimulationsBatch,
  isSimulatorPregame,
  searchSimulatorPlayer,
  warmSimulatorApi,
} from "@/lib/simulatorApi";

import { propMarketLabel } from "@/lib/propMarketLabel";
import type { CombinedPickScore } from "@/lib/pickScore";
import {
  buildSimulatorPpPropPool,
  buildSimulatorPropPool,
  buildSimulatorFullPropPool,
  gradeSimulatorProps,
  type SimulatorPlayerHistorySlice,
  type SimulatorSelectedProp,
} from "@/lib/simulatorPickPool";
import {
  collectExtraSimCandidates,
  optimizeSimulatorTicket,
} from "@/lib/simulatorTicketOptimizer";
import {
  expectedProjection,
  formatEdgeDisplay,
  formatSimHitDisplay,
  isVisibleByDefault,
  primaryPickReason,
  resolveDisplayEdge,
  topSimulatorPickReasons,
  simulatorSimConfidence,
} from "@/lib/simulatorRecommendations";
import { isValidPropSimData } from "@/lib/simPropValidity";
import {
  advanceSimProgress,
  buildSimSnapshot,
  buildTopAiPicks,
  completeSimProgress,
  formatAverageScoreLine,
  formatFinalScoreLine,
  gameAiPrediction,
  gameConfidenceLevel,
  initialSimProgress,
  propPickRecommendation,
  rankSimulatorProps,
  simulationImpactNotes,
  type SimProgressStep,
  type SimRunSnapshot,
  whatChangedSinceLastRun,
} from "@/lib/simulatorPresentation";
import { formatAmerican } from "@/lib/format";
import { SPORTS } from "@/lib/sports";
import {
  pruneSimGamesCache,
  rememberSimGames,
  rememberSimProps,
} from "@/lib/simulatorSessionCache";

const gameEligibleForSim = isSimulatorPregame;

const SIM_SPORTS = ["mlb", "nba", "wnba", "nhl", "soccer"] as const;
const REQUESTED_SIMS = REQUESTED_DEEP_SIMS;
const MAX_PROPS = 6;

type SimMode = "game" | "props" | "full";

type SelectedProp = SimulatorSelectedProp;

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
  const [simulatedProps, setSimulatedProps] = useState<SelectedProp[]>([]);
  const [showAllPicks, setShowAllPicks] = useState(false);
  const [running, setRunning] = useState(false);
  const [gameResult, setGameResult] = useState<GameSimulationResult | null>(null);
  const [propResults, setPropResults] = useState<PropSimulationResult[]>([]);
  const [simDeepPending, setSimDeepPending] = useState(false);
  const [playerHistory, setPlayerHistory] = useState<Record<string, SimulatorPlayerHistorySlice>>({});
  const [ranAt, setRanAt] = useState<number | null>(null);
  const [howOpen, setHowOpen] = useState(false);
  const [simProgress, setSimProgress] = useState<SimProgressStep[]>([]);
  const [simDebugOpen, setSimDebugOpen] = useState(__DEV__);
  const [gameSimRun, setGameSimRun] = useState<SimRunStats | null>(null);
  const [propSimRun, setPropSimRun] = useState<SimRunStats | null>(null);
  const [whatChanged, setWhatChanged] = useState<string[]>([]);
  const [ticketOptimization, setTicketOptimization] = useState<string[]>([]);
  const prevSnapshotRef = useRef<SimRunSnapshot | null>(null);
  const lastSimRequestRef = useRef<{
    simProps: Array<{
      player: string;
      market: string;
      line: number;
      side: "Over" | "Under";
      athleteId: string | null;
    }>;
    phForSim: Record<string, { labels?: string[]; recent?: { stats?: Record<string, string> }[] }>;
  } | null>(null);

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

  const allPropsWithAlts = useMemo(() => {
    if (propsLoading) return [];
    let list = asPropList(propsQ.data).filter((p) => p.line != null);
    if (sport === "soccer") {
      list = list.filter((p) => isSoccerPropMarket(p.market));
    }
    return list;
  }, [propsQ.data, propsLoading, sport]);

  const fullPropPool = useMemo(() => {
    if (!gameLabel || !game) return [];
    return buildSimulatorFullPropPool(allPropsWithAlts, gameLabel, sport, {
      homeTeamId: game.homeTeamId,
      awayTeamId: game.awayTeamId,
      homeAbbr: game.homeAbbr,
      awayAbbr: game.awayAbbr,
    });
  }, [allPropsWithAlts, gameLabel, game, sport]);

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
    setSimulatedProps([]);
    setShowAllPicks(false);
    setWhatChanged([]);
    setTicketOptimization([]);
    setGameSimRun(null);
    setPropSimRun(null);
    setPlayerHistory({});
    setSimProgress(initialSimProgress());
    let progress = initialSimProgress();
    const bump = (id: string) => {
      progress = advanceSimProgress(progress, id);
      setSimProgress([...progress]);
    };

    let gr: GameSimulationResult | null = null;
    let finalPropResults: PropSimulationResult[] = [];
    let toSim: SelectedProp[] = [];
    let ph: Record<string, SimulatorPlayerHistorySlice> = {};

    try {
      const wx = weatherImpact;
      bump("lineups");
      if (matchupQ.data == null) {
        try {
          await matchupQ.refetch();
        } catch {
          /* cached matchup optional */
        }
      }
      bump("injuries");
      bump("weather");
      bump("odds");

      if (mode === "game" || mode === "full") {
        gr = await fetchSimulatorGameOutcome({
          sport,
          homeTeamId: game.homeTeamId,
          awayTeamId: game.awayTeamId,
          homeTeam: game.homeTeam,
          awayTeam: game.awayTeam,
          simulations: REQUESTED_SIMS,
          weatherImpact: wx,
        });
        setGameResult(gr);
        if (gr) setGameSimRun(gr);
      }
      if ((mode === "props" || mode === "full") && selected.length > 0) {
        toSim = [...selected];
        setSimulatedProps(toSim);
        const teamTokens = [game.homeTeam, game.awayTeam]
          .filter(Boolean)
          .map((t) => t!.split(/\s+/).pop()!.toLowerCase());

        const resolveSimProps = async (props: SelectedProp[]) =>
          Promise.all(
            props.map(async (s) => {
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

        const loadHistoryForSimProps = async (
          simProps: Array<{
            player: string;
            athleteId: string | null;
          }>,
        ) => {
          const phLocal: Record<string, SimulatorPlayerHistorySlice> = { ...ph };
          const phForSim: Record<string, { labels?: string[]; recent?: { stats?: Record<string, string> }[] }> = {};
          await Promise.all(
            simProps.map(async (s) => {
              if (!s.athleteId) return;
              const cacheKey = `${s.player}#${s.athleteId}`;
              if (phLocal[cacheKey]) {
                const hit = phLocal[cacheKey];
                phForSim[cacheKey] = {
                  labels: hit.labels,
                  recent: (hit.recent ?? []).slice(0, 10).map((g) => ({
                    stats: g.stats as Record<string, string>,
                  })),
                };
                return;
              }
              try {
                const h = await fetchSimulatorPlayerHistory({ sport, athleteId: s.athleteId });
                const recent = (h.recent ?? []).slice(0, 10).map((g) => ({
                  date: g.date ?? undefined,
                  opp: g.opponentName ?? undefined,
                  stats: g.stats as Record<string, unknown>,
                }));
                if (recent.length) {
                  phLocal[cacheKey] = { player: s.player, labels: h.labels, recent };
                  phForSim[cacheKey] = {
                    labels: h.labels,
                    recent: (h.recent ?? []).slice(0, 10).map((g) => ({ stats: g.stats })),
                  };
                }
              } catch {
                /* honest no-history skip */
              }
            }),
          );
          ph = phLocal;
          setPlayerHistory(phLocal);
          return phForSim;
        };

        const runDeepPropSims = async (
          simProps: Array<{
            player: string;
            market: string;
            line: number;
            side: "Over" | "Under";
            athleteId: string | null;
          }>,
          phForSim: Record<string, { labels?: string[]; recent?: { stats?: Record<string, string> }[] }>,
        ) => {
          if (!simProps.length) return [] as PropSimulationResult[];
          const prQuickBatch = await fetchSimulatorPropSimulationsBatch(
            sport,
            simProps,
            {
              homeTeam: game.homeTeam,
              awayTeam: game.awayTeam,
              homeTeamId: game.homeTeamId,
              awayTeamId: game.awayTeamId,
              weatherImpact: wx,
              tier: "quick",
              simulations: REQUESTED_SIMS,
            },
          );
          const prQuick = enrichPropSimResults(prQuickBatch.props, phForSim);
          setPropResults((prev) => mergeServerOverLocal(prev, prQuick));
          setSimDeepPending(true);
          const prDeepBatch = await fetchSimulatorPropSimulationsBatch(
            sport,
            simProps,
            {
              homeTeam: game.homeTeam,
              awayTeam: game.awayTeam,
              homeTeamId: game.homeTeamId,
              awayTeamId: game.awayTeamId,
              weatherImpact: wx,
              tier: "deep",
              simulations: REQUESTED_SIMS,
            },
          );
          const prDeep = enrichPropSimResults(prDeepBatch.props, phForSim);
          setPropSimRun(prDeepBatch.simRun);
          setSimDeepPending(false);
          return mergeServerOverLocal(prQuick, prDeep);
        };

        const primarySimProps = await resolveSimProps(toSim);
        const phForSim = await loadHistoryForSimProps(primarySimProps);
        lastSimRequestRef.current = { simProps: primarySimProps, phForSim };
        finalPropResults = await runDeepPropSims(primarySimProps, phForSim);

        const existingKeys = new Set(finalPropResults.map((r) => r.key));
        const extraCandidates = collectExtraSimCandidates(toSim, fullPropPool, existingKeys);
        if (extraCandidates.length > 0) {
          const extraSimProps = await resolveSimProps(extraCandidates);
          const extraPhForSim = await loadHistoryForSimProps(extraSimProps);
          const mergedPhForSim = { ...phForSim, ...extraPhForSim };
          const extraResults = await runDeepPropSims(extraSimProps, mergedPhForSim);
          const byKey = new Map<string, PropSimulationResult>();
          for (const r of [...finalPropResults, ...extraResults]) byKey.set(r.key, r);
          finalPropResults = [...byKey.values()];
        }

        if (gameLabel) {
          const optimized = optimizeSimulatorTicket(toSim, finalPropResults, {
            gameLabel,
            sport,
            propPool: [...propPool, ...ppPropPool],
            fullPool: [...fullPropPool, ...ppPropPool],
            matchupHistory: matchupQ.data ? { [gameLabel]: matchupQ.data } : {},
            matchupInjuries,
            playerHistory: ph,
            injuryTeams: Array.isArray(injuriesQ.data) ? injuriesQ.data : [],
          });
          toSim = optimized.props;
          finalPropResults = optimized.results;
          setSelected(optimized.props);
          setSimulatedProps(optimized.props);
          setTicketOptimization(optimized.explanation);
        }

        setPropResults(finalPropResults);
      }
      bump("sim");
      setSimProgress(completeSimProgress(progress));

      const injuryCount =
        matchupInjuries[gameLabel ?? ""]?.sides.reduce(
          (n, s) => n + (s.keyPlayers?.length ?? 0),
          0,
        ) ?? 0;

      if (finalPropResults.length && toSim.length && gameLabel) {
        const simMap = new Map(
          finalPropResults.map((r) => [r.key, { hitProbability: r.hitProbability }]),
        );
        const simRows = new Map(finalPropResults.map((r) => [r.key, r]));
        const localScores = gradeSimulatorProps(toSim, gameLabel, sport, [...propPool, ...ppPropPool], {
          matchupHistory: matchupQ.data ? { [gameLabel]: matchupQ.data } : {},
          matchupInjuries,
          playerHistory: ph,
          propSimulations: simMap,
          propSimRows: simRows,
          injuryTeams: Array.isArray(injuriesQ.data) ? injuriesQ.data : [],
        });
        const ranked = rankSimulatorProps(finalPropResults, localScores);
        const snapshot = buildSimSnapshot({
          gameId: game.id,
          gameResult: gr,
          topPropKey: ranked[0]?.key ?? null,
          weatherLabel,
          injuryCount,
        });
        setWhatChanged(
          whatChangedSinceLastRun(prevSnapshotRef.current, snapshot, {
            home: game.homeTeam,
            away: game.awayTeam,
          }),
        );
        prevSnapshotRef.current = snapshot;
      } else if (gr) {
        const snapshot = buildSimSnapshot({
          gameId: game.id,
          gameResult: gr,
          topPropKey: null,
          weatherLabel,
          injuryCount:
            matchupInjuries[gameLabel ?? ""]?.sides.reduce(
              (n, s) => n + (s.keyPlayers?.length ?? 0),
              0,
            ) ?? 0,
        });
        setWhatChanged(
          whatChangedSinceLastRun(prevSnapshotRef.current, snapshot, {
            home: game.homeTeam,
            away: game.awayTeam,
          }),
        );
        prevSnapshotRef.current = snapshot;
      }

      setRanAt(Date.now());
    } finally {
      setRunning(false);
      setSimProgress([]);
    }
  };

  const canRun =
    gameEligible &&
    !!game &&
    !running &&
    (mode === "game" ||
      ((mode === "props" || mode === "full") && selected.length >= 1));

  const propScores = useMemo(() => {
    if (!propResults.length || !gameLabel || !simulatedProps.length) {
      return new Map<string, CombinedPickScore>();
    }
    const simMap = new Map(
      propResults.map((r) => [r.key, { hitProbability: r.hitProbability }]),
    );
    const simRows = new Map(propResults.map((r) => [r.key, r]));
    return gradeSimulatorProps(simulatedProps, gameLabel, sport, [...propPool, ...ppPropPool], {
      matchupHistory: matchupQ.data ? { [gameLabel]: matchupQ.data } : {},
      matchupInjuries,
      playerHistory,
      propSimulations: simMap,
      propSimRows: simRows,
      injuryTeams: Array.isArray(injuriesQ.data) ? injuriesQ.data : [],
    });
  }, [
    propResults,
    simulatedProps,
    gameLabel,
    matchupQ.data,
    matchupInjuries,
    playerHistory,
    propPool,
    ppPropPool,
    injuriesQ.data,
    sport,
  ]);

  const oddsByKey = useMemo(
    () => new Map(simulatedProps.map((s) => [`${s.player}|${s.market}|${s.line}|${s.side}`, s.odds])),
    [simulatedProps],
  );

  // If results used ESPN game-log fallback, retry full Monte Carlo when the API is live.
  useEffect(() => {
    const req = lastSimRequestRef.current;
    if (!req || !game?.homeTeam || !game.awayTeam || running) return;
    const needsServer = propResults.some((r) => r.hitProbability != null && r.simulations === 0);
    if (!needsServer) return;

    const timer = setTimeout(() => {
      void (async () => {
        try {
          const serverDeep = await fetchSimulatorPropSimulationsBatch(
            sport,
            req.simProps,
            {
              homeTeam: game.homeTeam!,
              awayTeam: game.awayTeam!,
              homeTeamId: game.homeTeamId,
              awayTeamId: game.awayTeamId,
              tier: "deep",
              simulations: REQUESTED_SIMS,
            },
          );
          const upgraded = mergeServerOverLocal(
            propResults,
            enrichPropSimResults(serverDeep.props, req.phForSim),
          );
          if (upgraded.some((r) => r.simulations > 0 && r.hitProbability != null)) {
            setPropResults(upgraded);
            setPropSimRun(serverDeep.simRun);
          }
        } catch {
          /* keep game-log fallback */
        }
      })();
    }, 25_000);
    return () => clearTimeout(timer);
  }, [propResults, game, sport, running]);

  useEffect(() => {
    prevSnapshotRef.current = null;
    setWhatChanged([]);
    setTicketOptimization([]);
  }, [game?.id]);

  const rankedProps = useMemo(
    () => rankSimulatorProps(propResults, propScores),
    [propResults, propScores],
  );

  const displayedRankedProps = useMemo(() => {
    if (showAllPicks) return rankedProps;
    return rankedProps.filter((r) => isVisibleByDefault(r.combined, r.row));
  }, [rankedProps, showAllPicks]);

  const hiddenPickCount = rankedProps.length - displayedRankedProps.length;

  const topAiPicks = useMemo(
    () => buildTopAiPicks(rankedProps, propMarketLabel),
    [rankedProps],
  );

  const impactNotes = useMemo(() => {
    const injuryCount =
      matchupInjuries[gameLabel ?? ""]?.sides.reduce(
        (n, s) => n + (s.keyPlayers?.length ?? 0),
        0,
      ) ?? 0;
    return simulationImpactNotes({
      sport,
      weatherImpact,
      weatherLabel,
      injuryCount,
      lineCount: propPool.length,
    });
  }, [sport, weatherImpact, weatherLabel, matchupInjuries, gameLabel, propPool.length]);

  const displaySimRun = useMemo(() => {
    if (mode === "game") return gameSimRun;
    if (mode === "props") return propSimRun;
    return mergeSimRuns(gameSimRun, propSimRun);
  }, [mode, gameSimRun, propSimRun]);

  const simCountLabel = formatSimCountLabel(displaySimRun);
  const simCountConfirmed = isFullDeepSimulation(displaySimRun);

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
                Simulate games and player props to project outcomes and probabilities.
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
              <SettingRow
                label="Simulation Count"
                value={
                  displaySimRun
                    ? `${displaySimRun.completedSims.toLocaleString()} / ${displaySimRun.requestedSims.toLocaleString()}`
                    : `${REQUESTED_SIMS.toLocaleString()} requested`
                }
              />
              <Pressable onPress={() => setSimDebugOpen((v) => !v)}>
                <SettingRow
                  label="Sim Debug"
                  value={simDebugOpen ? "On" : "Off"}
                  icon="activity"
                />
              </Pressable>
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
                    <Pressable onPress={() => setSimDebugOpen((v) => !v)}>
                      <View
                        style={{
                          paddingHorizontal: 8,
                          paddingVertical: 4,
                          borderRadius: 8,
                          backgroundColor: simCountConfirmed
                            ? "rgba(59,130,246,0.15)"
                            : "rgba(234,179,8,0.15)",
                        }}
                      >
                        <Text
                          style={{
                            fontFamily: FONT.bold,
                            fontSize: 10,
                            color: simCountConfirmed ? colors.primary : "#ca8a04",
                          }}
                        >
                          {simCountLabel}
                        </Text>
                      </View>
                    </Pressable>
                    {ranAt ? (
                      <Text style={{ fontFamily: FONT.body, fontSize: 11, color: colors.mutedForeground }}>
                        Updated just now
                      </Text>
                    ) : null}
                  </View>
                </View>

                {simDebugOpen && displaySimRun ? (
                  <Card style={{ marginBottom: 12 }}>
                    <Text style={{ fontFamily: FONT.semibold, fontSize: 14, color: colors.foreground, marginBottom: 8 }}>
                      Simulation Debug
                    </Text>
                    <Text style={{ fontFamily: FONT.body, fontSize: 11, color: colors.mutedForeground, lineHeight: 17 }}>
                      Started: {new Date(displaySimRun.startedAt).toLocaleTimeString()}
                      {"\n"}Finished: {new Date(displaySimRun.finishedAt).toLocaleTimeString()}
                      {"\n"}Run time: {displaySimRun.runTimeMs} ms
                      {"\n"}Requested sims: {displaySimRun.requestedSims.toLocaleString()}
                      {"\n"}Completed sims: {displaySimRun.completedSims.toLocaleString()}
                      {"\n"}Failed sims: {displaySimRun.failedSims.toLocaleString()}
                      {displaySimRun.sampleGames != null
                        ? `\nSample games used: ${displaySimRun.sampleGames}`
                        : ""}
                    </Text>
                  </Card>
                ) : null}

                {gameResult && game.homeTeam && game.awayTeam ? (
                  <Card style={{ marginBottom: 12 }}>
                    <Text style={{ fontFamily: FONT.semibold, fontSize: 14, color: colors.foreground, marginBottom: 10 }}>
                      AI Game Prediction
                    </Text>
                    <View style={{ gap: 10 }}>
                      <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 12 }}>
                        <View style={{ flex: 1 }}>
                          <Text style={{ fontFamily: FONT.medium, fontSize: 10, color: colors.mutedForeground, textTransform: "uppercase" }}>
                            AI Prediction
                          </Text>
                          <Text style={{ fontFamily: FONT.semibold, fontSize: 15, color: colors.foreground, marginTop: 4 }}>
                            {gameAiPrediction(gameResult, game.homeTeam, game.awayTeam)}
                          </Text>
                        </View>
                        <View style={{ alignItems: "flex-end" }}>
                          <Text style={{ fontFamily: FONT.medium, fontSize: 10, color: colors.mutedForeground, textTransform: "uppercase" }}>
                            Game Confidence
                          </Text>
                          <Text
                            style={{
                              fontFamily: FONT.bold,
                              fontSize: 15,
                              marginTop: 4,
                              color:
                                gameConfidenceLevel(gameResult.confidenceScore) === "High"
                                  ? colors.success
                                  : gameConfidenceLevel(gameResult.confidenceScore) === "Medium"
                                    ? colors.primary
                                    : colors.mutedForeground,
                            }}
                          >
                            {gameConfidenceLevel(gameResult.confidenceScore)}
                          </Text>
                        </View>
                      </View>
                      <View>
                        <Text style={{ fontFamily: FONT.medium, fontSize: 10, color: colors.mutedForeground, textTransform: "uppercase", marginBottom: 6 }}>
                          Win Probability
                        </Text>
                        <WinBar
                          awayPct={gameResult.awayWinProbability}
                          homePct={gameResult.homeWinProbability}
                          awayLabel={game.awayAbbr ?? game.awayTeam}
                          homeLabel={game.homeAbbr ?? game.homeTeam}
                        />
                      </View>
                      <View style={{ flexDirection: "row", gap: 10 }}>
                        <View style={{ flex: 1, padding: 10, borderRadius: 12, backgroundColor: colors.muted, borderWidth: 1, borderColor: colors.border }}>
                          <Text style={{ fontFamily: FONT.medium, fontSize: 10, color: colors.mutedForeground }}>Most Likely Final Score</Text>
                          <Text style={{ fontFamily: FONT.bold, fontSize: 16, color: colors.foreground, marginTop: 4 }}>
                            {formatFinalScoreLine(game.awayTeam, game.homeTeam, gameResult)}
                          </Text>
                        </View>
                        <View style={{ flex: 1, padding: 10, borderRadius: 12, backgroundColor: colors.muted, borderWidth: 1, borderColor: colors.border }}>
                          <Text style={{ fontFamily: FONT.medium, fontSize: 10, color: colors.mutedForeground }}>Average Projected Score</Text>
                          <Text style={{ fontFamily: FONT.bold, fontSize: 16, color: colors.foreground, marginTop: 4 }}>
                            {formatAverageScoreLine(game.awayTeam, game.homeTeam, gameResult)}
                          </Text>
                        </View>
                      </View>
                      {impactNotes.length > 0 ? (
                        <View style={{ paddingTop: 4 }}>
                          {impactNotes.map((note) => (
                            <Text key={note} style={{ fontFamily: FONT.body, fontSize: 11, color: colors.mutedForeground, lineHeight: 16, marginTop: 2 }}>
                              • {note}
                            </Text>
                          ))}
                        </View>
                      ) : null}
                    </View>
                  </Card>
                ) : null}

                {ticketOptimization.length > 0 ? (
                  <Card style={{ marginBottom: 12 }}>
                    <Text style={{ fontFamily: FONT.semibold, fontSize: 14, color: colors.foreground, marginBottom: 8 }}>
                      Optimized Ticket
                    </Text>
                    {ticketOptimization.map((line) => (
                      <View key={line} style={{ flexDirection: "row", gap: 6, marginTop: 4 }}>
                        <Text style={{ color: colors.primary, fontFamily: FONT.body, fontSize: 11 }}>•</Text>
                        <Text style={{ flex: 1, fontFamily: FONT.body, fontSize: 12, color: colors.mutedForeground, lineHeight: 17 }}>
                          {line}
                        </Text>
                      </View>
                    ))}
                  </Card>
                ) : null}

                {whatChanged.length > 0 ? (
                  <Card style={{ marginBottom: 12 }}>
                    <Text style={{ fontFamily: FONT.semibold, fontSize: 14, color: colors.foreground, marginBottom: 8 }}>
                      What Changed?
                    </Text>
                    {whatChanged.map((line) => (
                      <View key={line} style={{ flexDirection: "row", gap: 6, marginTop: 4 }}>
                        <Text style={{ color: colors.primary, fontFamily: FONT.body, fontSize: 11 }}>•</Text>
                        <Text style={{ flex: 1, fontFamily: FONT.body, fontSize: 12, color: colors.mutedForeground, lineHeight: 17 }}>
                          {line}
                        </Text>
                      </View>
                    ))}
                  </Card>
                ) : null}

                {rankedProps.length > 0 ? (
                  <Card style={{ marginBottom: 12 }}>
                    <Text style={{ fontFamily: FONT.semibold, fontSize: 14, color: colors.foreground, marginBottom: 10 }}>
                      Top AI Picks
                    </Text>
                    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                      {topAiPicks.map((slot) => (
                        <View
                          key={slot.id}
                          style={{
                            width: "48%",
                            flexGrow: 1,
                            padding: 10,
                            borderRadius: 12,
                            backgroundColor: colors.muted,
                            borderWidth: 1,
                            borderColor: colors.border,
                            minWidth: 140,
                          }}
                        >
                          <Text style={{ fontFamily: FONT.bold, fontSize: 10, color: colors.primary, textTransform: "uppercase" }}>
                            {slot.title}
                          </Text>
                          <Text style={{ fontFamily: FONT.semibold, fontSize: 12, color: colors.foreground, marginTop: 6 }} numberOfLines={2}>
                            {slot.label}
                          </Text>
                          <Text style={{ fontFamily: FONT.body, fontSize: 10, color: colors.mutedForeground, marginTop: 4 }}>
                            {slot.detail}
                          </Text>
                        </View>
                      ))}
                    </View>
                  </Card>
                ) : null}

                {propResults.length > 0 ? (
                  <Card style={{ marginBottom: 16 }}>
                    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
                      <Text style={{ fontFamily: FONT.semibold, fontSize: 14, color: colors.foreground }}>
                        Top Prop Picks
                      </Text>
                      <Pressable
                        onPress={() => setShowAllPicks((v) => !v)}
                        style={{
                          paddingHorizontal: 10,
                          paddingVertical: 5,
                          borderRadius: 8,
                          backgroundColor: showAllPicks ? "rgba(59,130,246,0.2)" : colors.muted,
                          borderWidth: 1,
                          borderColor: showAllPicks ? colors.primary : colors.border,
                        }}
                      >
                        <Text style={{ fontFamily: FONT.medium, fontSize: 11, color: showAllPicks ? colors.primary : colors.mutedForeground }}>
                          {showAllPicks ? "High Quality Only" : "Show All"}
                        </Text>
                      </Pressable>
                    </View>
                    <Text style={{ fontFamily: FONT.body, fontSize: 11, color: colors.mutedForeground, marginBottom: 10, lineHeight: 16 }}>
                      {showAllPicks
                        ? "Showing all simulated props, ranked best to worst."
                        : "Hiding D/F grades and negative-edge props. Ranked by AI grade, edge, and simulation."}
                      {simDeepPending ? " Simulation updating…" : ""}
                      {!showAllPicks && hiddenPickCount > 0
                        ? ` ${hiddenPickCount} low-quality pick${hiddenPickCount === 1 ? "" : "s"} hidden.`
                        : ""}
                    </Text>
                    {displayedRankedProps.length === 0 ? (
                      <Text style={{ fontFamily: FONT.body, fontSize: 13, color: colors.mutedForeground, paddingVertical: 8 }}>
                        No high-quality picks in this run. Tap Show All to review D/F or negative-edge props.
                      </Text>
                    ) : null}
                    {displayedRankedProps.map((entry, idx) => {
                      const r = entry.row;
                      const combined = entry.combined;
                      const recommendation = entry.recommendation;
                      const recColor =
                        recommendation === "Best Bet"
                          ? colors.success
                          : recommendation === "Value"
                            ? colors.primary
                            : recommendation === "Safe"
                              ? colors.foreground
                              : colors.mutedForeground;
                      const gradeColor =
                        combined?.composite == null
                          ? colors.mutedForeground
                          : combined.composite >= 7
                            ? colors.success
                            : combined.composite >= 5.5
                              ? colors.primary
                              : colors.mutedForeground;
                      const simConf = simulatorSimConfidence(r);
                      const proj = expectedProjection(r);
                      const displayEdge = resolveDisplayEdge(combined, r, oddsByKey.get(r.key));
                      const edgeColor =
                        displayEdge == null
                          ? colors.mutedForeground
                          : displayEdge >= 0
                            ? colors.success
                            : colors.destructive;
                      const shortReason = primaryPickReason(combined, r);
                      const extraReasons = topSimulatorPickReasons(combined, r, 2).filter((x) => x !== shortReason);
                      return (
                        <View
                          key={r.key}
                          style={{
                            paddingVertical: 12,
                            borderTopWidth: 1,
                            borderTopColor: colors.border,
                          }}
                        >
                          <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
                            <View style={{ flex: 1 }}>
                              <Text style={{ fontFamily: FONT.bold, fontSize: 10, color: colors.primary }}>
                                #{idx + 1} RANKED
                              </Text>
                              <Text style={{ fontFamily: FONT.semibold, fontSize: 13, color: colors.foreground, marginTop: 2 }}>
                                {r.player} — {r.side} {r.line} {propMarketLabel(r.market)}
                              </Text>
                            </View>
                            <View
                              style={{
                                paddingHorizontal: 8,
                                paddingVertical: 4,
                                borderRadius: 8,
                                backgroundColor:
                                  recommendation === "Best Bet"
                                    ? "rgba(34,197,94,0.15)"
                                    : recommendation === "Value"
                                      ? "rgba(59,130,246,0.15)"
                                      : colors.muted,
                              }}
                            >
                              <Text style={{ fontFamily: FONT.bold, fontSize: 10, color: recColor }}>
                                {recommendation}
                              </Text>
                            </View>
                          </View>
                          {r.hitProbability == null && r.sampleGames < 3 ? (
                            <Text style={{ fontFamily: FONT.body, fontSize: 11, color: colors.mutedForeground, marginTop: 4 }}>
                              Not enough recent game log to simulate this line.
                            </Text>
                          ) : r.simulations === 0 && r.hitProbability != null ? (
                            <Text style={{ fontFamily: FONT.body, fontSize: 11, color: colors.mutedForeground, marginTop: 4 }}>
                              Based on recent game log — full Monte Carlo will update when available.
                            </Text>
                          ) : null}
                          <View style={{ flexDirection: "row", gap: 10, marginTop: 8, flexWrap: "wrap" }}>
                            <MiniStat label="AI Grade" value={combined.grade ?? "—"} valueColor={gradeColor} />
                            <MiniStat
                              label="Confidence"
                              value={combined.confidencePct != null ? `${combined.confidencePct}%` : "—"}
                            />
                            <MiniStat
                              label="Edge"
                              value={formatEdgeDisplay(displayEdge)}
                              valueColor={edgeColor}
                            />
                            <MiniStat label="Sim Hit %" value={formatSimHitDisplay(r.hitProbability)} />
                            <MiniStat label="Sim Confidence" value={simConf != null ? String(simConf) : "—"} />
                            <MiniStat label="Expected Stat" value={proj ?? "—"} />
                            <MiniStat label="Recommendation" value={recommendation} valueColor={recColor} />
                          </View>
                          {shortReason || extraReasons.length > 0 ? (
                            <View style={{ marginTop: 10 }}>
                              {shortReason ? (
                                <Text style={{ fontFamily: FONT.semibold, fontSize: 12, color: colors.foreground }}>
                                  {shortReason}
                                </Text>
                              ) : null}
                              {extraReasons.map((reason) => (
                                <Text
                                  key={reason}
                                  style={{
                                    fontFamily: FONT.body,
                                    fontSize: 11,
                                    color: colors.mutedForeground,
                                    marginTop: shortReason ? 4 : 0,
                                    lineHeight: 16,
                                  }}
                                >
                                  {reason}
                                </Text>
                              ))}
                            </View>
                          ) : recommendation === "Pass" ? (
                            <Text style={{ fontFamily: FONT.body, fontSize: 11, color: colors.mutedForeground, marginTop: 8 }}>
                              {!isValidPropSimData(r)
                                ? "Simulation data incomplete or inconsistent — not recommended until Monte Carlo completes."
                                : "No positive edge or sim hit rate too low to recommend."}
                            </Text>
                          ) : null}
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

      <Modal visible={running && simProgress.length > 0} transparent animationType="fade">
        <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.72)", justifyContent: "center", padding: 24 }}>
          <Card>
            <Text style={{ fontFamily: FONT.semibold, fontSize: 17, color: colors.foreground, marginBottom: 4 }}>
              Running Simulation
            </Text>
            <Text style={{ fontFamily: FONT.body, fontSize: 13, color: colors.mutedForeground, marginBottom: 16 }}>
              {displaySimRun
                ? `${displaySimRun.completedSims.toLocaleString()} Monte Carlo draws confirmed by the server.`
                : `Requesting ${REQUESTED_SIMS.toLocaleString()} Monte Carlo draws.`}
            </Text>
            <View style={{ gap: 10 }}>
              {simProgress.map((step) => (
                <View key={step.id} style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                  {step.status === "done" ? (
                    <Feather name="check-circle" size={18} color={colors.success} />
                  ) : step.status === "active" ? (
                    <ActivityIndicator size="small" color={colors.primary} />
                  ) : (
                    <View style={{ width: 18, height: 18, borderRadius: 9, borderWidth: 1, borderColor: colors.border }} />
                  )}
                  <Text
                    style={{
                      fontFamily: step.status === "active" ? FONT.semibold : FONT.body,
                      fontSize: 13,
                      color: step.status === "pending" ? colors.mutedForeground : colors.foreground,
                    }}
                  >
                    {step.label}
                  </Text>
                </View>
              ))}
            </View>
          </Card>
        </View>
      </Modal>

      <Modal visible={howOpen} transparent animationType="fade" onRequestClose={() => setHowOpen(false)}>
        <Pressable style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "center", padding: 24 }} onPress={() => setHowOpen(false)}>
          <Pressable onPress={(e) => e.stopPropagation()}>
            <Card>
              <Text style={{ fontFamily: FONT.semibold, fontSize: 17, color: colors.foreground, marginBottom: 10 }}>
                How it works
              </Text>
              <Text style={{ fontFamily: FONT.body, fontSize: 14, color: colors.mutedForeground, lineHeight: 21 }}>
                Each run requests {REQUESTED_SIMS.toLocaleString()} Monte Carlo draws using real recent game logs, pace,
                minutes, injuries, matchup splits, and park weather. The badge only shows “10,000 Sims” when the server
                confirms 10,000 completed simulations.
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

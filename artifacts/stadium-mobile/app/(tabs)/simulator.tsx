import { Feather, MaterialCommunityIcons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import * as Haptics from "expo-haptics";
import { useMemo, useState, type ReactNode } from "react";
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

import { Avatar } from "@/components/PlayerPropRow";
import { useSlipClearance } from "@/components/SlipBar";
import { Card, EmptyState, ErrorState, FONT, Loading, Pill } from "@/components/ui";
import { useColors } from "@/hooks/useColors";
import {
  fetchGameOutcomeSimulation,
  fetchPropSimulationsBatch,
  getGames,
  getParkWeather,
  getProps,
  isPickable,
  propMarketLabel,
  type EspnGame,
  type GameSimulationResult,
  type PlayerProp,
  type PropSimulationResult,
} from "@/lib/api";
import { formatAmerican } from "@/lib/format";
import { SPORTS } from "@/lib/sports";

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

const PROP_FILTERS: { id: string; label: string; icon?: keyof typeof Feather.glyphMap; markets?: string[] }[] = [
  { id: "popular", label: "Popular", icon: "zap" },
  { id: "hits", label: "Hits", markets: ["batter_hits", "player_points"] },
  { id: "rbis", label: "RBIs", markets: ["batter_hits_runs_rbis"] },
  { id: "hr", label: "Home Runs", markets: ["batter_home_runs"] },
  { id: "k", label: "Strikeouts", markets: ["pitcher_strikeouts", "player_sacks"] },
];

function initials(name: string) {
  return (name || "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(-2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
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

export default function SimulatorScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const slipClearance = useSlipClearance();
  const topPad = insets.top + slipClearance + 56;

  const [sport, setSport] = useState<string>("mlb");
  const [gameIdx, setGameIdx] = useState(0);
  const [mode, setMode] = useState<SimMode>("props");
  const [filter, setFilter] = useState("popular");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<SelectedProp[]>([]);
  const [running, setRunning] = useState(false);
  const [gameResult, setGameResult] = useState<GameSimulationResult | null>(null);
  const [propResults, setPropResults] = useState<PropSimulationResult[]>([]);
  const [ranAt, setRanAt] = useState<number | null>(null);
  const [howOpen, setHowOpen] = useState(false);

  const gamesQ = useQuery({
    queryKey: ["sim-games", sport],
    queryFn: ({ signal }) => getGames(sport, signal),
    staleTime: 5 * 60_000,
  });

  const games = useMemo(
    () => (gamesQ.data ?? []).filter((g) => isPickable(g.startsAt)),
    [gamesQ.data],
  );

  const game: EspnGame | null = games[gameIdx] ?? games[0] ?? null;

  const propsQ = useQuery({
    queryKey: ["sim-props", sport, game?.id],
    enabled: !!game?.id,
    queryFn: ({ signal }) =>
      getProps(
        {
          sport,
          eventId: game!.id,
          home: game!.homeTeam ?? undefined,
          away: game!.awayTeam ?? undefined,
          homeTeamId: game!.homeTeamId,
          awayTeamId: game!.awayTeamId,
        },
        signal,
      ).then((r) => r.props ?? []),
    staleTime: 5 * 60_000,
  });

  const parkQ = useQuery({
    queryKey: ["sim-park-wx", sport],
    enabled: sport === "mlb",
    queryFn: ({ signal }) => getParkWeather("mlb", signal),
    staleTime: 10 * 60_000,
  });

  const weatherForGame = useMemo(() => {
    if (!game?.homeTeam || !parkQ.data) return null;
    const norm = (s: string) => s.toLowerCase();
    return (
      parkQ.data.find(
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

  const mains = useMemo(
    () => (propsQ.data ?? []).filter((p) => !p.alt && p.line != null),
    [propsQ.data],
  );

  const filteredProps = useMemo(() => {
    let list = mains;
    const f = PROP_FILTERS.find((x) => x.id === filter);
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
  }, [mains, filter, search]);

  const toggleProp = (p: PlayerProp, side: "Over" | "Under") => {
    if (Platform.OS !== "web") Haptics.selectionAsync();
    const price = side === "Over" ? p.overPrice : p.underPrice;
    if (price == null || p.line == null) return;
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
        odds: price,
        athleteId: p.athleteId,
        headshot: p.headshot,
        label,
      },
    ]);
  };

  const runSimulation = async () => {
    if (!game?.homeTeamId || !game?.awayTeamId || !game.homeTeam || !game.awayTeam) return;
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setRunning(true);
    setGameResult(null);
    setPropResults([]);
    try {
      const wx = weatherImpact;
      if (mode === "game" || mode === "full") {
        const gr = await fetchGameOutcomeSimulation({
          sport,
          homeTeamId: game.homeTeamId,
          awayTeamId: game.awayTeamId,
          homeTeam: game.homeTeam,
          awayTeam: game.awayTeam,
          simulations: SIM_COUNT,
          weatherImpact: wx,
        });
        setGameResult(gr);
      }
      if ((mode === "props" || mode === "full") && selected.length > 0) {
        const pr = await fetchPropSimulationsBatch(
          sport,
          selected.map((s) => ({
            player: s.player,
            market: s.market,
            line: s.line,
            side: s.side,
            athleteId: s.athleteId,
          })),
          {
            homeTeam: game.homeTeam,
            awayTeam: game.awayTeam,
            weatherImpact: wx,
            simulations: SIM_COUNT,
          },
        );
        setPropResults(pr);
      }
      setRanAt(Date.now());
    } finally {
      setRunning(false);
    }
  };

  const canRun =
    !!game &&
    !running &&
    (mode === "game" || (mode === "props" && selected.length >= 1) || (mode === "full" && selected.length >= 1));

  const modes: { id: SimMode; label: string }[] = [
    { id: "game", label: "Game Outcome" },
    { id: "props", label: "Player Props" },
    { id: "full", label: "Full Simulation" },
  ];

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView
        contentContainerStyle={{ paddingTop: topPad, paddingBottom: insets.bottom + 120 }}
        refreshControl={
          <RefreshControl refreshing={gamesQ.isFetching} onRefresh={() => gamesQ.refetch()} />
        }
      >
        {/* Hero */}
        <View style={{ paddingHorizontal: 16, marginBottom: 16 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 8 }}>
            <View
              style={{
                width: 44,
                height: 44,
                borderRadius: 14,
                backgroundColor: "rgba(59,130,246,0.15)",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <MaterialCommunityIcons name="gamepad-variant" size={22} color={colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <Text style={{ fontFamily: FONT.display, fontSize: 22, color: colors.foreground }}>
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
              <Text
                style={{
                  color: colors.mutedForeground,
                  fontFamily: FONT.body,
                  fontSize: 13,
                  lineHeight: 18,
                  marginTop: 4,
                }}
              >
                Simulate games and player props with our model to project outcomes and probabilities.
              </Text>
            </View>
          </View>
          <Pressable onPress={() => setHowOpen(true)} style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Feather name="info" size={14} color={colors.primary} />
            <Text style={{ color: colors.primary, fontFamily: FONT.medium, fontSize: 13 }}>How it works</Text>
          </Pressable>
        </View>

        {/* Sport pills */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 16, gap: 8, marginBottom: 16 }}
        >
          {SIM_SPORTS.map((id) => {
            const label = SPORTS.find((s) => s.id === id)?.label ?? id.toUpperCase();
            return (
              <Pill key={id} label={label} active={sport === id} onPress={() => { setSport(id); setGameIdx(0); setSelected([]); }} />
            );
          })}
        </ScrollView>

        {gamesQ.isLoading ? (
          <Loading label="Loading games…" />
        ) : gamesQ.isError ? (
          <ErrorState onRetry={() => gamesQ.refetch()} />
        ) : !game ? (
          <EmptyState title="No games" message={`No pickable ${sport.toUpperCase()} games right now.`} />
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
                    onPress={() => { setGameIdx(i); setSelected([]); }}
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
                      {g.awayAbbr ?? g.awayTeam} @ {g.homeAbbr ?? g.homeTeam}
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
                        <Avatar headshot={s.headshot} name={s.player} />
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
                    {PROP_FILTERS.map((f) => (
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

                {propsQ.isLoading ? (
                  <ActivityIndicator color={colors.primary} />
                ) : (
                  <View style={{ gap: 8 }}>
                    {filteredProps.map((p) => {
                      const side: "Over" | "Under" =
                        p.evSide === "Under" ? "Under" : "Over";
                      const price = side === "Over" ? p.overPrice : p.underPrice;
                      if (price == null) return null;
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
                          <Avatar uri={p.headshot} name={p.player} size={40} />
                          <View style={{ flex: 1 }}>
                            <Text style={{ fontFamily: FONT.semibold, fontSize: 14, color: colors.foreground }}>
                              {p.player}
                            </Text>
                            <Text style={{ fontFamily: FONT.body, fontSize: 12, color: colors.mutedForeground }}>
                              {side} {p.line} {propMarketLabel(p.market)}
                            </Text>
                          </View>
                          <Text style={{ fontFamily: FONT.semibold, fontSize: 13, color: colors.foreground }}>
                            {formatAmerican(price)}
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
                  <View style={{ flexDirection: "row", gap: 10, marginBottom: 12 }}>
                    <ResultCol title="Win Probability">
                      <WinBar
                        awayPct={gameResult.awayWinProbability}
                        homePct={gameResult.homeWinProbability}
                        awayLabel={game.awayAbbr ?? game.awayTeam}
                        homeLabel={game.homeAbbr ?? game.homeTeam}
                      />
                    </ResultCol>
                    <ResultCol title="Projected Score (Avg)">
                      <ScorePair
                        away={gameResult.awayProjectedScore}
                        home={gameResult.homeProjectedScore}
                        awayLogo={game.awayLogo}
                        homeLogo={game.homeLogo}
                      />
                    </ResultCol>
                    <ResultCol title="Most Likely Outcome">
                      <LikelyWinner
                        winner={
                          gameResult.mostLikelyWinner === "home" ? game.homeTeam : game.awayTeam
                        }
                        logo={gameResult.mostLikelyWinner === "home" ? game.homeLogo : game.awayLogo}
                        pct={gameResult.mostLikelyWinnerPct}
                      />
                    </ResultCol>
                  </View>
                ) : null}

                {propResults.length > 0 ? (
                  <Card style={{ marginBottom: 16 }}>
                    <Text style={{ fontFamily: FONT.semibold, fontSize: 14, color: colors.foreground, marginBottom: 10 }}>
                      Player Prop Projections
                    </Text>
                    {propResults.map((r) => (
                      <View
                        key={r.key}
                        style={{
                          paddingVertical: 10,
                          borderTopWidth: 1,
                          borderTopColor: colors.border,
                        }}
                      >
                        <Text style={{ fontFamily: FONT.semibold, fontSize: 13, color: colors.foreground }}>
                          {r.player} — {r.side} {r.line}
                        </Text>
                        <View style={{ flexDirection: "row", gap: 16, marginTop: 6 }}>
                          <MiniStat label="Hit %" value={r.hitProbability != null ? `${Math.round(r.hitProbability * 100)}%` : "—"} />
                          <MiniStat label="Likely" value={r.mostLikelyLine != null ? String(r.mostLikelyLine) : "—"} />
                          <MiniStat label="Conf" value={r.confidenceScore != null ? String(r.confidenceScore) : "—"} />
                        </View>
                      </View>
                    ))}
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
                minutes, injuries, matchup splits, and park weather. Results show projected win rates and prop hit
                probabilities — one input to AI Grade, not a guarantee.
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

function LikelyWinner({
  winner,
  logo,
  pct,
}: {
  winner: string;
  logo?: string | null;
  pct: number;
}) {
  const colors = useColors();
  return (
    <View style={{ alignItems: "center", gap: 6 }}>
      {logo ? <Image source={{ uri: logo }} style={{ width: 28, height: 28 }} contentFit="contain" /> : null}
      <Text style={{ fontFamily: FONT.semibold, fontSize: 12, color: colors.foreground, textAlign: "center" }}>
        {winner.split(" ").slice(-1)[0]} Win
      </Text>
      <Text style={{ fontFamily: FONT.body, fontSize: 10, color: colors.mutedForeground }}>
        {(pct * 100).toFixed(1)}% of simulations
      </Text>
    </View>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  const colors = useColors();
  return (
    <View>
      <Text style={{ fontFamily: FONT.body, fontSize: 10, color: colors.mutedForeground }}>{label}</Text>
      <Text style={{ fontFamily: FONT.semibold, fontSize: 13, color: colors.foreground }}>{value}</Text>
    </View>
  );
}

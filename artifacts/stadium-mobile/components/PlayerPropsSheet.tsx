import { Feather } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import { useEffect, useMemo, useState } from "react";
import { Image, Modal, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { FONT } from "@/components/ui";
import { useBetSlip } from "@/context/BetSlipContext";
import { useColors } from "@/hooks/useColors";
import {
  getPlayerHistory,
  propMarketLabel,
  type PlayerProp,
  type PlayerStatSummary,
} from "@/lib/api";
import { formatAmerican } from "@/lib/format";
import { SPORTS } from "@/lib/sports";

export type PlayerSheetData = {
  player: string;
  athleteId: string | null;
  headshot: string | null;
  playerTeamId: string | null;
  teamAbbr: string | null;
  sport: string;
  gameLabel: string;
  initialMarket: string;
  props: PlayerProp[];
};

// Line-grid resolution for the hit-rate explorer (half-point, like book lines).
const STEP = 0.5;

// Markets whose per-game value is the SUM of several ESPN stat columns.
const MARKET_COMBO: Record<string, string[]> = {
  player_points_rebounds_assists: ["PTS", "REB", "AST"],
  player_points_rebounds: ["PTS", "REB"],
  player_points_assists: ["PTS", "AST"],
  player_rebounds_assists: ["REB", "AST"],
  player_blocks_steals: ["BLK", "STL"],
};

// Markets that map to a single ESPN stat column. The array is a fallback list —
// the first present (and unambiguous) label wins, since column names differ by
// sport (e.g. assists is "AST" in the NBA log but "A" in the NHL log; shots on
// goal is "S" in the NHL log).
const MARKET_SINGLE: Record<string, string[]> = {
  player_points: ["PTS"],
  player_rebounds: ["REB"],
  player_assists: ["AST", "A"],
  player_blocks: ["BLK"],
  player_steals: ["STL"],
  player_turnovers: ["TO"],
  batter_hits: ["H"],
  batter_home_runs: ["HR"],
  pitcher_strikeouts: ["K", "SO"],
  player_goals: ["G"],
  player_shots_on_goal: ["S", "SOG", "SHOTS"],
};

function num(stats: Record<string, string>, label: string): number | null {
  const n = Number(stats[label]);
  return Number.isFinite(n) ? n : null;
}

// Real per-game value for a market from one game's stat line. Returns null when
// the feed doesn't carry the needed column(s) — we never invent a number.
//
// `ambiguous` is the set of labels that appear MORE THAN ONCE in the ESPN
// gamelog header (e.g. football's passing + rushing "YDS"/"TD"). The server
// flattens stats into a label-keyed object, so a duplicated label collides and
// can't be trusted to mean one thing — we treat those as unavailable rather
// than risk showing rushing yards under a passing-yards prop.
function gameValueForMarket(
  market: string,
  stats: Record<string, string>,
  ambiguous: Set<string>,
): number | null {
  // Total bases isn't a single ESPN column — it's an exact identity from real
  // columns: TB = H + 2B + 2*(3B) + 3*(HR). All four are unambiguous in the MLB
  // batting log, so this is a real computation, not an estimate.
  if (market === "batter_total_bases") {
    const h = num(stats, "H");
    const d = num(stats, "2B");
    const t = num(stats, "3B");
    const hr = num(stats, "HR");
    if (h == null || d == null || t == null || hr == null) return null;
    return h + d + 2 * t + 3 * hr;
  }

  const combo = MARKET_COMBO[market];
  if (combo) {
    let sum = 0;
    for (const lab of combo) {
      if (ambiguous.has(lab)) return null;
      const n = num(stats, lab);
      if (n == null) return null;
      sum += n;
    }
    return sum;
  }
  const singles = MARKET_SINGLE[market];
  if (singles) {
    for (const lab of singles) {
      if (ambiguous.has(lab)) continue;
      const n = num(stats, lab);
      if (n != null) return n;
    }
  }
  return null;
}

// Season-stats grid config per sport: which columns to surface and whether the
// natural read is a per-game average (basketball) or a season total (the rest).
const GRID_BY_SPORT: Record<string, { mode: "avg" | "total"; labels: string[] }> = {
  nba: { mode: "avg", labels: ["PTS", "REB", "AST", "BLK", "STL"] },
  wnba: { mode: "avg", labels: ["PTS", "REB", "AST", "BLK", "STL"] },
  ncaab: { mode: "avg", labels: ["PTS", "REB", "AST", "BLK", "STL"] },
  nhl: { mode: "total", labels: ["G", "A", "PTS", "S", "PIM"] },
  mlb: { mode: "total", labels: ["HR", "RBI", "H", "R", "BB"] },
  nfl: { mode: "total", labels: ["YDS", "TD", "REC", "INT"] },
  ncaaf: { mode: "total", labels: ["YDS", "TD", "REC", "INT"] },
};

type GridCell = { label: string; value: number };

// Build up to 5 real stat cells: preferred columns first, then fill from
// whatever other numeric columns the feed actually carries (so e.g. a pitcher
// shows pitching stats even though the preferred list is batting-oriented).
function buildGrid(
  sport: string,
  summary: PlayerStatSummary,
  ambiguous: Set<string>,
): { cells: GridCell[]; mode: "avg" | "total" } {
  const cfg = GRID_BY_SPORT[sport] ?? { mode: "avg" as const, labels: [] };
  const source = cfg.mode === "avg" ? summary.averages : summary.totals;
  const cells: GridCell[] = [];
  const used = new Set<string>();
  for (const lab of cfg.labels) {
    if (ambiguous.has(lab)) continue;
    const v = source[lab];
    if (Number.isFinite(v)) {
      cells.push({ label: lab, value: v });
      used.add(lab);
    }
  }
  if (cells.length < 5) {
    for (const [lab, v] of Object.entries(source)) {
      if (used.has(lab) || ambiguous.has(lab) || !Number.isFinite(v)) continue;
      cells.push({ label: lab, value: v });
      if (cells.length >= 5) break;
    }
  }
  return { cells: cells.slice(0, 5), mode: cfg.mode };
}

function fmtStat(value: number, mode: "avg" | "total"): string {
  if (mode === "avg") return value.toFixed(1);
  return Number.isInteger(value) ? String(value) : String(Math.round(value * 10) / 10);
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  const colors = useColors();
  return (
    <Text
      style={{
        color: colors.mutedForeground,
        fontFamily: FONT.bold,
        fontSize: 11,
        letterSpacing: 1,
        textTransform: "uppercase",
        marginBottom: 10,
      }}
    >
      {children}
    </Text>
  );
}

export function PlayerPropsSheet({
  data,
  onClose,
}: {
  data: PlayerSheetData | null;
  onClose: () => void;
}) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { addLeg, hasLeg } = useBetSlip();

  const [market, setMarket] = useState<string>(data?.initialMarket ?? "");

  // Keep the selected market in sync each time a new player is opened.
  // `data` is a fresh object on every open (the Props screen builds a new
  // PlayerSheetData each tap), so this fires for every open — including
  // reopening the same player or tapping a different market — always seeding
  // the chart to the tapped market.
  useEffect(() => {
    if (data) setMarket(data.initialMarket);
  }, [data]);

  const sportLabel = data ? SPORTS.find((s) => s.id === data.sport)?.label ?? data.sport.toUpperCase() : "";

  const historyQ = useQuery({
    queryKey: ["player-history", data?.sport, data?.athleteId],
    enabled: !!data?.athleteId && !!data?.sport,
    staleTime: 10 * 60_000,
    queryFn: ({ signal }) =>
      getPlayerHistory({ sport: data!.sport, athleteId: data!.athleteId! }, signal),
  });

  // Labels appearing more than once in the gamelog header are ambiguous after
  // the server's label-keyed flatten (e.g. football passing + rushing "YDS").
  // We exclude them everywhere rather than risk showing the wrong stat.
  const ambiguous = useMemo(() => {
    const counts = new Map<string, number>();
    for (const l of historyQ.data?.labels ?? []) counts.set(l, (counts.get(l) ?? 0) + 1);
    const set = new Set<string>();
    for (const [l, c] of counts) if (c > 1) set.add(l);
    return set;
  }, [historyQ.data]);

  // Unique markets this player has in this game, ordered with the tapped one first.
  const markets = useMemo(() => {
    if (!data) return [] as string[];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const p of data.props) {
      if (seen.has(p.market)) continue;
      seen.add(p.market);
      out.push(p.market);
    }
    return out;
  }, [data]);

  const selectedProp = useMemo(
    () => data?.props.find((p) => p.market === market) ?? null,
    [data, market],
  );

  const grid = useMemo(
    () => (historyQ.data ? buildGrid(data!.sport, historyQ.data.seasonSummary, ambiguous) : null),
    [historyQ.data, data, ambiguous],
  );

  // Real per-game values for the selected market, oldest → newest (max 7).
  const bars = useMemo(() => {
    if (!historyQ.data || !data) return [] as { value: number; date: string | null; opp: string | null }[];
    const rows = [...historyQ.data.recent]
      .slice(0, 7)
      .reverse()
      .map((g) => ({
        value: gameValueForMarket(market, g.stats, ambiguous),
        date: g.date,
        opp: g.opponentName,
      }))
      .filter((r): r is { value: number; date: string | null; opp: string | null } => r.value != null);
    return rows;
  }, [historyQ.data, data, market, ambiguous]);

  const bookLine = selectedProp?.line ?? null;

  // Real average of the actual recent games shown (never a projection).
  const recentAvg = useMemo(() => {
    if (bars.length === 0) return null;
    const s = bars.reduce((a, b) => a + b.value, 0);
    return Math.round((s / bars.length) * 10) / 10;
  }, [bars]);

  // Adjustable hypothetical line for the hit-rate explorer. Seeds to the real
  // posted book line (or, if none is posted, the player's real recent average so
  // the chart still has a reference) and is moved by the suggested-line tiers or
  // the −/+ stepper. The HIT-RATE is always real (counted over the actual game
  // log); PRICES are only offered at the posted book line — we never estimate.
  const [chartLine, setChartLine] = useState<number | null>(null);
  useEffect(() => {
    const seed = bookLine ?? (recentAvg != null ? Math.round(recentAvg / STEP) * STEP : null);
    setChartLine(seed != null ? +seed.toFixed(1) : null);
  }, [selectedProp?.market, bookLine, recentAvg]);

  const chartMax = useMemo(() => {
    const vals = bars.map((b) => b.value);
    if (chartLine != null) vals.push(chartLine);
    const m = Math.max(0, ...vals);
    return m > 0 ? m * 1.15 : 1;
  }, [bars, chartLine]);

  const hitCount = chartLine != null ? bars.filter((b) => b.value >= chartLine).length : null;

  // Three real risk tiers, all OVER lines, derived from the actual game log:
  // SAFE sits below the floor (cleared often), BALANCED near the recent average,
  // RISKY above the ceiling (rarely cleared). Each tier's hit-count is empirical.
  const tiers = useMemo(() => {
    if (bars.length === 0) return null;
    const vals = bars.map((b) => b.value);
    const sorted = [...vals].sort((a, b) => a - b);
    const minV = sorted[0];
    const maxV = sorted[sorted.length - 1];
    const n = vals.length;
    const hits = (L: number) => vals.filter((v) => v >= L).length;
    const snap = (x: number) => +(Math.round(x / STEP) * STEP).toFixed(1);
    let safe = Math.max(0, +(minV - STEP).toFixed(1));
    let balanced = recentAvg != null ? snap(recentAvg) : snap((minV + maxV) / 2);
    let risky = +(maxV + STEP).toFixed(1);
    // Keep the three strictly ordered & distinct even on a flat/short log.
    if (balanced <= safe) balanced = +(safe + STEP).toFixed(1);
    if (risky <= balanced) risky = +(balanced + STEP).toFixed(1);
    return {
      safe: { value: safe, hits: hits(safe), total: n },
      balanced: { value: balanced, hits: hits(balanced), total: n },
      risky: { value: risky, hits: hits(risky), total: n },
    };
  }, [bars, recentAvg]);

  const activeTierKey = useMemo<"safe" | "balanced" | "risky" | null>(() => {
    if (!tiers || chartLine == null) return null;
    const near = (v: number) => Math.abs(v - chartLine) < 0.01;
    if (near(tiers.safe.value)) return "safe";
    if (near(tiers.balanced.value)) return "balanced";
    if (near(tiers.risky.value)) return "risky";
    return null;
  }, [tiers, chartLine]);

  // AI Suggested pick — a REAL, fail-closed read of THIS market at the posted
  // book line. We count how often the player actually cleared the book line over
  // the recent log, pick the side that cleared more often, and only surface it
  // when that side has a real posted price (never an invented number). The hit %
  // is the empirical clearance rate, not a projection.
  const aiSuggestion = useMemo(() => {
    if (!selectedProp || bookLine == null || bars.length === 0) return null;
    const total = bars.length;
    const overHits = bars.filter((b) => b.value >= bookLine).length;
    const underHits = total - overHits;
    const side: "Over" | "Under" = overHits >= underHits ? "Over" : "Under";
    const price = side === "Over" ? selectedProp.overPrice ?? null : selectedProp.underPrice ?? null;
    if (price == null) return null; // no real price → don't suggest
    const hits = side === "Over" ? overHits : underHits;
    const pct = Math.round((hits / total) * 100);
    const tier: "strong" | "lean" | "toss" = pct >= 70 ? "strong" : pct >= 57 ? "lean" : "toss";
    return { side, price, hits, total, pct, tier, line: bookLine };
  }, [selectedProp, bookLine, bars]);

  if (!data) return null;

  const teamLine = [data.teamAbbr, sportLabel].filter(Boolean).join(" · ");

  // The hit-rate explorer only ever offers a REAL price, and only at the posted
  // book line. Away from it there is no real number, so we never show odds.
  const atBookLine =
    bookLine != null && chartLine != null && Math.abs(bookLine - chartLine) < 0.01;
  const stepOverPrice = atBookLine ? selectedProp?.overPrice ?? null : null;
  const stepUnderPrice = atBookLine ? selectedProp?.underPrice ?? null : null;
  const mlabel = propMarketLabel(market);
  const stepLineTxt = bookLine != null ? ` ${bookLine}` : "";
  const overAddedStep = hasLeg(data.gameLabel, "Player Prop", `${data.player} Over${stepLineTxt} ${mlabel}`);
  const underAddedStep = hasLeg(data.gameLabel, "Player Prop", `${data.player} Under${stepLineTxt} ${mlabel}`);

  const addPick = (side: "Over" | "Under", price: number) => {
    if (!selectedProp) return;
    const lineTxt = selectedProp.line != null ? ` ${selectedProp.line}` : "";
    const label = propMarketLabel(selectedProp.market);
    const pick = `${data.player} ${side}${lineTxt} ${label}`;
    const ok = addLeg({ game: data.gameLabel, market: "Player Prop", pick, odds: price, sport: data.sport });
    Haptics.impactAsync(ok ? Haptics.ImpactFeedbackStyle.Medium : Haptics.ImpactFeedbackStyle.Light);
  };

  return (
    <Modal visible animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        {/* Header */}
        <View
          style={{
            paddingTop: insets.top + 8,
            paddingBottom: 12,
            paddingHorizontal: 16,
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            borderBottomWidth: 1,
            borderBottomColor: colors.border,
          }}
        >
          <Text style={{ color: colors.foreground, fontFamily: FONT.display, fontSize: 20 }}>
            Player Props
          </Text>
          <Pressable onPress={onClose} hitSlop={10}>
            <Text style={{ color: colors.primary, fontFamily: FONT.bold, fontSize: 15 }}>Close</Text>
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 32, gap: 18 }}>
          {/* Identity */}
          <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
            <View
              style={{
                width: 64,
                height: 64,
                borderRadius: 32,
                backgroundColor: colors.surface,
                borderWidth: 1,
                borderColor: colors.border,
                overflow: "hidden",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              {data.headshot ? (
                <Image source={{ uri: data.headshot }} style={{ width: 64, height: 64 }} resizeMode="cover" />
              ) : (
                <Feather name="user" size={26} color={colors.mutedForeground} />
              )}
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ color: colors.foreground, fontFamily: FONT.display, fontSize: 22 }} numberOfLines={1}>
                {data.player}
              </Text>
              {teamLine ? (
                <Text style={{ color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 13, marginTop: 2 }}>
                  {teamLine}
                </Text>
              ) : null}
              <Text style={{ color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 12, marginTop: 2 }} numberOfLines={1}>
                {data.gameLabel}
              </Text>
            </View>
          </View>

          {/* Season stats */}
          <View
            style={{
              backgroundColor: colors.card,
              borderWidth: 1,
              borderColor: colors.border,
              borderRadius: colors.radius,
              padding: 14,
            }}
          >
            <SectionLabel>
              {grid?.mode === "total" ? "Season Totals" : "Season Per-Game"}
              {historyQ.data?.season ? ` · ${historyQ.data.season}` : ""}
            </SectionLabel>
            {!data.athleteId ? (
              <Text style={{ color: colors.mutedForeground, fontFamily: FONT.body, fontSize: 13 }}>
                Detailed stats aren&apos;t available for this player.
              </Text>
            ) : historyQ.isLoading ? (
              <Text style={{ color: colors.mutedForeground, fontFamily: FONT.body, fontSize: 13 }}>
                Loading season stats…
              </Text>
            ) : historyQ.isError ? (
              <Text style={{ color: colors.mutedForeground, fontFamily: FONT.body, fontSize: 13 }}>
                Couldn&apos;t load season stats right now.
              </Text>
            ) : grid && grid.cells.length > 0 ? (
              <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                {grid.cells.map((c) => (
                  <View key={c.label} style={{ alignItems: "center", flex: 1 }}>
                    <Text style={{ color: colors.mutedForeground, fontFamily: FONT.semibold, fontSize: 10, letterSpacing: 0.5 }}>
                      {c.label}
                    </Text>
                    <Text style={{ color: colors.foreground, fontFamily: FONT.bold, fontSize: 19, marginTop: 4 }}>
                      {fmtStat(c.value, grid.mode)}
                    </Text>
                  </View>
                ))}
              </View>
            ) : (
              <Text style={{ color: colors.mutedForeground, fontFamily: FONT.body, fontSize: 13 }}>
                No season stats posted for this player yet.
              </Text>
            )}
          </View>

          {/* Recent performance */}
          <View
            style={{
              backgroundColor: colors.card,
              borderWidth: 1,
              borderColor: colors.border,
              borderRadius: colors.radius,
              padding: 14,
            }}
          >
            <SectionLabel>Recent Performance</SectionLabel>

            {/* Market pills */}
            {markets.length > 0 ? (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ gap: 8, paddingBottom: 12 }}
              >
                {markets.map((m) => {
                  const active = m === market;
                  return (
                    <Pressable
                      key={m}
                      onPress={() => setMarket(m)}
                      style={{
                        paddingHorizontal: 14,
                        paddingVertical: 7,
                        borderRadius: 999,
                        backgroundColor: active ? colors.primary : colors.surface,
                        borderWidth: 1,
                        borderColor: active ? colors.primary : colors.border,
                      }}
                    >
                      <Text
                        style={{
                          color: active ? colors.primaryForeground : colors.mutedForeground,
                          fontFamily: FONT.semibold,
                          fontSize: 12,
                        }}
                      >
                        {propMarketLabel(m)}
                      </Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
            ) : null}

            {chartLine != null ? (
              <Text style={{ color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 12, marginBottom: 12 }}>
                Line {chartLine}
                {hitCount != null && bars.length > 0 ? ` · cleared ${hitCount}/${bars.length} of last games` : ""}
              </Text>
            ) : null}

            {!data.athleteId ? (
              <Text style={{ color: colors.mutedForeground, fontFamily: FONT.body, fontSize: 13 }}>
                Per-game logs aren&apos;t available for this player.
              </Text>
            ) : historyQ.isLoading ? (
              <Text style={{ color: colors.mutedForeground, fontFamily: FONT.body, fontSize: 13 }}>
                Loading game log…
              </Text>
            ) : historyQ.isError ? (
              <Text style={{ color: colors.mutedForeground, fontFamily: FONT.body, fontSize: 13 }}>
                Couldn&apos;t load the game log right now.
              </Text>
            ) : bars.length === 0 ? (
              <Text style={{ color: colors.mutedForeground, fontFamily: FONT.body, fontSize: 13 }}>
                No per-game data for {propMarketLabel(market)} in the recent log.
              </Text>
            ) : (
              <View>
                <View style={{ height: 150, flexDirection: "row", alignItems: "flex-end", gap: 8, position: "relative" }}>
                  {/* Dashed reference line at the currently selected line */}
                  {chartLine != null ? (
                    <View
                      pointerEvents="none"
                      style={{
                        position: "absolute",
                        left: 0,
                        right: 0,
                        bottom: (chartLine / chartMax) * 150,
                        borderBottomWidth: 1,
                        borderColor: colors.primary,
                        borderStyle: "dashed",
                        opacity: 0.8,
                      }}
                    />
                  ) : null}
                  {bars.map((b, i) => {
                    const h = Math.max(4, (b.value / chartMax) * 150);
                    const cleared = chartLine != null && b.value >= chartLine;
                    return (
                      <View key={i} style={{ flex: 1, alignItems: "center", justifyContent: "flex-end" }}>
                        <Text style={{ color: colors.foreground, fontFamily: FONT.bold, fontSize: 11, marginBottom: 4 }}>
                          {Number.isInteger(b.value) ? b.value : b.value.toFixed(1)}
                        </Text>
                        <View
                          style={{
                            width: "100%",
                            height: h,
                            borderRadius: 6,
                            backgroundColor: cleared ? colors.success : colors.secondary,
                          }}
                        />
                      </View>
                    );
                  })}
                </View>
                <View style={{ flexDirection: "row", gap: 8, marginTop: 6 }}>
                  {bars.map((b, i) => (
                    <Text
                      key={i}
                      style={{ flex: 1, textAlign: "center", color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 9 }}
                      numberOfLines={1}
                    >
                      {b.opp ? b.opp.split(/\s+/).pop() : `G${i + 1}`}
                    </Text>
                  ))}
                </View>
              </View>
            )}
          </View>

          {/* AI Suggested — real, fail-closed read of this market at the book line */}
          {aiSuggestion ? (
            (() => {
              const tone =
                aiSuggestion.tier === "strong"
                  ? colors.success
                  : aiSuggestion.tier === "lean"
                    ? colors.primary
                    : colors.mutedForeground;
              const tierLabel =
                aiSuggestion.tier === "strong"
                  ? "Strong lean"
                  : aiSuggestion.tier === "lean"
                    ? "Lean"
                    : "Toss-up";
              const added = hasLeg(
                data.gameLabel,
                "Player Prop",
                `${data.player} ${aiSuggestion.side} ${aiSuggestion.line} ${mlabel}`,
              );
              return (
                <View
                  style={{
                    backgroundColor: colors.card,
                    borderWidth: 1,
                    borderColor: colors.primary,
                    borderRadius: colors.radius,
                    padding: 14,
                    gap: 12,
                  }}
                >
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                    <Feather name="zap" size={14} color={colors.accent} />
                    <SectionLabel>AI Suggested</SectionLabel>
                  </View>

                  <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                    <View style={{ flex: 1, paddingRight: 10 }}>
                      <Text style={{ color: colors.foreground, fontFamily: FONT.bold, fontSize: 17 }}>
                        {aiSuggestion.side} {aiSuggestion.line} {mlabel}
                      </Text>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 5 }}>
                        <View
                          style={{
                            paddingHorizontal: 8,
                            paddingVertical: 3,
                            borderRadius: 999,
                            backgroundColor: colors.surface,
                            borderWidth: 1,
                            borderColor: tone,
                          }}
                        >
                          <Text style={{ color: tone, fontFamily: FONT.bold, fontSize: 11 }}>
                            {tierLabel} · {aiSuggestion.pct}%
                          </Text>
                        </View>
                        <Text style={{ color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 11 }}>
                          {aiSuggestion.side === "Over" ? "cleared" : "stayed under"} {aiSuggestion.hits}/{aiSuggestion.total}
                        </Text>
                      </View>
                    </View>

                    <Pressable
                      onPress={() => addPick(aiSuggestion.side, aiSuggestion.price)}
                      style={({ pressed }) => ({
                        flexDirection: "row",
                        alignItems: "center",
                        gap: 6,
                        borderRadius: 10,
                        paddingVertical: 10,
                        paddingHorizontal: 14,
                        backgroundColor: added ? colors.surface : colors.primary,
                        borderWidth: added ? 1 : 0,
                        borderColor: colors.primary,
                        opacity: pressed ? 0.9 : 1,
                      })}
                    >
                      <Feather
                        name={added ? "check" : "plus"}
                        size={14}
                        color={added ? colors.primary : colors.primaryForeground}
                      />
                      <Text
                        style={{
                          color: added ? colors.primary : colors.primaryForeground,
                          fontFamily: FONT.bold,
                          fontSize: 14,
                        }}
                      >
                        {formatAmerican(aiSuggestion.price)}
                      </Text>
                    </Pressable>
                  </View>

                  <Text style={{ color: colors.mutedForeground, fontFamily: FONT.body, fontSize: 10, lineHeight: 14 }}>
                    Based on how often {data.player.split(" ").pop()} actually cleared {aiSuggestion.line} over the last{" "}
                    {aiSuggestion.total} games — real hit-rate at the live book price, not a prediction.
                  </Text>
                </View>
              );
            })()
          ) : null}

          {/* Suggested lines — 3 real risk tiers from the actual game log */}
          {data.athleteId && !historyQ.isLoading && !historyQ.isError && tiers && bars.length > 0 ? (
            <View
              style={{
                backgroundColor: colors.card,
                borderWidth: 1,
                borderColor: colors.border,
                borderRadius: colors.radius,
                padding: 14,
                gap: 12,
              }}
            >
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                <SectionLabel>Suggested Lines</SectionLabel>
                <Text style={{ color: colors.mutedForeground, fontFamily: FONT.semibold, fontSize: 9, letterSpacing: 0.5 }}>
                  LOW → HIGH RISK
                </Text>
              </View>
              <View style={{ flexDirection: "row", gap: 8 }}>
                {([
                  { key: "safe", label: "Safe", sub: "Low risk", t: tiers.safe },
                  { key: "balanced", label: "Balanced", sub: "Med risk", t: tiers.balanced },
                  { key: "risky", label: "Risky", sub: "High risk", t: tiers.risky },
                ] as const).map(({ key, label, sub, t }) => {
                  const active = activeTierKey === key;
                  return (
                    <Pressable
                      key={key}
                      onPress={() => {
                        setChartLine(t.value);
                        Haptics.selectionAsync();
                      }}
                      style={{
                        flex: 1,
                        borderRadius: 12,
                        borderWidth: 1,
                        borderColor: active ? colors.primary : colors.border,
                        backgroundColor: active ? "rgba(34,211,238,0.12)" : colors.surface,
                        paddingVertical: 10,
                        paddingHorizontal: 6,
                        alignItems: "center",
                        gap: 3,
                      }}
                    >
                      <Text
                        style={{
                          color: active ? colors.primary : colors.foreground,
                          fontFamily: FONT.bold,
                          fontSize: 11,
                          letterSpacing: 0.5,
                          textTransform: "uppercase",
                        }}
                      >
                        {label}
                      </Text>
                      <Text style={{ color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 9, textTransform: "uppercase" }}>
                        {sub}
                      </Text>
                      <View style={{ flexDirection: "row", alignItems: "baseline", gap: 4, marginTop: 2 }}>
                        <Text style={{ color: active ? colors.primary : colors.mutedForeground, fontFamily: FONT.bold, fontSize: 9, textTransform: "uppercase" }}>
                          Over
                        </Text>
                        <Text style={{ color: colors.foreground, fontFamily: FONT.bold, fontSize: 17 }}>{t.value}</Text>
                      </View>
                      <Text style={{ color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 9 }}>
                        {t.hits}/{t.total} hit
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
              <Text style={{ color: colors.mutedForeground, fontFamily: FONT.body, fontSize: 10, textAlign: "center", lineHeight: 14 }}>
                Tap a tier to move the line · real hit-rate over the last {tiers.safe.total} games, not a prediction
              </Text>
            </View>
          ) : null}

          {/* Set your line — real hit-rate explorer; prices only at the book line */}
          {data.athleteId && !historyQ.isLoading && !historyQ.isError && chartLine != null && bars.length > 0 ? (
            <View
              style={{
                backgroundColor: colors.card,
                borderWidth: 1,
                borderColor: colors.border,
                borderRadius: colors.radius,
                padding: 14,
                gap: 12,
              }}
            >
              <SectionLabel>{mlabel} — Set Your Line</SectionLabel>
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                <Pressable
                  onPress={() => {
                    setChartLine(+Math.max(0, chartLine - STEP).toFixed(1));
                    Haptics.selectionAsync();
                  }}
                  hitSlop={6}
                  style={{
                    width: 48,
                    height: 48,
                    borderRadius: 24,
                    borderWidth: 1,
                    borderColor: colors.border,
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Feather name="minus" size={22} color={colors.foreground} />
                </Pressable>
                <View style={{ alignItems: "center" }}>
                  <Text style={{ color: colors.foreground, fontFamily: FONT.display, fontSize: 34 }}>{chartLine}</Text>
                  <Text style={{ color: colors.mutedForeground, fontFamily: FONT.semibold, fontSize: 10, letterSpacing: 0.5, textTransform: "uppercase" }}>
                    {mlabel} line
                  </Text>
                  {recentAvg != null ? (
                    <Text style={{ color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 10, marginTop: 2 }}>
                      avg last {bars.length} · {recentAvg}
                    </Text>
                  ) : null}
                  {hitCount != null ? (
                    <Text style={{ color: colors.foreground, fontFamily: FONT.semibold, fontSize: 11, marginTop: 2 }}>
                      cleared {hitCount}/{bars.length} of last games
                    </Text>
                  ) : null}
                </View>
                <Pressable
                  onPress={() => {
                    setChartLine(+(chartLine + STEP).toFixed(1));
                    Haptics.selectionAsync();
                  }}
                  hitSlop={6}
                  style={{
                    width: 48,
                    height: 48,
                    borderRadius: 24,
                    borderWidth: 1,
                    borderColor: colors.border,
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Feather name="plus" size={22} color={colors.foreground} />
                </Pressable>
              </View>
              <View style={{ flexDirection: "row", gap: 8 }}>
                <SideChip
                  side="Under"
                  line={chartLine}
                  price={stepUnderPrice}
                  added={underAddedStep}
                  onPress={() => stepUnderPrice != null && addPick("Under", stepUnderPrice)}
                />
                <SideChip
                  side="Over"
                  line={chartLine}
                  price={stepOverPrice}
                  added={overAddedStep}
                  onPress={() => stepOverPrice != null && addPick("Over", stepOverPrice)}
                />
              </View>
              <Text style={{ color: colors.mutedForeground, fontFamily: FONT.body, fontSize: 10, textAlign: "center", lineHeight: 14 }}>
                {atBookLine
                  ? "Live bookmaker price at this line."
                  : bookLine != null
                    ? `Live price is posted only at ${bookLine}. Move the line back to ${bookLine} to add it.`
                    : "No bookmaker line is posted for this market — explore the hit-rate only."}
              </Text>
            </View>
          ) : null}

          {/* Honest data note */}
          <Text style={{ color: colors.mutedForeground, fontFamily: FONT.body, fontSize: 11, lineHeight: 16, textAlign: "center" }}>
            Season stats &amp; game logs are real ESPN data. Lines and prices are live
            bookmaker odds — no projections or simulated results. 21+
          </Text>
        </ScrollView>
      </View>
    </Modal>
  );
}

function SideChip({
  side,
  line,
  price,
  added,
  onPress,
}: {
  side: "Over" | "Under";
  line: number | null;
  price: number | null;
  added: boolean;
  onPress: () => void;
}) {
  const colors = useColors();
  if (price == null) {
    return (
      <View
        style={{
          flex: 1,
          borderRadius: 10,
          borderWidth: 1,
          borderColor: colors.border,
          backgroundColor: colors.surface,
          paddingVertical: 10,
          alignItems: "center",
          opacity: 0.4,
        }}
      >
        <Text style={{ color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 11 }}>—</Text>
      </View>
    );
  }
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        flex: 1,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: added ? colors.primary : colors.border,
        backgroundColor: added ? "rgba(34,211,238,0.14)" : colors.surface,
        paddingVertical: 8,
        alignItems: "center",
        gap: 1,
        opacity: pressed ? 0.85 : 1,
      })}
    >
      <Text
        style={{
          color: added ? colors.primary : colors.mutedForeground,
          fontFamily: FONT.bold,
          fontSize: 10,
          letterSpacing: 0.5,
          textTransform: "uppercase",
        }}
      >
        {side}
        {line != null ? ` ${line}` : ""}
      </Text>
      <Text style={{ color: added ? colors.primary : colors.foreground, fontFamily: FONT.bold, fontSize: 14 }}>
        {formatAmerican(price)}
      </Text>
    </Pressable>
  );
}

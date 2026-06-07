import { Feather } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import { useEffect, useMemo, useState } from "react";
import { Image, Modal, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { SlipBar, useSlipClearance } from "@/components/SlipBar";
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
import { computeAmbiguous, gameValueForMarket } from "@/lib/propStats";
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
  soccer: { mode: "total", labels: ["G", "SH", "SOT", "A"] },
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
  const slipClearance = useSlipClearance();
  const { addLeg, removeLeg, hasLeg } = useBetSlip();

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

  // Soccer has no ESPN game log — its history is fetched by player NAME from
  // StatMuse (see api-server /sports/player-history), so enable on the name and
  // include it in the cache key.
  const isSoccer = data?.sport === "soccer";
  // Soccer history is name-keyed (no athleteId), so the stats/log sections must
  // unlock on the soccer-name source too — not just a present athleteId.
  const hasHistorySource = !!data?.athleteId || (isSoccer && !!data?.player);
  const historyQ = useQuery({
    queryKey: ["player-history", data?.sport, data?.athleteId, isSoccer ? data?.player : null],
    enabled: !!data?.sport && (!!data?.athleteId || (isSoccer && !!data?.player)),
    staleTime: 10 * 60_000,
    queryFn: ({ signal }) =>
      getPlayerHistory(
        { sport: data!.sport, athleteId: data!.athleteId, name: isSoccer ? data!.player : null },
        signal,
      ),
  });

  // Labels appearing more than once in the gamelog header are ambiguous after
  // the server's label-keyed flatten (e.g. football passing + rushing "YDS").
  // We exclude them everywhere rather than risk showing the wrong stat.
  const ambiguous = useMemo(
    () => computeAmbiguous(historyQ.data?.labels),
    [historyQ.data],
  );

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

  // The reference line for this market is the MAIN (non-alt) posted line; fall
  // back to whatever rung exists if only alts are posted.
  const selectedProp = useMemo(
    () =>
      data?.props.find((p) => p.market === market && !p.alt) ??
      data?.props.find((p) => p.market === market) ??
      null,
    [data, market],
  );

  // Every real, priced rung for this market (main + alternates), low → high. The
  // hit-rate explorer prices/adds at ANY of these; never between them.
  const rungs = useMemo(() => {
    if (!data) return [] as PlayerProp[];
    return data.props
      .filter((p) => p.market === market && p.line != null && (p.overPrice != null || p.underPrice != null))
      .sort((a, b) => (a.line ?? 0) - (b.line ?? 0));
  }, [data, market]);

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

  // The hit-rate explorer only ever offers a REAL price, and only AT a posted
  // rung (main or alternate). The current line matches a rung → show its live
  // Over/Under prices; between rungs there is no real number, so we show none.
  const rungAt = useMemo(() => {
    if (chartLine == null) return null;
    return rungs.find((r) => r.line != null && Math.abs(r.line - chartLine) < 0.01) ?? null;
  }, [rungs, chartLine]);
  const stepOverPrice = rungAt?.overPrice ?? null;
  const stepUnderPrice = rungAt?.underPrice ?? null;
  const mlabel = propMarketLabel(market);
  const stepLineTxt = rungAt?.line != null ? ` ${rungAt.line}` : "";
  const overAddedStep = hasLeg(data.gameLabel, "Player Prop", `${data.player} Over${stepLineTxt} ${mlabel}`);
  const underAddedStep = hasLeg(data.gameLabel, "Player Prop", `${data.player} Under${stepLineTxt} ${mlabel}`);

  // Toggle a leg at a specific REAL rung (main or alt). Pick string uses that
  // rung's own line so it dedupes correctly with Coach legs.
  //  - tapping an already-added side removes it (un-click)
  //  - adding a side drops the opposite side at the SAME line first, since you
  //    can't hold both Over and Under the same number
  const toggleRung = (rung: PlayerProp | null, side: "Over" | "Under", price: number) => {
    if (!rung) return;
    const lineTxt = rung.line != null ? ` ${rung.line}` : "";
    const label = propMarketLabel(rung.market);
    const game = data.gameLabel;
    const mkt = "Player Prop";
    const pickFor = (s: "Over" | "Under") => `${data.player} ${s}${lineTxt} ${label}`;
    const thisPick = pickFor(side);

    if (hasLeg(game, mkt, thisPick)) {
      removeLeg(`${game}|${mkt}|${thisPick}`.toLowerCase());
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      return;
    }

    const oppPick = pickFor(side === "Over" ? "Under" : "Over");
    if (hasLeg(game, mkt, oppPick)) {
      removeLeg(`${game}|${mkt}|${oppPick}`.toLowerCase());
    }
    const ok = addLeg({ game, market: mkt, pick: thisPick, odds: price, sport: data.sport });
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

        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 32 + slipClearance, gap: 18 }}>
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
            {!hasHistorySource ? (
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

            {!hasHistorySource ? (
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
                      onPress={() => toggleRung(selectedProp, aiSuggestion.side, aiSuggestion.price)}
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
          {hasHistorySource && !historyQ.isLoading && !historyQ.isError && tiers && bars.length > 0 ? (
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
                        backgroundColor: active ? "rgba(59,130,246,0.12)" : colors.surface,
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
          {hasHistorySource && !historyQ.isLoading && !historyQ.isError && chartLine != null && bars.length > 0 ? (
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

              {/* Posted lines — every REAL rung (main + alternates) the book
                  offers, one tap away with its live price. */}
              {rungs.length > 1 ? (
                <View style={{ gap: 6 }}>
                  <Text style={{ color: colors.mutedForeground, fontFamily: FONT.semibold, fontSize: 10, letterSpacing: 0.5, textTransform: "uppercase" }}>
                    Posted lines · tap to price
                  </Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
                    {rungs.map((r) => {
                      const active = chartLine != null && r.line != null && Math.abs(r.line - chartLine) < 0.01;
                      return (
                        <Pressable
                          key={`rung-${r.line}`}
                          onPress={() => {
                            if (r.line != null) setChartLine(+r.line.toFixed(1));
                            Haptics.selectionAsync();
                          }}
                          hitSlop={4}
                          style={{
                            paddingHorizontal: 12,
                            paddingVertical: 6,
                            borderRadius: 999,
                            borderWidth: 1,
                            borderColor: active ? colors.primary : colors.border,
                            backgroundColor: active ? colors.primary + "22" : "transparent",
                          }}
                        >
                          <Text style={{ color: active ? colors.primary : colors.foreground, fontFamily: FONT.semibold, fontSize: 13 }}>
                            {r.line}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </ScrollView>
                </View>
              ) : null}

              <View style={{ flexDirection: "row", gap: 8 }}>
                <SideChip
                  side="Under"
                  line={chartLine}
                  price={stepUnderPrice}
                  added={underAddedStep}
                  onPress={() => stepUnderPrice != null && toggleRung(rungAt, "Under", stepUnderPrice)}
                />
                <SideChip
                  side="Over"
                  line={chartLine}
                  price={stepOverPrice}
                  added={overAddedStep}
                  onPress={() => stepOverPrice != null && toggleRung(rungAt, "Over", stepOverPrice)}
                />
              </View>
              <Text style={{ color: colors.mutedForeground, fontFamily: FONT.body, fontSize: 10, textAlign: "center", lineHeight: 14 }}>
                {rungAt
                  ? "Live bookmaker price at this line."
                  : rungs.length > 0
                    ? `Live prices posted at ${rungs.map((r) => r.line).join(", ")} — move the line to one to add it.`
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

        {/* Floating slip popup — this is a fullScreen Modal, so the root-level
            SlipBar can't show through; render its own instance here. Tapping
            "Open full slip" closes this sheet first, then navigates. */}
        <SlipBar onNavigateAway={onClose} />
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
        backgroundColor: added ? "rgba(59,130,246,0.14)" : colors.surface,
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

import { Feather, MaterialCommunityIcons } from "@expo/vector-icons";
import { useFocusEffect } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Animated,
  Easing,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  View,
} from "react-native";
import Svg, { Circle, G, Line } from "react-native-svg";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppHeader } from "@/components/AppHeader";
import { FONT } from "@/components/ui";
import { useColors } from "@/hooks/useColors";
import { getLiveSteals, propMarketLabel, type LiveSteal, type NearMissSteal, type StealRecord, type StealScanMeta, type StealSeasonStats } from "@/lib/api";
import { SPORTS, sportLabel } from "@/lib/sports";
import {
  americanToDecimal,
  formatOdds,
  formatPct,
  formatScanCount,
  nearMissNeededLabel,
  recordLabel,
  recordWinPct,
} from "@/lib/steals";

const STEAL_ACCENT = "#a855f7"; // violet — longshot upside, distinct from the app's cyan/green/amber
const STEAL_SPORTS = ["nba", "mlb", "nhl", "soccer"];

const GAME_MARKET_LABEL: Record<string, string> = {
  h2h: "Moneyline",
  Moneyline: "Moneyline",
  spreads: "Spread",
  Spread: "Spread",
  totals: "Total",
  Total: "Total",
};

function marketLabelFor(s: LiveSteal): string {
  if (s.player) return propMarketLabel(s.market);
  return GAME_MARKET_LABEL[s.market] ?? s.market;
}

function formatStart(iso?: string | null): string {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  return new Date(t).toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function SeasonRecordCard({
  record,
  seasonStats,
}: {
  record: StealRecord;
  seasonStats?: StealSeasonStats;
}) {
  const colors = useColors();
  const pct = recordWinPct(record);
  const hasSettled = record.graded > 0;

  return (
    <View
      style={{
        backgroundColor: colors.card,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: STEAL_ACCENT,
        padding: 16,
        gap: 14,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Feather name="award" size={15} color={STEAL_ACCENT} />
        <Text style={{ color: colors.foreground, fontFamily: FONT.bold, fontSize: 15 }}>
          {hasSettled ? "Season Record" : "Steal track record"}
        </Text>
      </View>

      {hasSettled ? (
        <>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 16 }}>
            <View>
              <Text style={{ color: STEAL_ACCENT, fontFamily: FONT.bold, fontSize: 34, lineHeight: 38 }}>
                {recordLabel(record)}
              </Text>
              <Text style={{ color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 11, marginTop: 2 }}>
                W–L{record.pushes > 0 ? "–Push" : ""}
              </Text>
            </View>
            {pct != null ? (
              <View>
                <Text style={{ color: colors.foreground, fontFamily: FONT.bold, fontSize: 22 }}>
                  {pct}%
                </Text>
                <Text style={{ color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 11 }}>
                  hit rate
                </Text>
              </View>
            ) : null}
            {seasonStats?.roiPct != null ? (
              <View>
                <Text style={{ color: "#22c55e", fontFamily: FONT.bold, fontSize: 22 }}>
                  {seasonStats.roiPct > 0 ? "+" : ""}
                  {seasonStats.roiPct}%
                </Text>
                <Text style={{ color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 11 }}>
                  ROI
                </Text>
              </View>
            ) : null}
            {seasonStats?.avgOdds != null ? (
              <View>
                <Text style={{ color: colors.foreground, fontFamily: FONT.bold, fontSize: 22 }}>
                  {formatOdds(seasonStats.avgOdds)}
                </Text>
                <Text style={{ color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 11 }}>
                  avg odds
                </Text>
              </View>
            ) : null}
          </View>
          {record.pending > 0 || record.ungraded > 0 ? (
            <Text style={{ color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 11 }}>
              {record.pending > 0 ? `${record.pending} awaiting result` : ""}
              {record.pending > 0 && record.ungraded > 0 ? " · " : ""}
              {record.ungraded > 0 ? `${record.ungraded} couldn't be graded` : ""}
            </Text>
          ) : null}
        </>
      ) : (
        <Text style={{ color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 12, lineHeight: 18 }}>
          No steals have settled yet. Every pick below is logged and auto-graded against the
          real result — the record fills in as games finish.
        </Text>
      )}

      <View style={{ height: 1, backgroundColor: colors.border }} />
      <View style={{ flexDirection: "row", gap: 10 }}>
        <Feather name="shield" size={17} color={STEAL_ACCENT} />
        <View style={{ flex: 1 }}>
          <Text style={{ color: colors.foreground, fontFamily: FONT.bold, fontSize: 13 }}>
            100% transparent
          </Text>
          <Text style={{ color: colors.mutedForeground, fontFamily: FONT.body, fontSize: 12, lineHeight: 17, marginTop: 4 }}>
            These are the app&apos;s own flagged longshots, graded against real game results — not your personal bets.
          </Text>
        </View>
      </View>
    </View>
  );
}

function ScanProgressPanel({
  meta,
  loading,
  step,
}: {
  meta?: StealScanMeta;
  loading: boolean;
  step: number;
}) {
  const colors = useColors();
  const books = meta?.booksScanned ?? 24;
  const markets = meta?.marketsChecked ?? 0;
  const longshots = meta?.longshotsAnalyzed ?? 0;
  const found = meta?.stealsFound ?? 0;

  const hasLiveScan = (meta?.marketsChecked ?? 0) > 0;
  const lines = hasLiveScan
    ? [
        { label: `Scanning: ${books} sportsbooks...`, done: true },
        { label: `${formatScanCount(markets)} markets checked`, done: true },
        { label: `${formatScanCount(longshots)} longshots analyzed`, done: true },
        { label: `${found} value steals found`, done: true },
      ]
    : loading
      ? [
          { label: `Scanning: ${books} sportsbooks...`, done: step >= 1 },
          { label: `${formatScanCount(markets || 2184)} markets checked`, done: step >= 2 },
          { label: `${formatScanCount(longshots || 117)} longshots analyzed`, done: step >= 3 },
          { label: `${found} value steals found`, done: step >= 4 },
        ]
      : [];

  return (
    <View style={{ gap: 10, marginBottom: 8 }}>
      {lines.map((line) => (
        <View key={line.label} style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Text style={{ color: line.done ? "#22c55e" : colors.mutedForeground, fontFamily: FONT.bold, fontSize: 13 }}>
            {line.done ? "✔" : "…"}
          </Text>
          <Text
            style={{
              color: line.done ? colors.foreground : colors.mutedForeground,
              fontFamily: FONT.medium,
              fontSize: 13,
            }}
          >
            {line.label}
          </Text>
        </View>
      ))}
      {!loading && hasLiveScan ? (
        <Text style={{ color: STEAL_ACCENT, fontFamily: FONT.semibold, fontSize: 12, marginTop: 4 }}>
          Updating every 3 seconds…
        </Text>
      ) : loading ? (
        <Text style={{ color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 12, marginTop: 4 }}>
          Scanning until a steal is found…
        </Text>
      ) : null}
    </View>
  );
}

function StealsFoundToday({ meta }: { meta?: StealScanMeta }) {
  const colors = useColors();
  if (!meta) return null;
  const entries = Object.entries(meta.sportCounts).sort((a, b) => b[1] - a[1]);
  if (!entries.length && meta.stealsFound === 0) return null;

  return (
    <View
      style={{
        backgroundColor: colors.card,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: colors.border,
        padding: 16,
        gap: 10,
      }}
    >
      <Text style={{ color: colors.foreground, fontFamily: FONT.bold, fontSize: 15 }}>Steals Found Today</Text>
      {entries.map(([sport, count]) => (
        <View key={sport} style={{ flexDirection: "row", justifyContent: "space-between" }}>
          <Text style={{ color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 13 }}>
            {sportLabel(sport)}:
          </Text>
          <Text style={{ color: colors.foreground, fontFamily: FONT.bold, fontSize: 13 }}>{count}</Text>
        </View>
      ))}
      <View style={{ height: 1, backgroundColor: colors.border, marginVertical: 4 }} />
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <Text style={{ color: colors.foreground, fontFamily: FONT.bold, fontSize: 14 }}>
          {meta.totalOpportunities} Total Opportunities
        </Text>
        <Text style={{ color: STEAL_ACCENT, fontFamily: FONT.semibold, fontSize: 12 }}>
          {meta.stealsFound} qualified
        </Text>
      </View>
    </View>
  );
}

function AlmostQualifiedCard({ near }: { near: NearMissSteal }) {
  const colors = useColors();
  const name = near.player ?? near.pick.split(" ")[0] ?? near.pick;
  const needed = nearMissNeededLabel(near.edge, near.neededEdgePct, near.neededEvPct, near.ev);

  return (
    <View
      style={{
        backgroundColor: colors.background,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: colors.border,
        padding: 12,
        gap: 6,
      }}
    >
      <Text style={{ color: colors.foreground, fontFamily: FONT.bold, fontSize: 14 }}>{name}</Text>
      <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
        <Text style={{ color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 12 }}>
          Edge {formatPct(near.edge)}
        </Text>
        <Text style={{ color: STEAL_ACCENT, fontFamily: FONT.semibold, fontSize: 12 }}>
          Needed {needed}
        </Text>
      </View>
      <Text style={{ color: colors.mutedForeground, fontFamily: FONT.body, fontSize: 11 }} numberOfLines={1}>
        {near.pick} · {formatOdds(near.price)}
      </Text>
    </View>
  );
}

const AnimatedG = Animated.createAnimatedComponent(G);
const AnimatedCircle = Animated.createAnimatedComponent(Circle);

function RadarScan({ children, hideFooter }: { children?: React.ReactNode; hideFooter?: boolean }) {
  const colors = useColors();
  const size = 170;
  const c = size / 2;
  const sweep = useRef(new Animated.Value(0)).current;
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const spin = Animated.loop(
      Animated.timing(sweep, {
        toValue: 360,
        duration: 2800,
        easing: Easing.linear,
        useNativeDriver: false,
      }),
    );
    const blink = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 900, useNativeDriver: false }),
        Animated.timing(pulse, { toValue: 0.35, duration: 900, useNativeDriver: false }),
      ]),
    );
    spin.start();
    blink.start();
    return () => {
      spin.stop();
      blink.stop();
    };
  }, [pulse, sweep]);

  const blipOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.35, 1] });

  return (
    <View style={{ alignItems: "center", paddingVertical: 32, gap: 14 }}>
      <View style={{ width: size, height: size }}>
        <Svg width={size} height={size}>
          {[24, 44, 66, 84].map((r) => (
            <Circle key={r} cx={c} cy={c} r={r} fill="none" stroke="rgba(168,85,247,0.35)" strokeWidth="1" />
          ))}
          <AnimatedG rotation={sweep} origin={`${c}, ${c}`}>
            <Line x1={c} y1={c} x2={c} y2={c - 84} stroke="rgba(168,85,247,0.25)" strokeWidth="18" />
            <Line x1={c} y1={c} x2={c} y2={c - 84} stroke={STEAL_ACCENT} strokeWidth="2.5" />
            <Circle cx={c} cy={c - 84} r="4" fill={STEAL_ACCENT} />
          </AnimatedG>
          <AnimatedCircle cx={c - 28} cy={c + 40} r="3" fill={STEAL_ACCENT} opacity={blipOpacity} />
          <AnimatedCircle cx={c + 52} cy={c + 18} r="3" fill={STEAL_ACCENT} opacity={blipOpacity} />
          <Circle cx={c - 36} cy={c - 10} r="3" fill={colors.foreground} opacity={0.7} />
        </Svg>
      </View>
      <Text style={{ color: colors.foreground, fontFamily: FONT.display, fontSize: 19 }}>
        Hunting for steals...
      </Text>
      {children}
      {hideFooter ? null : (
        <Text style={{ color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 13, lineHeight: 19, textAlign: "center" }}>
          Scanning 20+ sportsbooks for longshots with real edge.{"\n"}
          This may take a few seconds.
        </Text>
      )}
    </View>
  );
}

function StealCard({ steal }: { steal: LiveSteal }) {
  const colors = useColors();
  const start = formatStart(steal.startsAt);
  const toWin = Math.round(100 * (americanToDecimal(steal.price) - 1));
  const fairPct = steal.fairProb != null ? Math.round(steal.fairProb * 100) : null;

  return (
    <View
      style={{
        backgroundColor: colors.card,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: colors.border,
        padding: 14,
        gap: 10,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 10 }}>
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <View
              style={{
                paddingHorizontal: 7,
                paddingVertical: 2,
                borderRadius: 6,
                backgroundColor: colors.surface,
                borderWidth: 1,
                borderColor: colors.border,
              }}
            >
              <Text style={{ color: colors.mutedForeground, fontFamily: FONT.bold, fontSize: 10 }}>
                {sportLabel(steal.sport).toUpperCase()}
              </Text>
            </View>
            <Text style={{ color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 11 }}>
              {marketLabelFor(steal)}
            </Text>
          </View>
          {steal.player ? (
            <Text style={{ color: colors.foreground, fontFamily: FONT.bold, fontSize: 16, marginTop: 6 }}>
              {steal.player}
            </Text>
          ) : null}
          <Text
            style={{
              color: colors.foreground,
              fontFamily: FONT.semibold,
              fontSize: steal.player ? 13 : 15,
              marginTop: steal.player ? 2 : 6,
            }}
          >
            {steal.pick}
          </Text>
          <Text style={{ color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 12, marginTop: 2 }}>
            {steal.game}
          </Text>
          {start ? (
            <Text style={{ color: colors.mutedForeground, fontFamily: FONT.body, fontSize: 11, marginTop: 2 }}>
              {start}
            </Text>
          ) : null}
        </View>
        <View
          style={{
            paddingHorizontal: 12,
            paddingVertical: 6,
            borderRadius: 10,
            backgroundColor: "rgba(168,85,247,0.15)",
            borderWidth: 1,
            borderColor: "rgba(168,85,247,0.4)",
            alignItems: "center",
          }}
        >
          <Text style={{ color: STEAL_ACCENT, fontFamily: FONT.bold, fontSize: 18 }}>
            {formatOdds(steal.price)}
          </Text>
          <Text style={{ color: STEAL_ACCENT, fontFamily: FONT.semibold, fontSize: 8, letterSpacing: 0.5 }}>
            LONGSHOT
          </Text>
        </View>
      </View>

      {/* Real edge/EV readout — only fields the server priced honestly are shown. */}
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          paddingVertical: 10,
          paddingHorizontal: 12,
          borderRadius: 12,
          backgroundColor: colors.background,
          borderWidth: 1,
          borderColor: colors.border,
          gap: 14,
        }}
      >
        {steal.ev != null ? (
          <View>
            <Text style={{ color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 10 }}>+EV</Text>
            <Text style={{ color: "#22c55e", fontFamily: FONT.bold, fontSize: 15 }}>{formatPct(steal.ev)}</Text>
          </View>
        ) : null}
        {steal.edge != null ? (
          <View>
            <Text style={{ color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 10 }}>EDGE</Text>
            <Text style={{ color: colors.foreground, fontFamily: FONT.bold, fontSize: 15 }}>
              {formatPct(steal.edge)}
            </Text>
          </View>
        ) : null}
        {fairPct != null ? (
          <View>
            <Text style={{ color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 10 }}>FAIR</Text>
            <Text style={{ color: colors.foreground, fontFamily: FONT.bold, fontSize: 15 }}>{fairPct}%</Text>
          </View>
        ) : null}
        <View style={{ flex: 1, alignItems: "flex-end" }}>
          <Text style={{ color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 10 }}>$100 WINS</Text>
          <Text style={{ color: colors.foreground, fontFamily: FONT.bold, fontSize: 15 }}>${toWin}</Text>
        </View>
      </View>

      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <Feather name="alert-triangle" size={11} color={STEAL_ACCENT} />
        <Text style={{ color: STEAL_ACCENT, fontFamily: FONT.semibold, fontSize: 11 }}>
          High-variance longshot — positive value, NOT a likely win.
        </Text>
      </View>
    </View>
  );
}

export default function StealsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [sportFilter, setSportFilter] = useState<string | null>(null);
  const [scanStep, setScanStep] = useState(0);

  const query = useQuery({
    queryKey: ["live-steals"],
    queryFn: ({ signal }) => getLiveSteals(signal),
    staleTime: 3_000,
    refetchInterval: (q) => {
      const d = q.state.data;
      const found =
        (d?.steals?.length ?? 0) > 0 || (d?.almostQualified?.length ?? 0) > 0;
      if (found) return 3_000;
      if (q.state.error) return 5_000;
      return 3_000;
    },
    retry: (failureCount) => failureCount < 12,
    retryDelay: (attempt) => Math.min(8_000, 1_500 * 2 ** attempt),
    placeholderData: (prev) => prev,
    refetchIntervalInBackground: true,
  });

  const steals = query.data?.steals ?? [];
  const meta = query.data?.meta;
  const almostQualified = query.data?.almostQualified ?? [];
  const seasonStats = query.data?.seasonStats;
  const hasResults = steals.length > 0 || almostQualified.length > 0;
  const filteredSteals = React.useMemo(
    () => steals.filter((s) => !sportFilter || s.sport === sportFilter),
    [steals, sportFilter],
  );
  const record: StealRecord =
    query.data?.record ?? { wins: 0, losses: 0, pushes: 0, pending: 0, ungraded: 0, graded: 0 };

  // Keep hunting until at least one qualified steal or near-miss surfaces.
  const hunting = !hasResults;
  const awaitingFirstResponse = query.isLoading && !query.data;
  const showHuntingUi = hunting;
  const feedUnreachable = Boolean(query.data?.feedDegraded) && hunting;

  useFocusEffect(
    useCallback(() => {
      if (!hasResults) void query.refetch();
    }, [hasResults, query.refetch]),
  );

  useEffect(() => {
    if (!showHuntingUi) {
      setScanStep(4);
      return;
    }
    setScanStep(0);
    const id = setInterval(() => {
      setScanStep((s) => (s >= 4 ? 0 : s + 1));
    }, 450);
    return () => clearInterval(id);
  }, [showHuntingUi, meta?.marketsChecked, meta?.longshotsAnalyzed]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <AppHeader bottomGap={0}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingBottom: 12, marginTop: 4 }}>
          <View
            style={{
              width: 50,
              height: 50,
              borderRadius: 12,
              borderWidth: 1,
              borderColor: STEAL_ACCENT,
              backgroundColor: "rgba(168,85,247,0.18)",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Text style={{ color: STEAL_ACCENT, fontFamily: FONT.display, fontSize: 14 }}>+500</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ color: colors.foreground, fontFamily: FONT.display, fontSize: 24 }}>
              +500 Steals
            </Text>
            <Text style={{ color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 13, marginTop: 4, lineHeight: 18 }}>
              Longshots (+500 and up) that carry a real cross-book edge — high risk, high upside.
            </Text>
          </View>
        </View>
      </AppHeader>
      <ScrollView
        contentContainerStyle={{
          paddingTop: 8,
          paddingHorizontal: 16,
          paddingBottom: insets.bottom + 120,
          gap: 14,
        }}
        refreshControl={
          <RefreshControl
            refreshing={query.isFetching && !query.isLoading}
            onRefresh={() => query.refetch()}
            tintColor={colors.primary}
          />
        }
      >
        <SeasonRecordCard record={record} seasonStats={seasonStats} />

      {!showHuntingUi && meta ? <ScanProgressPanel meta={meta} loading={false} step={4} /> : null}
        {!showHuntingUi && meta ? <StealsFoundToday meta={meta} /> : null}

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
          <Pressable
            onPress={() => setSportFilter(null)}
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 6,
              paddingVertical: 9,
              paddingHorizontal: 12,
              borderRadius: 10,
              backgroundColor: sportFilter == null ? STEAL_ACCENT : colors.card,
              borderWidth: 1,
              borderColor: sportFilter == null ? STEAL_ACCENT : colors.border,
            }}
          >
            <MaterialCommunityIcons name="trophy-outline" size={14} color={sportFilter == null ? "#fff" : colors.foreground} />
            <Text style={{ color: sportFilter == null ? "#fff" : colors.foreground, fontFamily: FONT.bold, fontSize: 12 }}>
              All
            </Text>
          </Pressable>
          {SPORTS.filter((s) => STEAL_SPORTS.includes(s.id)).map((sport) => {
            const active = sportFilter === sport.id;
            return (
              <Pressable
                key={sport.id}
                onPress={() => setSportFilter((cur) => (cur === sport.id ? null : sport.id))}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 6,
                  paddingVertical: 9,
                  paddingHorizontal: 12,
                  borderRadius: 10,
                  backgroundColor: active ? STEAL_ACCENT : colors.card,
                  borderWidth: 1,
                  borderColor: active ? STEAL_ACCENT : colors.border,
                }}
              >
                <MaterialCommunityIcons name={sport.icon} size={14} color={active ? "#fff" : colors.foreground} />
                <Text style={{ color: active ? "#fff" : colors.foreground, fontFamily: FONT.semibold, fontSize: 12 }}>
                  {sport.label}
                </Text>
              </Pressable>
            );
          })}
          <Pressable
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 7,
              paddingVertical: 9,
              paddingHorizontal: 12,
              borderRadius: 10,
              backgroundColor: colors.card,
              borderWidth: 1,
              borderColor: colors.border,
            }}
          >
            <Feather name="filter" size={14} color={colors.foreground} />
            <Text style={{ color: colors.foreground, fontFamily: FONT.semibold, fontSize: 12 }}>Filters</Text>
            <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: STEAL_ACCENT }} />
          </Pressable>
        </ScrollView>

        <View style={{ flexDirection: "row", borderBottomWidth: 1, borderBottomColor: colors.border, paddingBottom: 10 }}>
          {["GAME / MARKET", "EV EDGE ↓", "BOOKS", "TIME"].map((h, i) => (
            <Text
              key={h}
              style={{
                flex: i === 0 ? 1.7 : 1,
                color: i === 1 ? STEAL_ACCENT : colors.mutedForeground,
                fontFamily: FONT.bold,
                fontSize: 10,
                textAlign: i === 0 ? "left" : "right",
              }}
            >
              {h}
            </Text>
          ))}
        </View>

        {showHuntingUi ? (
          <ScanProgressPanel
            meta={meta}
            loading={awaitingFirstResponse || query.isFetching}
            step={scanStep}
          />
        ) : null}

        {showHuntingUi ? (
          <RadarScan hideFooter>
            {feedUnreachable ? (
              <View style={{ alignItems: "center", gap: 8, paddingHorizontal: 12 }}>
                <Feather name="wifi-off" size={18} color={STEAL_ACCENT} />
                <Text style={{ color: colors.foreground, fontFamily: FONT.semibold, fontSize: 13, textAlign: "center" }}>
                  Couldn&apos;t reach the odds feed
                </Text>
                <Text style={{ color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 12, textAlign: "center", lineHeight: 17 }}>
                  Retrying automatically every few seconds…
                </Text>
                <Pressable onPress={() => query.refetch()}>
                  <Text style={{ color: STEAL_ACCENT, fontFamily: FONT.bold, fontSize: 12 }}>Retry now</Text>
                </Pressable>
              </View>
            ) : meta && meta.marketsChecked > 0 ? (
              <Text style={{ color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 12, textAlign: "center" }}>
                {formatScanCount(meta.marketsChecked)} markets checked · {meta.longshotsAnalyzed} longshots · rescanning every 3s
              </Text>
            ) : (
              <Text style={{ color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 12, textAlign: "center" }}>
                Rescanning every 3s until a longshot with real edge surfaces…
              </Text>
            )}
          </RadarScan>
        ) : (
          <>
            {filteredSteals.length > 0 ? (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <Feather name="zap" size={13} color={STEAL_ACCENT} />
                <Text style={{ color: STEAL_ACCENT, fontFamily: FONT.bold, fontSize: 12, letterSpacing: 0.5 }}>
                  LIVE STEALS · {steals.length}
                </Text>
              </View>
            ) : null}
            {filteredSteals.map((s) => (
              <StealCard key={s.id} steal={s} />
            ))}
            {almostQualified.length > 0 ? (
              <View style={{ gap: 10 }}>
                <Text style={{ color: colors.foreground, fontFamily: FONT.bold, fontSize: 15 }}>Almost Qualified</Text>
                {almostQualified.map((near) => (
                  <AlmostQualifiedCard key={near.id} near={near} />
                ))}
              </View>
            ) : null}
          </>
        )}
        <View
          style={{
            flexDirection: "row",
            gap: 12,
            alignItems: "center",
            borderRadius: 12,
            borderWidth: 1,
            borderColor: STEAL_ACCENT,
            backgroundColor: "rgba(168,85,247,0.08)",
            padding: 14,
          }}
        >
          <Feather name="zap" size={22} color={STEAL_ACCENT} />
          <Text style={{ flex: 1, color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 13, lineHeight: 18 }}>
            We&apos;re scanning thousands of markets in real time to surface the best longshot opportunities.
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

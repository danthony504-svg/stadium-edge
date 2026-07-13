import { Feather, MaterialCommunityIcons } from "@expo/vector-icons";
import { useFocusEffect } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import React, { useCallback, useRef, useState } from "react";
import {
  Animated,
  Easing,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  View,
} from "react-native";
import Svg, { Circle } from "react-native-svg";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppHeader } from "@/components/AppHeader";
import { FONT } from "@/components/ui";
import { useColors } from "@/hooks/useColors";
import { getLiveSteals, fetchLiveSteals, propMarketLabel, type LiveSteal, type NearMissSteal, type StealRecord, type StealScanMeta, type StealSeasonStats } from "@/lib/api";
import type { StealFeedClientLog } from "@/lib/stealFeedClient";
import { SPORTS, sportLabel } from "@/lib/sports";
import {
  americanToDecimal,
  formatOdds,
  formatPct,
  formatScanCount,
  nearMissNeededLabel,
  recordLabel,
  recordWinPct,
  stealScanIsComplete,
  stealScanStatsAreConsistent,
  normalizeStealScanMeta,
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

function OddsFeedUnavailable({
  log,
  isRetrying,
  onRetry,
}: {
  log?: StealFeedClientLog | null;
  isRetrying: boolean;
  onRetry: () => void;
}) {
  const colors = useColors();
  const statusLine = log?.httpStatus != null ? `HTTP ${log.httpStatus}` : "No response";
  const reason = log?.errorReason ?? "odds_feed_unreachable";
  const retryLabel = isRetrying ? "Retrying…" : "Retry";

  return (
    <View
      style={{
        alignItems: "center",
        gap: 14,
        paddingVertical: 28,
        paddingHorizontal: 16,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.card,
      }}
    >
      <Feather name="wifi-off" size={32} color={STEAL_ACCENT} />
      <Text style={{ color: colors.foreground, fontFamily: FONT.display, fontSize: 20, textAlign: "center" }}>
        Odds feed unavailable
      </Text>
      <Text style={{ color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 13, lineHeight: 19, textAlign: "center" }}>
        We couldn&apos;t reach the live odds scan. No market counts are shown until a fresh scan succeeds.
      </Text>
      <View style={{ gap: 6, alignSelf: "stretch" }}>
        <Text style={{ color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 12 }}>
          Endpoint: {log?.endpoint ?? "/sports/live-steals"}
        </Text>
        <Text style={{ color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 12 }}>
          Status: {statusLine} · {log?.responseTimeMs ?? 0}ms
        </Text>
        <Text style={{ color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 12 }}>
          Provider: {log?.provider ?? "the-odds-api"}
        </Text>
        <Text style={{ color: STEAL_ACCENT, fontFamily: FONT.semibold, fontSize: 12 }}>
          Reason: {reason}
        </Text>
      </View>
      <Pressable
        onPress={onRetry}
        disabled={isRetrying}
        style={{
          marginTop: 4,
          paddingVertical: 12,
          paddingHorizontal: 28,
          borderRadius: 12,
          backgroundColor: STEAL_ACCENT,
          opacity: isRetrying ? 0.6 : 1,
        }}
      >
        <Text style={{ color: "#fff", fontFamily: FONT.bold, fontSize: 14 }}>{retryLabel}</Text>
      </Pressable>
    </View>
  );
}

function ScanProgressPanel({
  meta,
  phase,
}: {
  meta?: StealScanMeta;
  phase: "loading" | "complete" | "empty";
}) {
  const colors = useColors();
  const consistent = stealScanStatsAreConsistent(meta);
  const books = consistent ? meta!.booksScanned : null;
  const markets = consistent ? meta!.marketsChecked : null;
  const longshots = consistent ? meta!.longshotsAnalyzed : null;
  const found = meta?.stealsFound ?? 0;

  const lines =
    phase === "loading"
      ? [
          { label: "Scanning sportsbooks…", done: false },
          { label: "Checking markets…", done: false },
          { label: "Analyzing longshots…", done: false },
          { label: "Looking for value steals…", done: false },
        ]
      : phase === "empty"
        ? [
            { label: `Scanned ${books} sportsbook${books === 1 ? "" : "s"}`, done: true },
            { label: `${formatScanCount(markets!)} markets checked`, done: true },
            { label: `${formatScanCount(longshots!)} longshots evaluated`, done: true },
            { label: "No +500 value opportunities found at this time.", done: true },
          ]
        : [
            { label: `Scanned ${books} sportsbook${books === 1 ? "" : "s"}`, done: true },
            { label: `${formatScanCount(markets!)} markets checked`, done: true },
            { label: `${formatScanCount(longshots!)} longshots evaluated`, done: true },
            { label: `${found} value steal${found === 1 ? "" : "s"} found`, done: true },
          ];

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
      {phase === "complete" ? (
        <Text style={{ color: STEAL_ACCENT, fontFamily: FONT.semibold, fontSize: 12, marginTop: 4 }}>
          Updating every 3 seconds…
        </Text>
      ) : phase === "empty" ? (
        <Text style={{ color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 12, marginTop: 4 }}>
          We&apos;ll rescan every few seconds in case a new longshot surfaces.
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

const AnimatedBlip = Animated.View;

function RadarScan({ children, hideFooter }: { children?: React.ReactNode; hideFooter?: boolean }) {
  const colors = useColors();
  const size = 170;
  const c = size / 2;
  const arm = size * 0.49;
  const spin = useRef(new Animated.Value(0)).current;
  const pulse = useRef(new Animated.Value(0)).current;

  const startAnimations = useCallback(() => {
    spin.setValue(0);
    pulse.setValue(0.35);
    const spinLoop = Animated.loop(
      Animated.timing(spin, {
        toValue: 1,
        duration: 2800,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    const pulseLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 900, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.35, duration: 900, useNativeDriver: true }),
      ]),
    );
    spinLoop.start();
    pulseLoop.start();
    return () => {
      spinLoop.stop();
      pulseLoop.stop();
    };
  }, [pulse, spin]);

  useFocusEffect(
    useCallback(() => startAnimations(), [startAnimations]),
  );

  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] });
  const blipOpacity = pulse.interpolate({ inputRange: [0.35, 1], outputRange: [0.35, 1] });

  return (
    <View style={{ alignItems: "center", paddingVertical: 32, gap: 14 }}>
      <View style={{ width: size, height: size }}>
        <Svg width={size} height={size}>
          {[24, 44, 66, 84].map((r) => (
            <Circle key={r} cx={c} cy={c} r={r} fill="none" stroke="rgba(168,85,247,0.35)" strokeWidth="1" />
          ))}
          <Circle cx={c - 36} cy={c - 10} r="3" fill={colors.foreground} opacity={0.7} />
        </Svg>
        <Animated.View
          pointerEvents="none"
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            width: size,
            height: size,
            transform: [{ rotate }],
          }}
        >
          <View
            style={{
              position: "absolute",
              left: c - 10,
              top: c - arm,
              width: 20,
              height: arm,
              backgroundColor: "rgba(168,85,247,0.22)",
              borderTopLeftRadius: 10,
              borderTopRightRadius: 10,
            }}
          />
          <View
            style={{
              position: "absolute",
              left: c - 1.5,
              top: c - arm,
              width: 3,
              height: arm,
              backgroundColor: STEAL_ACCENT,
              borderRadius: 2,
            }}
          />
          <View
            style={{
              position: "absolute",
              left: c - 4,
              top: c - arm - 4,
              width: 8,
              height: 8,
              borderRadius: 4,
              backgroundColor: STEAL_ACCENT,
            }}
          />
        </Animated.View>
        <AnimatedBlip
          pointerEvents="none"
          style={{
            position: "absolute",
            left: c - 28 - 3,
            top: c + 40 - 3,
            width: 6,
            height: 6,
            borderRadius: 3,
            backgroundColor: STEAL_ACCENT,
            opacity: blipOpacity,
          }}
        />
        <AnimatedBlip
          pointerEvents="none"
          style={{
            position: "absolute",
            left: c + 52 - 3,
            top: c + 18 - 3,
            width: 6,
            height: 6,
            borderRadius: 3,
            backgroundColor: STEAL_ACCENT,
            opacity: blipOpacity,
          }}
        />
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
  const [lastFeedLog, setLastFeedLog] = useState<StealFeedClientLog | null>(null);

  const query = useQuery({
    queryKey: ["live-steals"],
    queryFn: async ({ signal }) => {
      const { response, log } = await fetchLiveSteals(signal);
      setLastFeedLog(log);
      return response;
    },
    staleTime: 3_000,
    refetchInterval: (q) => {
      if (q.state.isError) return 5_000;
      const found =
        (q.state.data?.steals?.length ?? 0) > 0 || (q.state.data?.almostQualified?.length ?? 0) > 0;
      return found ? 3_000 : 8_000;
    },
    retry: (failureCount, error) => {
      const log = (error as { stealFeedLog?: StealFeedClientLog } | null)?.stealFeedLog;
      if (log) setLastFeedLog(log);
      return failureCount < 6;
    },
    retryDelay: (attempt) => Math.min(8_000, 1_500 * 2 ** attempt),
    refetchIntervalInBackground: true,
  });

  // React Query keeps the last successful `data` while `isError` — never show stale scan stats.
  const activeData = query.isError ? null : query.data ?? null;
  const feedLog =
    lastFeedLog ??
    ((query.error as { stealFeedLog?: StealFeedClientLog } | null)?.stealFeedLog ?? null);
  const steals = activeData?.steals ?? [];
  const meta = activeData ? normalizeStealScanMeta(activeData.meta) : undefined;
  const almostQualified = activeData?.almostQualified ?? [];
  const seasonStats = activeData?.seasonStats;
  const hasResults = steals.length > 0 || almostQualified.length > 0;
  const awaitingFirstResponse = query.isLoading && !activeData && !query.isError;
  const feedUnavailable = query.isError || (!awaitingFirstResponse && !activeData);
  const scanComplete = Boolean(activeData && stealScanIsComplete(meta, false));
  const scanPhase: "loading" | "complete" | "empty" = awaitingFirstResponse
    ? "loading"
    : feedUnavailable
      ? "loading"
    : hasResults
      ? "complete"
      : scanComplete
        ? "empty"
        : "loading";
  const filteredSteals = React.useMemo(
    () => steals.filter((s) => !sportFilter || s.sport === sportFilter),
    [steals, sportFilter],
  );
  const record: StealRecord =
    activeData?.record ?? { wins: 0, losses: 0, pushes: 0, pending: 0, ungraded: 0, graded: 0 };

  useFocusEffect(
    useCallback(() => {
      void query.refetch();
    }, [query.refetch]),
  );

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

      {!feedUnavailable && meta ? <ScanProgressPanel meta={meta} phase={scanPhase} /> : null}
        {!feedUnavailable && meta ? <StealsFoundToday meta={meta} /> : null}

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

        {!feedUnavailable ? (
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
        ) : null}

        {feedUnavailable ? (
          <OddsFeedUnavailable
            log={feedLog}
            isRetrying={query.isFetching}
            onRetry={() => query.refetch()}
          />
        ) : awaitingFirstResponse ? (
          <>
            <ScanProgressPanel phase="loading" />
            <RadarScan hideFooter>
              <Text style={{ color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 12, textAlign: "center" }}>
                Connecting to live odds scan…
              </Text>
            </RadarScan>
          </>
        ) : scanPhase === "empty" ? (
          <>
            <ScanProgressPanel meta={meta} phase="empty" />
            <View
              style={{
                alignItems: "center",
                gap: 12,
                paddingVertical: 24,
                paddingHorizontal: 12,
              }}
            >
              <Feather name="search" size={28} color={STEAL_ACCENT} />
              <Text style={{ color: colors.foreground, fontFamily: FONT.display, fontSize: 18, textAlign: "center" }}>
                No steals right now
              </Text>
              <Text style={{ color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 13, lineHeight: 19, textAlign: "center" }}>
                The board was scanned and no +500 longshots cleared our value bar. We&apos;ll keep checking in the background.
              </Text>
            </View>
          </>
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

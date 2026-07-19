import { Feather, MaterialCommunityIcons } from "@expo/vector-icons";
import { useFocusEffect } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import {
  fetchLiveSteals,
  propMarketLabel,
  type GradedSteal,
  type LiveSteal,
  type NearMissSteal,
  type StealRecord,
  type StealScanMeta,
  type StealSeasonStats,
} from "@/lib/api";
import type { StealFeedClientLog } from "@/lib/stealFeedClient";
import { logStealScanLifecycle } from "@/lib/stealScanLifecycle";
import {
  initialStealProgress,
  mergeStealProgress,
  stealProgressChecklist,
  stealProgressFromElapsedMs,
  stealProgressFromLiveScan,
  STEAL_SCAN_TIMEOUT_MS,
  type StealCanonicalProgress,
  type StealServerStageName,
} from "@/lib/stealProgressState";
import {
  logStealServerStageTimings,
  stealClientStageTimeoutPatch,
  stealServerStageLabel,
} from "@/lib/stealStageTiming";
import { SPORTS, sportLabel } from "@/lib/sports";
import {
  americanToDecimal,
  formatCountdownSeconds,
  formatLastScanTime,
  formatOdds,
  formatPct,
  formatScanCount,
  gamesScannedFromFeedProbes,
  nearMissNeededLabel,
  recordLabel,
  stealScanIsComplete,
  stealScanStatsAreConsistent,
  trackRecordStatsFromHistory,
  normalizeStealScanMeta,
} from "@/lib/steals";

const STEAL_ACCENT = "#a855f7";
const STEAL_SPORTS = ["nba", "mlb", "nhl", "soccer"];
const REFETCH_WITH_RESULTS_MS = 3_000;
const REFETCH_EMPTY_MS = 8_000;

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
  history,
}: {
  record: StealRecord;
  seasonStats?: StealSeasonStats;
  history: GradedSteal[];
}) {
  const colors = useColors();
  const hasSettled = record.graded > 0;
  const derived = useMemo(() => trackRecordStatsFromHistory(history), [history]);
  const roiPct = seasonStats?.roiPct ?? derived.roiPct;
  const avgOdds = seasonStats?.avgOdds ?? derived.avgOdds;

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
          {hasSettled ? "Track Record" : "Steal track record"}
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
                Record (W–L{record.pushes > 0 ? "–Push" : ""})
              </Text>
            </View>
            {roiPct != null ? (
              <View>
                <Text style={{ color: roiPct >= 0 ? "#22c55e" : "#ef4444", fontFamily: FONT.bold, fontSize: 22 }}>
                  {roiPct > 0 ? "+" : ""}
                  {roiPct}%
                </Text>
                <Text style={{ color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 11 }}>ROI</Text>
              </View>
            ) : null}
            <View>
              <Text style={{ color: "#22c55e", fontFamily: FONT.bold, fontSize: 22 }}>
                +{derived.unitsWon}
              </Text>
              <Text style={{ color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 11 }}>
                Units won
              </Text>
            </View>
            <View>
              <Text style={{ color: "#ef4444", fontFamily: FONT.bold, fontSize: 22 }}>
                -{derived.unitsLost}
              </Text>
              <Text style={{ color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 11 }}>
                Units lost
              </Text>
            </View>
            {avgOdds != null ? (
              <View>
                <Text style={{ color: colors.foreground, fontFamily: FONT.bold, fontSize: 22 }}>
                  {formatOdds(avgOdds)}
                </Text>
                <Text style={{ color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 11 }}>
                  Avg odds
                </Text>
              </View>
            ) : null}
          </View>
          {derived.highestWinPick ? (
            <View
              style={{
                borderRadius: 12,
                borderWidth: 1,
                borderColor: colors.border,
                backgroundColor: colors.background,
                padding: 12,
                gap: 4,
              }}
            >
              <Text style={{ color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 11 }}>
                Highest winning pick
              </Text>
              <Text style={{ color: colors.foreground, fontFamily: FONT.bold, fontSize: 14 }}>
                {derived.highestWinPick.label} · {formatOdds(derived.highestWinPick.price)}
              </Text>
            </View>
          ) : null}
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
          No steals have settled yet. Every pick below is logged and auto-graded against the real result — the
          record fills in as games finish.
        </Text>
      )}

      <View style={{ height: 1, backgroundColor: colors.border }} />
      <View style={{ flexDirection: "row", gap: 10 }}>
        <Feather name="shield" size={17} color={STEAL_ACCENT} />
        <View style={{ flex: 1 }}>
          <Text style={{ color: colors.foreground, fontFamily: FONT.bold, fontSize: 13 }}>100% transparent</Text>
          <Text
            style={{
              color: colors.mutedForeground,
              fontFamily: FONT.body,
              fontSize: 12,
              lineHeight: 17,
              marginTop: 4,
            }}
          >
            These are the app&apos;s own flagged longshots, graded against real game results — not your personal
            bets.
          </Text>
        </View>
      </View>
    </View>
  );
}

function ScanStatsRow({
  books,
  games,
  markets,
  lastScanAt,
}: {
  books: number | null;
  games: number | null;
  markets: number | null;
  lastScanAt: string | number | null | undefined;
}) {
  const colors = useColors();
  const items = [
    { label: "Sportsbooks scanned", value: books != null ? formatScanCount(books) : "—" },
    { label: "Games scanned", value: games != null ? formatScanCount(games) : "—" },
    { label: "Markets scanned", value: markets != null ? formatScanCount(markets) : "—" },
    { label: "Last scan", value: formatLastScanTime(lastScanAt) },
  ];
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
      {items.map((item) => (
        <View
          key={item.label}
          style={{
            flexGrow: 1,
            minWidth: "45%",
            borderRadius: 10,
            borderWidth: 1,
            borderColor: colors.border,
            backgroundColor: colors.background,
            paddingHorizontal: 10,
            paddingVertical: 8,
          }}
        >
          <Text style={{ color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 10 }}>{item.label}</Text>
          <Text style={{ color: colors.foreground, fontFamily: FONT.bold, fontSize: 13, marginTop: 2 }}>
            {item.value}
          </Text>
        </View>
      ))}
    </View>
  );
}

function StealScanProgressCard({
  progress,
  meta,
  lastScanAt,
  gamesFallback,
}: {
  progress: StealCanonicalProgress;
  meta?: StealScanMeta;
  lastScanAt: string | number | null | undefined;
  gamesFallback: number;
}) {
  const colors = useColors();
  const checklist = stealProgressChecklist(progress);
  const consistent = stealScanStatsAreConsistent(meta);
  const books = consistent ? meta!.booksScanned : progress.booksConnected || null;
  const games = consistent ? meta?.gamesScanned ?? gamesFallback : progress.gamesLoaded || null;
  const markets = consistent ? meta!.marketsChecked : null;

  return (
    <View
      style={{
        backgroundColor: colors.card,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: "rgba(168,85,247,0.35)",
        padding: 16,
        gap: 14,
      }}
    >
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <Text style={{ color: colors.foreground, fontFamily: FONT.bold, fontSize: 15 }}>Live scan</Text>
        <Text style={{ color: STEAL_ACCENT, fontFamily: FONT.bold, fontSize: 13 }}>
          Step {progress.stepIndex} of {progress.totalSteps}
        </Text>
      </View>

      <View style={{ gap: 6 }}>
        <View
          style={{
            height: 8,
            borderRadius: 999,
            backgroundColor: colors.border,
            overflow: "hidden",
          }}
        >
          <View
            style={{
              height: "100%",
              width: `${Math.min(100, Math.max(0, progress.percent))}%`,
              borderRadius: 999,
              backgroundColor: STEAL_ACCENT,
            }}
          />
        </View>
        <Text style={{ color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 12 }}>
          {Math.round(progress.percent)}% complete
        </Text>
      </View>

      <View style={{ gap: 8 }}>
        {checklist.map((row) => (
          <View key={row.label} style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Text
              style={{
                color: row.done ? "#22c55e" : row.active ? STEAL_ACCENT : colors.mutedForeground,
                fontFamily: FONT.bold,
                fontSize: 13,
              }}
            >
              {row.done ? "✔" : row.active ? "●" : "○"}
            </Text>
            <Text
              style={{
                color: row.done || row.active ? colors.foreground : colors.mutedForeground,
                fontFamily: row.active ? FONT.semibold : FONT.medium,
                fontSize: 13,
              }}
            >
              {row.label}
            </Text>
          </View>
        ))}
      </View>

      <ScanStatsRow books={books} games={games} markets={markets} lastScanAt={lastScanAt} />
    </View>
  );
}

function StealScanTimeoutCard({
  onRetry,
  isRetrying,
  stalledStage,
}: {
  onRetry: () => void;
  isRetrying: boolean;
  stalledStage?: StealServerStageName;
}) {
  const colors = useColors();
  const stageHint = stalledStage
    ? `Timed out during ${stealServerStageLabel(stalledStage)} (10s limit). Showing partial results or retry.`
    : "Still scanning sportsbooks… this is taking longer than expected.";
  return (
    <View
      style={{
        backgroundColor: colors.card,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: STEAL_ACCENT,
        padding: 16,
        gap: 12,
        alignItems: "center",
      }}
    >
      <Feather name="clock" size={28} color={STEAL_ACCENT} />
      <Text style={{ color: colors.foreground, fontFamily: FONT.display, fontSize: 17, textAlign: "center" }}>
        {stageHint}
      </Text>
      <Pressable
        onPress={onRetry}
        disabled={isRetrying}
        style={{
          paddingVertical: 12,
          paddingHorizontal: 28,
          borderRadius: 12,
          backgroundColor: STEAL_ACCENT,
          opacity: isRetrying ? 0.6 : 1,
        }}
      >
        <Text style={{ color: "#fff", fontFamily: FONT.bold, fontSize: 14 }}>
          {isRetrying ? "Retrying…" : "Retry"}
        </Text>
      </Pressable>
    </View>
  );
}

function StealEmptyState({
  lastScanAt,
  nextScanCountdown,
}: {
  lastScanAt: string | number | null | undefined;
  nextScanCountdown: string;
}) {
  const colors = useColors();
  return (
    <View
      style={{
        alignItems: "center",
        gap: 14,
        paddingVertical: 24,
        paddingHorizontal: 12,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.card,
      }}
    >
      <Feather name="search" size={30} color={STEAL_ACCENT} />
      <Text style={{ color: colors.foreground, fontFamily: FONT.display, fontSize: 18, textAlign: "center" }}>
        No +500 positive EV opportunities are available right now.
      </Text>
      <Text
        style={{
          color: colors.mutedForeground,
          fontFamily: FONT.medium,
          fontSize: 13,
          lineHeight: 20,
          textAlign: "center",
        }}
      >
        The AI continuously scans all sportsbooks and will automatically update this page when a qualifying edge
        appears.
      </Text>
      <View style={{ alignSelf: "stretch", gap: 6 }}>
        <Text style={{ color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 12 }}>
          Last scan: {formatLastScanTime(lastScanAt)}
        </Text>
        <Text style={{ color: STEAL_ACCENT, fontFamily: FONT.semibold, fontSize: 12 }}>
          Next automatic scan in {nextScanCountdown}
        </Text>
        <Text style={{ color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 11, marginTop: 4 }}>
          Pull down to refresh now
        </Text>
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
      <Text
        style={{
          color: colors.mutedForeground,
          fontFamily: FONT.medium,
          fontSize: 13,
          lineHeight: 19,
          textAlign: "center",
        }}
      >
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
        <Text style={{ color: STEAL_ACCENT, fontFamily: FONT.semibold, fontSize: 12 }}>Reason: {reason}</Text>
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

function RadarScan() {
  const colors = useColors();
  const size = 120;
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

  useFocusEffect(useCallback(() => startAnimations(), [startAnimations]));

  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] });
  const blipOpacity = pulse.interpolate({ inputRange: [0.35, 1], outputRange: [0.35, 1] });

  return (
    <View style={{ alignItems: "center", paddingVertical: 12 }}>
      <View style={{ width: size, height: size }}>
        <Svg width={size} height={size}>
          {[18, 32, 48, 60].map((r) => (
            <Circle key={r} cx={c} cy={c} r={r} fill="none" stroke="rgba(168,85,247,0.35)" strokeWidth="1" />
          ))}
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
              left: c - 1.5,
              top: c - arm,
              width: 3,
              height: arm,
              backgroundColor: STEAL_ACCENT,
              borderRadius: 2,
            }}
          />
        </Animated.View>
        <AnimatedBlip
          pointerEvents="none"
          style={{
            position: "absolute",
            left: c - 20,
            top: c + 28,
            width: 6,
            height: 6,
            borderRadius: 3,
            backgroundColor: STEAL_ACCENT,
            opacity: blipOpacity,
          }}
        />
      </View>
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
          <Text style={{ color: STEAL_ACCENT, fontFamily: FONT.bold, fontSize: 18 }}>{formatOdds(steal.price)}</Text>
          <Text style={{ color: STEAL_ACCENT, fontFamily: FONT.semibold, fontSize: 8, letterSpacing: 0.5 }}>
            LONGSHOT
          </Text>
        </View>
      </View>

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
            <Text style={{ color: colors.foreground, fontFamily: FONT.bold, fontSize: 15 }}>{formatPct(steal.edge)}</Text>
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
  const [nowTick, setNowTick] = useState(() => Date.now());
  const [scanStartedAt, setScanStartedAt] = useState<number | null>(null);
  const [scanTimedOut, setScanTimedOut] = useState(false);
  const [scanProgress, setScanProgress] = useState<StealCanonicalProgress | null>(null);
  const scanIdRef = useRef(`scan-${Date.now()}`);
  const scanInFlightRef = useRef(false);
  const stageEnteredAtRef = useRef(Date.now());
  const lastLoggedStageTimingsRef = useRef<string | null>(null);

  const query = useQuery({
    queryKey: ["live-steals"],
    queryFn: async ({ signal }) => {
      scanInFlightRef.current = true;
      const { response, log } = await fetchLiveSteals(signal);
      setLastFeedLog(log);
      return response;
    },
    staleTime: 3_000,
    refetchInterval: (q) => {
      if (q.state.error) return 5_000;
      const found =
        (q.state.data?.steals?.length ?? 0) > 0 || (q.state.data?.almostQualified?.length ?? 0) > 0;
      return found ? REFETCH_WITH_RESULTS_MS : REFETCH_EMPTY_MS;
    },
    retry: (failureCount, error) => {
      const log = (error as { stealFeedLog?: StealFeedClientLog } | null)?.stealFeedLog;
      if (log) setLastFeedLog(log);
      return failureCount < 2;
    },
    retryDelay: (attempt) => Math.min(4_000, 1_000 * 2 ** attempt),
    refetchIntervalInBackground: true,
  });

  useEffect(() => {
    if (!query.isFetching) scanInFlightRef.current = false;
  }, [query.isFetching]);

  const activeData = query.isError ? null : (query.data ?? null);
  const feedLog =
    lastFeedLog ?? ((query.error as { stealFeedLog?: StealFeedClientLog } | null)?.stealFeedLog ?? null);
  const steals = activeData?.steals ?? [];
  const meta = activeData ? normalizeStealScanMeta(activeData.meta) : undefined;
  const almostQualified = activeData?.almostQualified ?? [];
  const seasonStats = activeData?.seasonStats;
  const history = activeData?.history ?? [];
  const hasPicks = steals.length > 0;
  const awaitingFirstResponse = query.isLoading && !activeData && !query.isError;
  const feedUnavailable = query.isError;
  const scanComplete = Boolean(activeData && stealScanIsComplete(meta, activeData.feedDegraded));
  const gamesFallback = gamesScannedFromFeedProbes(feedLog?.sportProbes);
  const lastScanAt =
    meta?.scannedAt && Date.parse(meta.scannedAt) > 0
      ? meta.scannedAt
      : query.dataUpdatedAt > 0
        ? query.dataUpdatedAt
        : null;
  const refetchIntervalMs = hasPicks || almostQualified.length > 0 ? REFETCH_WITH_RESULTS_MS : REFETCH_EMPTY_MS;
  const nextScanAt = (typeof lastScanAt === "number" ? lastScanAt : Date.parse(String(lastScanAt))) + refetchIntervalMs;
  const nextScanCountdown = formatCountdownSeconds((nextScanAt - nowTick) / 1000);

  const showBlockingScan =
    !feedUnavailable && !hasPicks && !scanComplete && query.isFetching && !scanTimedOut;
  const showTimeout =
    !feedUnavailable && !hasPicks && !scanComplete && scanTimedOut && (query.isFetching || awaitingFirstResponse);
  const showEmpty = !feedUnavailable && !hasPicks && scanComplete;

  const filteredSteals = useMemo(
    () => steals.filter((s) => !sportFilter || s.sport === sportFilter),
    [steals, sportFilter],
  );
  const record: StealRecord =
    activeData?.record ?? { wins: 0, losses: 0, pushes: 0, pending: 0, ungraded: 0, graded: 0 };

  const beginScan = useCallback(() => {
    scanIdRef.current = `scan-${Date.now()}`;
    stageEnteredAtRef.current = Date.now();
    lastLoggedStageTimingsRef.current = null;
    setScanProgress(initialStealProgress(scanIdRef.current));
    setScanStartedAt(Date.now());
    setScanTimedOut(false);
  }, []);

  const handleRefresh = useCallback(() => {
    if (query.isFetching || scanInFlightRef.current) return;
    beginScan();
    void query.refetch();
  }, [beginScan, query]);

  const handleRetry = useCallback(() => {
    if (query.isFetching || scanInFlightRef.current) return;
    beginScan();
    void query.refetch();
  }, [beginScan, query]);

  useFocusEffect(
    useCallback(() => {
      if (query.isFetching || scanInFlightRef.current) return;
      beginScan();
      void query.refetch();
    }, [beginScan, query.isFetching, query.refetch]),
  );

  useEffect(() => {
    if (query.isFetching && !hasPicks && !scanComplete && scanStartedAt == null) {
      beginScan();
    }
  }, [beginScan, hasPicks, query.isFetching, scanComplete, scanStartedAt]);

  useEffect(() => {
    if (!scanStartedAt || hasPicks || scanComplete) {
      if (hasPicks || scanComplete) {
        setScanTimedOut(false);
        setScanStartedAt(null);
      }
      return;
    }
    const elapsed = Date.now() - scanStartedAt;
    if (elapsed >= STEAL_SCAN_TIMEOUT_MS) {
      setScanTimedOut(true);
      return;
    }
    const timer = setTimeout(() => setScanTimedOut(true), STEAL_SCAN_TIMEOUT_MS - elapsed);
    return () => clearTimeout(timer);
  }, [hasPicks, scanComplete, scanStartedAt]);

  useEffect(() => {
    if (meta?.stageTimings?.length) {
      const key = JSON.stringify(meta.stageTimings);
      if (lastLoggedStageTimingsRef.current !== key) {
        lastLoggedStageTimingsRef.current = key;
        logStealServerStageTimings(
          scanIdRef.current,
          meta.stageTimings as import("@/lib/stealStageTiming").StealServerStageTiming[],
          meta.stalledStage as StealServerStageName | undefined,
        );
      }
    }
  }, [meta?.stageTimings, meta?.stalledStage]);

  useEffect(() => {
    if (hasPicks || scanComplete || feedUnavailable) {
      if (hasPicks || scanComplete) {
        setScanProgress((prev) => {
          const merged = mergeStealProgress(prev ?? initialStealProgress(scanIdRef.current), {
            scanId: scanIdRef.current,
            stage: "ranking",
            percent: 100,
            terminal: true,
            booksConnected: meta?.booksScanned ?? 0,
            gamesLoaded: meta?.gamesScanned ?? gamesFallback,
            propsLoaded: meta?.longshotsAnalyzed ?? 0,
          });
          return merged ?? prev;
        });
      }
      return;
    }
    if (!showBlockingScan && !showTimeout) return;

    const tick = () => {
      const nowMs = Date.now();
      setNowTick(nowMs);
      const elapsed = scanStartedAt ? nowMs - scanStartedAt : 0;
      setScanProgress((prev) => {
        let next = prev ?? initialStealProgress(scanIdRef.current);
        const timeoutPatch = stealClientStageTimeoutPatch(
          scanIdRef.current,
          next.stage,
          stageEnteredAtRef.current,
          nowMs,
        );
        if (timeoutPatch) {
          setScanTimedOut(true);
          const merged = mergeStealProgress(next, {
            ...timeoutPatch,
            stalledStage: timeoutPatch.stalledStage,
          });
          return merged ?? next;
        }
        const elapsedPatch = stealProgressFromElapsedMs(scanIdRef.current, elapsed, next.stage);
        const elapsedMerged = mergeStealProgress(next, elapsedPatch);
        if (elapsedMerged) {
          if (elapsedMerged.stage !== next.stage) {
            stageEnteredAtRef.current = nowMs;
          }
          next = elapsedMerged;
        }
        if (meta) {
          const livePatch = stealProgressFromLiveScan(scanIdRef.current, {
            booksScanned: meta.booksScanned,
            gamesScanned: meta.gamesScanned ?? gamesFallback,
            marketsChecked: meta.marketsChecked,
            longshotsAnalyzed: meta.longshotsAnalyzed,
            scanComplete: meta.scanComplete,
            stealsFound: meta.stealsFound,
          });
          const liveMerged = mergeStealProgress(next, livePatch);
          if (liveMerged) {
            if (liveMerged.stage !== next.stage) {
              stageEnteredAtRef.current = nowMs;
            }
            next = liveMerged;
          }
        }
        return next;
      });
    };

    tick();
    const interval = setInterval(tick, 300);
    return () => clearInterval(interval);
  }, [
    feedUnavailable,
    gamesFallback,
    hasPicks,
    meta,
    scanComplete,
    scanStartedAt,
    showBlockingScan,
    showTimeout,
  ]);

  useEffect(() => {
    const interval = setInterval(() => setNowTick(Date.now()), 1_000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    logStealScanLifecycle({
      stage: "ui_state",
      endpoint: feedLog?.endpoint ?? "/sports/live-steals",
      httpStatus: feedLog?.httpStatus,
      responseTimeMs: feedLog?.responseTimeMs,
      scanComplete,
      booksScanned: meta?.booksScanned,
      marketsChecked: meta?.marketsChecked,
      longshotsAnalyzed: meta?.longshotsAnalyzed,
      stealsFound: meta?.stealsFound,
      feedDegraded: activeData?.feedDegraded,
      isScanning: showBlockingScan || showTimeout,
      isError: query.isError,
      detail: hasPicks ? "results" : showEmpty ? "empty" : showBlockingScan ? "loading" : showTimeout ? "timeout" : "idle",
    });
  }, [
    activeData?.feedDegraded,
    feedLog?.endpoint,
    feedLog?.httpStatus,
    feedLog?.responseTimeMs,
    hasPicks,
    meta?.booksScanned,
    meta?.longshotsAnalyzed,
    meta?.marketsChecked,
    meta?.stealsFound,
    query.isError,
    scanComplete,
    showBlockingScan,
    showEmpty,
    showTimeout,
  ]);

  const progress = scanProgress ?? initialStealProgress(scanIdRef.current);

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <AppHeader bottomGap={0}>
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 12,
            paddingHorizontal: 16,
            paddingBottom: 12,
            marginTop: 4,
          }}
        >
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
            <Text style={{ color: colors.foreground, fontFamily: FONT.display, fontSize: 24 }}>+500 Steals</Text>
            <Text
              style={{
                color: colors.mutedForeground,
                fontFamily: FONT.medium,
                fontSize: 13,
                marginTop: 4,
                lineHeight: 18,
              }}
            >
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
            refreshing={query.isFetching && !awaitingFirstResponse}
            onRefresh={handleRefresh}
            tintColor={colors.primary}
          />
        }
      >
        <SeasonRecordCard record={record} seasonStats={seasonStats} history={history} />

        {feedUnavailable ? (
          <OddsFeedUnavailable log={feedLog} isRetrying={query.isFetching} onRetry={handleRetry} />
        ) : showBlockingScan ? (
          <>
            <StealScanProgressCard
              progress={progress}
              meta={meta}
              lastScanAt={lastScanAt}
              gamesFallback={gamesFallback}
            />
            <RadarScan />
          </>
        ) : showTimeout ? (
          <>
            <StealScanProgressCard
              progress={progress}
              meta={meta}
              lastScanAt={lastScanAt}
              gamesFallback={gamesFallback}
            />
            <StealScanTimeoutCard
              onRetry={handleRetry}
              isRetrying={query.isFetching}
              stalledStage={progress.stalledStage ?? (meta?.stalledStage as StealServerStageName | undefined)}
            />
          </>
        ) : null}

        {!feedUnavailable && hasPicks && meta ? <StealsFoundToday meta={meta} /> : null}

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
            <MaterialCommunityIcons
              name="trophy-outline"
              size={14}
              color={sportFilter == null ? "#fff" : colors.foreground}
            />
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
        </ScrollView>

        {!feedUnavailable && hasPicks ? (
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

        {feedUnavailable ? null : showEmpty ? (
          <StealEmptyState lastScanAt={lastScanAt} nextScanCountdown={nextScanCountdown} />
        ) : hasPicks ? (
          <>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Feather name="zap" size={13} color={STEAL_ACCENT} />
              <Text style={{ color: STEAL_ACCENT, fontFamily: FONT.bold, fontSize: 12, letterSpacing: 0.5 }}>
                LIVE STEALS · {steals.length}
              </Text>
            </View>
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
        ) : scanComplete && almostQualified.length > 0 ? (
          <View style={{ gap: 10 }}>
            <Text style={{ color: colors.foreground, fontFamily: FONT.bold, fontSize: 15 }}>Almost Qualified</Text>
            {almostQualified.map((near) => (
              <AlmostQualifiedCard key={near.id} near={near} />
            ))}
          </View>
        ) : null}

        {!feedUnavailable && !showBlockingScan ? (
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
              {hasPicks
                ? "Live scan updates every few seconds while steals are on the board."
                : "We're scanning thousands of markets in real time to surface the best longshot opportunities."}
            </Text>
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

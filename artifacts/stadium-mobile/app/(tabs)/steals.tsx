/**
 * +500 Steals — rebuilt screen.
 *
 * Longshots (+500…+30000) that carry a REAL cross-book no-vig edge.
 * Empty boards are honest (main game lines rarely clear +500 with edge).
 * Track record = the app's own flagged picks, auto-graded vs real results.
 */
import Feather from "@expo/vector-icons/Feather";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { useFocusEffect } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import React, { useCallback, useMemo, useRef, useState } from "react";
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
import { PremiumFeatureGate } from "@/components/PremiumFeatureGate";
import { FONT } from "@/components/ui";
import { useColors } from "@/hooks/useColors";
import {
  fetchLiveSteals,
  propMarketLabel,
  type LiveSteal,
  type NearMissSteal,
  type StealRecord,
  type StealScanMeta,
  type StealSeasonStats,
} from "@/lib/api";
import type { StealFeedClientLog } from "@/lib/stealFeedClient";
import { SPORTS, sportLabel } from "@/lib/sports";
import {
  americanToDecimal,
  formatOdds,
  formatPct,
  formatScanCount,
  nearMissNeededLabel,
  normalizeStealScanMeta,
  recordLabel,
  recordWinPct,
  stealScanIsComplete,
  stealScanStatsAreConsistent,
} from "@/lib/steals";

const STEAL_ACCENT = "#a855f7";
const STEAL_SPORT_IDS = ["mlb", "nba", "nhl", "soccer"] as const;

type SortKey = "ev" | "price" | "time";

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
  if (!iso) return "—";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "—";
  return new Date(t).toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatStartShort(iso?: string | null): string {
  if (!iso) return "—";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "—";
  return new Date(t).toLocaleString(undefined, {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

function sortSteals(rows: LiveSteal[], key: SortKey): LiveSteal[] {
  const copy = [...rows];
  if (key === "price") return copy.sort((a, b) => b.price - a.price);
  if (key === "time") {
    return copy.sort((a, b) => {
      const ta = a.startsAt ? Date.parse(a.startsAt) : Number.POSITIVE_INFINITY;
      const tb = b.startsAt ? Date.parse(b.startsAt) : Number.POSITIVE_INFINITY;
      return ta - tb;
    });
  }
  // Default: EV EDGE desc (edge preferred, fall back to EV)
  return copy.sort((a, b) => {
    const ea = a.edge ?? a.ev ?? -Infinity;
    const eb = b.edge ?? b.ev ?? -Infinity;
    return eb - ea;
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
                <Text style={{ color: colors.foreground, fontFamily: FONT.bold, fontSize: 22 }}>{pct}%</Text>
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
      <Text style={{ color: STEAL_ACCENT, fontFamily: FONT.semibold, fontSize: 12 }}>
        {log?.errorReason ?? "odds_feed_unreachable"}
        {log?.httpStatus != null ? ` · HTTP ${log.httpStatus}` : ""}
      </Text>
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
        <Text style={{ color: "#fff", fontFamily: FONT.bold, fontSize: 14 }}>
          {isRetrying ? "Retrying…" : "Retry"}
        </Text>
      </Pressable>
    </View>
  );
}

function ScanChecklist({
  meta,
  phase,
}: {
  meta?: StealScanMeta;
  phase: "loading" | "empty" | "results";
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
            {
              label: books != null ? `Scanned ${books} sportsbook${books === 1 ? "" : "s"}` : "Sportsbooks scanned",
              done: true,
            },
            {
              label: markets != null ? `${formatScanCount(markets)} markets checked` : "Markets checked",
              done: true,
            },
            {
              label:
                longshots != null ? `${formatScanCount(longshots)} longshots evaluated` : "Longshots evaluated",
              done: true,
            },
            { label: "No +500 value opportunities found at this time.", done: true },
          ]
        : [
            {
              label: books != null ? `Scanned ${books} sportsbook${books === 1 ? "" : "s"}` : "Sportsbooks scanned",
              done: true,
            },
            {
              label: markets != null ? `${formatScanCount(markets)} markets checked` : "Markets checked",
              done: true,
            },
            {
              label:
                longshots != null ? `${formatScanCount(longshots)} longshots evaluated` : "Longshots evaluated",
              done: true,
            },
            {
              label: `${found} value steal${found === 1 ? "" : "s"} found`,
              done: true,
            },
          ];

  return (
    <View style={{ gap: 10 }}>
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
      <Text style={{ color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 12, marginTop: 2 }}>
        {phase === "loading"
          ? "This may take a few seconds."
          : phase === "empty"
            ? "We'll rescan every few seconds in case a new longshot surfaces."
            : "Updating every few seconds…"}
      </Text>
    </View>
  );
}

function RadarScan() {
  const colors = useColors();
  const size = 170;
  const c = size / 2;
  const arm = size * 0.49;
  const spin = useRef(new Animated.Value(0)).current;
  const pulse = useRef(new Animated.Value(0)).current;

  useFocusEffect(
    useCallback(() => {
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
    }, [pulse, spin]),
  );

  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] });
  const blipOpacity = pulse.interpolate({ inputRange: [0.35, 1], outputRange: [0.35, 1] });

  return (
    <View style={{ alignItems: "center", paddingVertical: 28, gap: 12 }}>
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
        </Animated.View>
        <Animated.View
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
      </View>
      <Text style={{ color: colors.foreground, fontFamily: FONT.display, fontSize: 19 }}>Hunting for steals...</Text>
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

/** Compact board row matching GAME / MARKET · EV EDGE · BOOKS · TIME. */
function StealBoardRow({ steal, expanded, onPress }: { steal: LiveSteal; expanded: boolean; onPress: () => void }) {
  const colors = useColors();
  const edgeLabel = formatPct(steal.edge ?? steal.ev);
  const booksLabel = steal.books != null && steal.books > 0 ? String(steal.books) : "—";
  const toWin = Math.round(100 * (americanToDecimal(steal.price) - 1));
  const fairPct = steal.fairProb != null ? Math.round(steal.fairProb * 100) : null;

  return (
    <Pressable
      onPress={onPress}
      style={{
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
        paddingVertical: 12,
        gap: expanded ? 10 : 0,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "flex-start" }}>
        <View style={{ flex: 1.7, paddingRight: 8 }}>
          <Text style={{ color: colors.foreground, fontFamily: FONT.semibold, fontSize: 13 }} numberOfLines={2}>
            {steal.pick}
          </Text>
          <Text style={{ color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 11, marginTop: 2 }} numberOfLines={1}>
            {steal.game} · {marketLabelFor(steal)}
          </Text>
          <Text style={{ color: STEAL_ACCENT, fontFamily: FONT.bold, fontSize: 12, marginTop: 3 }}>
            {formatOdds(steal.price)}
          </Text>
        </View>
        <Text
          style={{
            flex: 1,
            color: edgeLabel ? "#22c55e" : colors.mutedForeground,
            fontFamily: FONT.bold,
            fontSize: 13,
            textAlign: "right",
          }}
        >
          {edgeLabel || "—"}
        </Text>
        <Text
          style={{
            flex: 1,
            color: colors.foreground,
            fontFamily: FONT.semibold,
            fontSize: 13,
            textAlign: "right",
          }}
        >
          {booksLabel}
        </Text>
        <Text
          style={{
            flex: 1,
            color: colors.mutedForeground,
            fontFamily: FONT.medium,
            fontSize: 11,
            textAlign: "right",
          }}
        >
          {formatStartShort(steal.startsAt)}
        </Text>
      </View>

      {expanded ? (
        <View
          style={{
            backgroundColor: colors.card,
            borderRadius: 12,
            borderWidth: 1,
            borderColor: colors.border,
            padding: 12,
            gap: 8,
          }}
        >
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 14 }}>
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
            <View style={{ marginLeft: "auto" }}>
              <Text style={{ color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 10 }}>$100 WINS</Text>
              <Text style={{ color: colors.foreground, fontFamily: FONT.bold, fontSize: 15 }}>${toWin}</Text>
            </View>
          </View>
          <Text style={{ color: colors.mutedForeground, fontFamily: FONT.body, fontSize: 11 }}>
            {sportLabel(steal.sport)} · {formatStart(steal.startsAt)}
          </Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Feather name="alert-triangle" size={11} color={STEAL_ACCENT} />
            <Text style={{ color: STEAL_ACCENT, fontFamily: FONT.semibold, fontSize: 11 }}>
              High-variance longshot — positive value, NOT a likely win.
            </Text>
          </View>
        </View>
      ) : null}
    </Pressable>
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
        <Text style={{ color: STEAL_ACCENT, fontFamily: FONT.semibold, fontSize: 12 }}>Needed {needed}</Text>
      </View>
      <Text style={{ color: colors.mutedForeground, fontFamily: FONT.body, fontSize: 11 }} numberOfLines={1}>
        {near.pick} · {formatOdds(near.price)}
      </Text>
    </View>
  );
}

function BoardHeader({ sortKey, onSort }: { sortKey: SortKey; onSort: (k: SortKey) => void }) {
  const colors = useColors();
  const cols: Array<{ label: string; key: SortKey | null; flex: number }> = [
    { label: "GAME / MARKET", key: null, flex: 1.7 },
    { label: sortKey === "ev" ? "EV EDGE ↓" : "EV EDGE", key: "ev", flex: 1 },
    { label: "BOOKS", key: null, flex: 1 },
    { label: sortKey === "time" ? "TIME ↓" : "TIME", key: "time", flex: 1 },
  ];

  return (
    <View style={{ flexDirection: "row", borderBottomWidth: 1, borderBottomColor: colors.border, paddingBottom: 10 }}>
      {cols.map((col, i) => {
        const active = col.key != null && col.key === sortKey;
        const content = (
          <Text
            style={{
              flex: col.flex,
              color: active ? STEAL_ACCENT : colors.mutedForeground,
              fontFamily: FONT.bold,
              fontSize: 10,
              textAlign: i === 0 ? "left" : "right",
            }}
          >
            {col.label}
          </Text>
        );
        if (!col.key) return <React.Fragment key={col.label}>{content}</React.Fragment>;
        return (
          <Pressable key={col.label} onPress={() => onSort(col.key!)} style={{ flex: col.flex }}>
            <Text
              style={{
                color: active ? STEAL_ACCENT : colors.mutedForeground,
                fontFamily: FONT.bold,
                fontSize: 10,
                textAlign: "right",
              }}
            >
              {col.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function StealsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [sportFilter, setSportFilter] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("ev");
  const [showSortMenu, setShowSortMenu] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
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

  const activeData = query.isError ? null : (query.data ?? null);
  const feedLog =
    lastFeedLog ?? ((query.error as { stealFeedLog?: StealFeedClientLog } | null)?.stealFeedLog ?? null);
  const steals = activeData?.steals ?? [];
  const meta = activeData ? normalizeStealScanMeta(activeData.meta) : undefined;
  const almostQualified = activeData?.almostQualified ?? [];
  const seasonStats = activeData?.seasonStats;
  const hasResults = steals.length > 0 || almostQualified.length > 0;
  const awaitingFirstResponse = query.isLoading && !activeData && !query.isError;
  const feedUnavailable = query.isError;
  const scanComplete = Boolean(activeData && stealScanIsComplete(meta, activeData.feedDegraded));
  const isScanning = awaitingFirstResponse || (query.isFetching && !scanComplete && !feedUnavailable);

  const boardPhase: "loading" | "empty" | "results" = awaitingFirstResponse || isScanning
    ? "loading"
    : hasResults
      ? "results"
      : scanComplete
        ? "empty"
        : "loading";

  const filteredSteals = useMemo(() => {
    const base = steals.filter((s) => !sportFilter || s.sport === sportFilter);
    return sortSteals(base, sortKey);
  }, [steals, sportFilter, sortKey]);

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
            refreshing={query.isFetching && !query.isLoading}
            onRefresh={() => query.refetch()}
            tintColor={colors.primary}
          />
        }
      >
        <SeasonRecordCard record={record} seasonStats={seasonStats} />

        {!feedUnavailable && boardPhase === "results" && meta ? <StealsFoundToday meta={meta} /> : null}

        {/* Scan status sits above filters (matches product layout). Shown once only. */}
        {!feedUnavailable && boardPhase === "loading" ? <ScanChecklist meta={meta} phase="loading" /> : null}
        {!feedUnavailable && boardPhase === "empty" ? <ScanChecklist meta={meta} phase="empty" /> : null}

        {/* Sport filters */}
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
            <Text
              style={{
                color: sportFilter == null ? "#fff" : colors.foreground,
                fontFamily: FONT.bold,
                fontSize: 12,
              }}
            >
              All
            </Text>
          </Pressable>
          {SPORTS.filter((s) => (STEAL_SPORT_IDS as readonly string[]).includes(s.id)).map((sport) => {
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
            onPress={() => setShowSortMenu((v) => !v)}
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 7,
              paddingVertical: 9,
              paddingHorizontal: 12,
              borderRadius: 10,
              backgroundColor: showSortMenu ? "rgba(168,85,247,0.18)" : colors.card,
              borderWidth: 1,
              borderColor: showSortMenu ? STEAL_ACCENT : colors.border,
            }}
          >
            <Feather name="filter" size={14} color={colors.foreground} />
            <Text style={{ color: colors.foreground, fontFamily: FONT.semibold, fontSize: 12 }}>Filters</Text>
            <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: STEAL_ACCENT }} />
          </Pressable>
        </ScrollView>

        {showSortMenu ? (
          <View
            style={{
              flexDirection: "row",
              flexWrap: "wrap",
              gap: 8,
              padding: 12,
              borderRadius: 12,
              borderWidth: 1,
              borderColor: colors.border,
              backgroundColor: colors.card,
            }}
          >
            {(
              [
                { key: "ev" as const, label: "EV Edge" },
                { key: "price" as const, label: "Longest odds" },
                { key: "time" as const, label: "Soonest tip" },
              ] as const
            ).map((opt) => {
              const active = sortKey === opt.key;
              return (
                <Pressable
                  key={opt.key}
                  onPress={() => {
                    setSortKey(opt.key);
                    setShowSortMenu(false);
                  }}
                  style={{
                    paddingVertical: 8,
                    paddingHorizontal: 12,
                    borderRadius: 8,
                    backgroundColor: active ? STEAL_ACCENT : colors.background,
                    borderWidth: 1,
                    borderColor: active ? STEAL_ACCENT : colors.border,
                  }}
                >
                  <Text
                    style={{
                      color: active ? "#fff" : colors.foreground,
                      fontFamily: FONT.semibold,
                      fontSize: 12,
                    }}
                  >
                    Sort: {opt.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        ) : null}

        {!feedUnavailable ? <BoardHeader sortKey={sortKey} onSort={setSortKey} /> : null}

        {feedUnavailable ? (
          <OddsFeedUnavailable log={feedLog} isRetrying={query.isFetching} onRetry={() => query.refetch()} />
        ) : boardPhase === "loading" ? (
          <RadarScan />
        ) : boardPhase === "empty" ? (
          <View style={{ alignItems: "center", gap: 12, paddingVertical: 24, paddingHorizontal: 12 }}>
            <Feather name="search" size={28} color={STEAL_ACCENT} />
            <Text style={{ color: colors.foreground, fontFamily: FONT.display, fontSize: 18, textAlign: "center" }}>
              No steals right now
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
              The board was scanned and no +500 longshots cleared our value bar. We&apos;ll keep checking in the
              background.
            </Text>
          </View>
        ) : (
          <>
            {filteredSteals.length > 0 ? (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 4 }}>
                <Feather name="zap" size={13} color={STEAL_ACCENT} />
                <Text style={{ color: STEAL_ACCENT, fontFamily: FONT.bold, fontSize: 12, letterSpacing: 0.5 }}>
                  LIVE STEALS · {filteredSteals.length}
                </Text>
              </View>
            ) : sportFilter ? (
              <Text style={{ color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 13 }}>
                No steals for {sportLabel(sportFilter)} right now — try All.
              </Text>
            ) : null}
            {filteredSteals.map((s) => (
              <StealBoardRow
                key={s.id}
                steal={s}
                expanded={expandedId === s.id}
                onPress={() => setExpandedId((cur) => (cur === s.id ? null : s.id))}
              />
            ))}
            {almostQualified.length > 0 ? (
              <View style={{ gap: 10, marginTop: 8 }}>
                <Text style={{ color: colors.foreground, fontFamily: FONT.bold, fontSize: 15 }}>Almost Qualified</Text>
                {almostQualified
                  .filter((n) => !sportFilter || n.sport === sportFilter)
                  .map((near) => (
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

export default function StealsScreenGated() {
  return (
    <PremiumFeatureGate featureId="steals">
      <StealsScreen />
    </PremiumFeatureGate>
  );
}

import { Feather } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useMemo } from "react";
import { Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { PerformanceSparkline } from "@/components/PerformanceSparkline";
import { EmptyState, FONT, Loading } from "@/components/ui";
import { useColors } from "@/hooks/useColors";
import { getLiveSteals, propMarketLabel, type GradedSteal } from "@/lib/api";
import { formatAmerican } from "@/lib/format";
import {
  PERFORMANCE_WINDOW,
  buildRollingWinRateSeries,
  summarizeRecentPerformance,
  wonPicks,
} from "@/lib/performanceChart";
import { sportLabel } from "@/lib/sports";

const GAME_MARKET_LABEL: Record<string, string> = {
  h2h: "Moneyline",
  Moneyline: "Moneyline",
  spreads: "Spread",
  Spread: "Spread",
  totals: "Total",
  Total: "Total",
};

function marketLabelFor(row: GradedSteal): string {
  if (row.player) return propMarketLabel(row.market);
  return GAME_MARKET_LABEL[row.market] ?? row.market;
}

function formatGradedAt(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  return new Date(t).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function WonPickRow({ row }: { row: GradedSteal }) {
  const colors = useColors();
  return (
    <View
      style={{
        backgroundColor: colors.card,
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: 14,
        padding: 14,
        gap: 6,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <View
          style={{
            width: 22,
            height: 22,
            borderRadius: 11,
            backgroundColor: "rgba(52,211,153,0.18)",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Feather name="check" size={13} color="#34d399" />
        </View>
        <Text style={{ color: colors.foreground, fontFamily: FONT.semibold, fontSize: 15, flex: 1 }}>
          {row.player ?? row.pick}
        </Text>
        <Text style={{ color: "#34d399", fontFamily: FONT.bold, fontSize: 15 }}>
          {formatAmerican(row.price)}
        </Text>
      </View>
      {row.player ? (
        <Text style={{ color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 13 }}>
          {row.pick}
        </Text>
      ) : null}
      <Text style={{ color: colors.mutedForeground, fontFamily: FONT.body, fontSize: 12 }}>
        {row.game} · {marketLabelFor(row)} · {sportLabel(row.sport)}
      </Text>
      <Text style={{ color: colors.mutedForeground, fontFamily: FONT.body, fontSize: 11 }}>
        Settled {formatGradedAt(row.gradedAt)}
      </Text>
    </View>
  );
}

export default function PickPerformanceScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const stealsQ = useQuery({
    queryKey: ["live-steals"],
    queryFn: ({ signal }) => getLiveSteals(signal),
    staleTime: 2 * 60_000,
  });

  const history = stealsQ.data?.history ?? [];
  const record = stealsQ.data?.record ?? null;
  const recent = useMemo(() => summarizeRecentPerformance(history), [history]);
  const series = useMemo(() => buildRollingWinRateSeries(history), [history]);
  const wins = useMemo(() => wonPicks(history), [history]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView
        contentContainerStyle={{
          paddingTop: insets.top + 8,
          paddingHorizontal: 16,
          paddingBottom: insets.bottom + 24,
        }}
        refreshControl={
          <RefreshControl
            refreshing={stealsQ.isFetching}
            onRefresh={() => stealsQ.refetch()}
            tintColor={colors.mutedForeground}
          />
        }
      >
        <View style={{ marginBottom: 16, paddingLeft: 48 }}>
          <Text style={{ color: colors.foreground, fontFamily: FONT.display, fontSize: 24 }}>
            Pick Performance
          </Text>
          <Text
            style={{
              color: colors.mutedForeground,
              fontFamily: FONT.body,
              fontSize: 12,
              marginTop: 2,
            }}
          >
            Auto-graded record of the app's flagged value picks
          </Text>
        </View>

        {stealsQ.isLoading ? (
          <Loading label="Loading performance…" />
        ) : history.length === 0 ? (
          <EmptyState
            title="No settled picks yet"
            subtitle="Every flagged value pick is logged when we surface it and auto-graded against the real result once the game finishes."
          />
        ) : (
          <>
            <View
              style={{
                backgroundColor: colors.card,
                borderWidth: 1,
                borderColor: colors.border,
                borderRadius: 16,
                padding: 16,
                gap: 14,
              }}
            >
              <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                <View style={{ flex: 1, gap: 12 }}>
                  <View style={{ flexDirection: "row" }}>
                    {[
                      {
                        val: recent.winPct != null ? `${recent.winPct}%` : "—",
                        label: `Win rate (last ${PERFORMANCE_WINDOW})`,
                        tint: "#34d399",
                      },
                      {
                        val:
                          recent.wins + recent.losses > 0
                            ? `${recent.wins}-${recent.losses}${recent.pushes > 0 ? `-${recent.pushes}` : ""}`
                            : "—",
                        label: `Record (last ${PERFORMANCE_WINDOW})`,
                        tint: colors.foreground,
                      },
                      {
                        val: record ? String(record.graded) : "—",
                        label: "Graded (all time)",
                        tint: colors.foreground,
                      },
                    ].map((m, i) => (
                      <View
                        key={i}
                        style={{
                          flex: 1,
                          alignItems: "center",
                          gap: 3,
                          borderLeftWidth: i === 0 ? 0 : 1,
                          borderLeftColor: colors.border,
                        }}
                      >
                        <Text style={{ color: m.tint, fontFamily: FONT.display, fontSize: 22 }}>
                          {m.val}
                        </Text>
                        <Text
                          style={{
                            color: colors.mutedForeground,
                            fontFamily: FONT.medium,
                            fontSize: 9,
                            letterSpacing: 0.3,
                            textTransform: "uppercase",
                            textAlign: "center",
                          }}
                        >
                          {m.label}
                        </Text>
                      </View>
                    ))}
                  </View>
                </View>
                {series.length >= 2 ? (
                  <View
                    style={{
                      width: 112,
                      height: 64,
                      alignItems: "center",
                      justifyContent: "center",
                      backgroundColor: "rgba(59,130,246,0.08)",
                      borderRadius: 12,
                    }}
                  >
                    <PerformanceSparkline series={series} width={96} height={56} color={colors.primary} />
                  </View>
                ) : null}
              </View>
              <Text style={{ color: colors.mutedForeground, fontFamily: FONT.body, fontSize: 11, lineHeight: 16 }}>
                Chart tracks rolling win rate across settled picks — real outcomes only, never projected.
              </Text>
            </View>

            <View style={{ marginTop: 24, gap: 10 }}>
              <Text
                style={{
                  color: colors.primary,
                  fontFamily: FONT.display,
                  fontSize: 13,
                  letterSpacing: 0.5,
                }}
              >
                WON PICKS ({wins.length})
              </Text>
              {wins.length === 0 ? (
                <Text style={{ color: colors.mutedForeground, fontFamily: FONT.body, fontSize: 13 }}>
                  No wins logged yet — every settled pick is tracked here as results come in.
                </Text>
              ) : (
                wins.map((row) => <WonPickRow key={row.id} row={row} />)
              )}
            </View>
          </>
        )}

        <Pressable
          onPress={() => router.back()}
          style={({ pressed }) => ({
            marginTop: 24,
            alignSelf: "center",
            opacity: pressed ? 0.7 : 1,
          })}
        >
          <Text style={{ color: colors.primary, fontFamily: FONT.semibold, fontSize: 14 }}>Back</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

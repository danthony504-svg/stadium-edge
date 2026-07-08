import { useMemo } from "react";
import { ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppHeader, PageTitleRow } from "@/components/AppHeader";
import { PerformanceSparkline } from "@/components/PerformanceSparkline";
import { EmptyState, FONT } from "@/components/ui";
import { useBetSlip } from "@/context/BetSlipContext";
import { usePickTracker } from "@/context/PickTrackerContext";
import { useColors } from "@/hooks/useColors";
import {
  buildInsights,
  computeAnalytics,
  decided,
  recordText,
  winPct,
  MIN_CATEGORY_SAMPLE,
  MIN_INSIGHT_SAMPLE,
  type Breakdown,
  type Tally,
} from "@/lib/modelReport";
import {
  decided as trackedDecided,
  recordText as trackedRecord,
  winPct as trackedWinPct,
  type Breakdown as TrackedBreakdown,
} from "@/lib/pickTrackerAnalytics";

function StatTile({
  label,
  record,
  pct,
  sub,
}: {
  label: string;
  record: string;
  pct: number | null;
  sub?: string;
}) {
  const colors = useColors();
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: colors.card,
        borderColor: colors.border,
        borderWidth: 1,
        borderRadius: 16,
        padding: 16,
      }}
    >
      <Text
        style={{
          color: colors.mutedForeground,
          fontFamily: FONT.medium,
          fontSize: 11,
          letterSpacing: 0.5,
          textTransform: "uppercase",
        }}
      >
        {label}
      </Text>
      <Text
        style={{
          color: colors.foreground,
          fontFamily: FONT.display,
          fontSize: 28,
          marginTop: 6,
        }}
      >
        {pct == null ? "—" : `${pct > 0 && label === "ROI" ? "+" : ""}${pct.toFixed(label === "ROI" ? 1 : 0)}%`}
      </Text>
      <Text
        style={{
          color: colors.mutedForeground,
          fontFamily: FONT.body,
          fontSize: 12,
          marginTop: 2,
        }}
      >
        {record}
      </Text>
      {sub ? (
        <Text
          style={{
            color: colors.mutedForeground,
            fontFamily: FONT.body,
            fontSize: 11,
            marginTop: 4,
          }}
        >
          {sub}
        </Text>
      ) : null}
    </View>
  );
}

function BreakdownSection({
  title,
  rows,
  minSample = MIN_CATEGORY_SAMPLE,
}: {
  title: string;
  rows: Breakdown[] | TrackedBreakdown[];
  minSample?: number;
}) {
  const colors = useColors();
  if (rows.length === 0) return null;
  return (
    <View style={{ marginTop: 24 }}>
      <Text
        style={{
          color: colors.primary,
          fontFamily: FONT.display,
          fontSize: 13,
          letterSpacing: 0.5,
          marginBottom: 10,
        }}
      >
        {title.toUpperCase()}
      </Text>
      <View
        style={{
          backgroundColor: colors.card,
          borderColor: colors.border,
          borderWidth: 1,
          borderRadius: 16,
          overflow: "hidden",
        }}
      >
        {rows.map((b, i) => {
          const pct = winPct(b.tally) ?? trackedWinPct(b.tally);
          const d = decided(b.tally) || trackedDecided(b.tally);
          const enough = d >= minSample;
          return (
            <View
              key={b.key}
              style={{
                flexDirection: "row",
                alignItems: "center",
                paddingHorizontal: 16,
                paddingVertical: 12,
                borderTopWidth: i === 0 ? 0 : 1,
                borderTopColor: colors.border,
              }}
            >
              <Text
                style={{
                  flex: 1,
                  color: colors.foreground,
                  fontFamily: FONT.semibold,
                  fontSize: 14,
                }}
              >
                {b.label}
              </Text>
              <Text
                style={{
                  color: colors.mutedForeground,
                  fontFamily: FONT.body,
                  fontSize: 12,
                  marginRight: 12,
                }}
              >
                {recordText(b.tally) || trackedRecord(b.tally)}
              </Text>
              <Text
                style={{
                  color: enough
                    ? pct != null && pct >= 55
                      ? colors.primary
                      : pct != null && pct <= 42
                        ? colors.destructive
                        : colors.foreground
                    : colors.mutedForeground,
                  fontFamily: FONT.bold,
                  fontSize: 14,
                  width: 64,
                  textAlign: "right",
                }}
              >
                {enough && pct != null ? `${pct.toFixed(0)}%` : `${d} graded`}
              </Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

export default function ReportScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { results } = useBetSlip();
  const { analytics: coach } = usePickTracker();

  const slipAnalytics = useMemo(() => computeAnalytics(results), [results]);
  const slipInsights = useMemo(() => buildInsights(slipAnalytics), [slipAnalytics]);

  const hasCoachGraded = trackedDecided(coach.legTally) > 0;
  const hasSlipGraded = decided(slipAnalytics.legTally) > 0;
  const hasAny = hasCoachGraded || hasSlipGraded;

  const bestSport = coach.bySport.find((b) => trackedDecided(b.tally) >= 5);
  const worstSport = [...coach.bySport]
    .filter((b) => trackedDecided(b.tally) >= 5)
    .sort((a, b) => (trackedWinPct(a.tally) ?? 100) - (trackedWinPct(b.tally) ?? 100))[0];
  const bestMarket = coach.byFamily.find((b) => trackedDecided(b.tally) >= 5);

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <AppHeader bottomGap={0}>
        <PageTitleRow
          icon="bar-chart-2"
          title="Model Report"
          subtitle="AI Coach pick history and settled slip performance"
          showHowItWorks={false}
        />
      </AppHeader>
      <ScrollView
        contentContainerStyle={{
          paddingTop: 8,
          paddingHorizontal: 16,
          paddingBottom: insets.bottom + 24,
        }}
      >
        {!hasAny ? (
          <EmptyState
            title="No graded picks yet"
            subtitle="Ask the AI Coach for picks before games start — we save every recommendation and grade it automatically after the final. Saved bet slips grade the same way."
          />
        ) : (
          <>
            {hasCoachGraded ? (
              <>
                <Text
                  style={{
                    color: colors.primary,
                    fontFamily: FONT.display,
                    fontSize: 13,
                    letterSpacing: 0.5,
                    marginBottom: 10,
                  }}
                >
                  AI COACH PICKS
                </Text>
                <View style={{ flexDirection: "row", gap: 12 }}>
                  <StatTile
                    label="Win rate"
                    record={trackedRecord(coach.legTally)}
                    pct={trackedWinPct(coach.legTally)}
                    sub={
                      coach.pending > 0
                        ? `${coach.pending} pending`
                        : undefined
                    }
                  />
                  <StatTile
                    label="ROI"
                    record={`${coach.unitsWon >= 0 ? "+" : ""}${coach.unitsWon.toFixed(2)} units`}
                    pct={coach.roiPct}
                  />
                </View>

                {coach.rollingWinRate.length >= 2 ? (
                  <View
                    style={{
                      marginTop: 16,
                      backgroundColor: colors.card,
                      borderColor: colors.border,
                      borderWidth: 1,
                      borderRadius: 16,
                      padding: 16,
                    }}
                  >
                    <Text
                      style={{
                        color: colors.mutedForeground,
                        fontFamily: FONT.medium,
                        fontSize: 11,
                        letterSpacing: 0.5,
                        textTransform: "uppercase",
                        marginBottom: 8,
                      }}
                    >
                      AI accuracy over time
                    </Text>
                    <PerformanceSparkline
                      series={coach.rollingWinRate}
                      width={320}
                      height={56}
                      color={colors.primary}
                    />
                    <Text
                      style={{
                        color: colors.mutedForeground,
                        fontFamily: FONT.body,
                        fontSize: 11,
                        marginTop: 8,
                      }}
                    >
                      Rolling win rate on settled coach picks (newest at right).
                    </Text>
                  </View>
                ) : null}

                {(coach.hotTrend || coach.coldTrend || bestSport || worstSport || bestMarket) && (
                  <View style={{ marginTop: 20, gap: 8 }}>
                    <Text
                      style={{
                        color: colors.primary,
                        fontFamily: FONT.display,
                        fontSize: 13,
                        letterSpacing: 0.5,
                      }}
                    >
                      TRENDS
                    </Text>
                    {coach.hotTrend ? (
                      <TrendLine text={coach.hotTrend} hot />
                    ) : null}
                    {coach.coldTrend ? (
                      <TrendLine text={coach.coldTrend} hot={false} />
                    ) : null}
                    {bestSport && trackedWinPct(bestSport.tally) != null ? (
                      <TrendLine
                        text={`Best sport: ${bestSport.label} at ${trackedWinPct(bestSport.tally)!.toFixed(0)}% (${trackedRecord(bestSport.tally)})`}
                        hot
                      />
                    ) : null}
                    {worstSport && worstSport !== bestSport && trackedWinPct(worstSport.tally) != null ? (
                      <TrendLine
                        text={`Worst sport: ${worstSport.label} at ${trackedWinPct(worstSport.tally)!.toFixed(0)}% (${trackedRecord(worstSport.tally)})`}
                        hot={false}
                      />
                    ) : null}
                    {bestMarket && trackedWinPct(bestMarket.tally) != null ? (
                      <TrendLine
                        text={`Best market: ${bestMarket.label} at ${trackedWinPct(bestMarket.tally)!.toFixed(0)}% (${trackedRecord(bestMarket.tally)})`}
                        hot
                      />
                    ) : null}
                  </View>
                )}

                <BreakdownSection title="By sport" rows={coach.bySport} />
                <BreakdownSection title="By market type" rows={coach.byFamily} />
                <BreakdownSection title="Player props vs game lines" rows={coach.byMarketType} />
                <BreakdownSection title="By odds range" rows={coach.byOddsBucket} />
                <BreakdownSection title="Favorites / underdogs / longshots" rows={coach.byOddsRole} />
                <BreakdownSection title="By AI grade" rows={coach.byGrade} />
                <BreakdownSection title="By confidence" rows={coach.byConfidence} />
                <BreakdownSection title="By edge" rows={coach.byEdge} />
              </>
            ) : coach.pending > 0 ? (
              <EmptyState
                title={`${coach.pending} coach pick${coach.pending === 1 ? "" : "s"} tracking`}
                subtitle="Games still in progress — results grade automatically once they finish."
              />
            ) : null}

            {hasSlipGraded ? (
              <>
                <Text
                  style={{
                    color: colors.primary,
                    fontFamily: FONT.display,
                    fontSize: 13,
                    letterSpacing: 0.5,
                    marginTop: hasCoachGraded ? 28 : 0,
                    marginBottom: 10,
                  }}
                >
                  SETTLED BET SLIPS
                </Text>
                <View style={{ flexDirection: "row", gap: 12 }}>
                  <StatTile
                    label="Parlay record"
                    record={recordText(slipAnalytics.slipTally)}
                    pct={winPct(slipAnalytics.slipTally)}
                  />
                  <StatTile
                    label="Leg record"
                    record={recordText(slipAnalytics.legTally)}
                    pct={winPct(slipAnalytics.legTally)}
                  />
                </View>

                {slipInsights.length > 0 ? (
                  <View style={{ marginTop: 20, gap: 8 }}>
                    {slipInsights.map((line, i) => (
                      <TrendLine key={i} text={line} hot />
                    ))}
                  </View>
                ) : (
                  <Text
                    style={{
                      color: colors.mutedForeground,
                      fontFamily: FONT.body,
                      fontSize: 12,
                      marginTop: 16,
                      lineHeight: 18,
                    }}
                  >
                    Slip insights unlock once enough bets settle (need {MIN_INSIGHT_SAMPLE}+
                    graded per category).
                  </Text>
                )}

                <BreakdownSection title="Over / under (slips)" rows={slipAnalytics.bySide} />
                <BreakdownSection title="By market (slips)" rows={slipAnalytics.byFamily} />
                <BreakdownSection title="By sport (slips)" rows={slipAnalytics.bySport} />
              </>
            ) : null}
          </>
        )}
      </ScrollView>
    </View>
  );
}

function TrendLine({ text, hot }: { text: string; hot: boolean }) {
  const colors = useColors();
  return (
    <View
      style={{
        flexDirection: "row",
        gap: 8,
        backgroundColor: colors.card,
        borderColor: colors.border,
        borderWidth: 1,
        borderRadius: 14,
        padding: 14,
      }}
    >
      <Text
        style={{
          color: hot ? colors.primary : colors.destructive,
          fontFamily: FONT.bold,
          fontSize: 13,
        }}
      >
        ▸
      </Text>
      <Text
        style={{
          flex: 1,
          color: colors.foreground,
          fontFamily: FONT.medium,
          fontSize: 13,
          lineHeight: 19,
        }}
      >
        {text}
      </Text>
    </View>
  );
}

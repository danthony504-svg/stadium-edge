import { useMemo } from "react";
import { ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { EmptyState, FONT } from "@/components/ui";
import { useBetSlip } from "@/context/BetSlipContext";
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

function StatTile({
  label,
  record,
  pct,
}: {
  label: string;
  record: string;
  pct: number | null;
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
        {pct == null ? "—" : `${pct.toFixed(0)}%`}
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
    </View>
  );
}

function BreakdownSection({
  title,
  rows,
}: {
  title: string;
  rows: Breakdown[];
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
          const pct = winPct(b.tally);
          const enough = decided(b.tally) >= MIN_CATEGORY_SAMPLE;
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
                {recordText(b.tally)}
              </Text>
              <Text
                style={{
                  color: enough
                    ? pct != null && pct >= 55
                      ? colors.primary
                      : colors.foreground
                    : colors.mutedForeground,
                  fontFamily: FONT.bold,
                  fontSize: 14,
                  width: 64,
                  textAlign: "right",
                }}
              >
                {enough && pct != null
                  ? `${pct.toFixed(0)}%`
                  : `${decided(b.tally)} graded`}
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

  const analytics = useMemo(() => computeAnalytics(results), [results]);
  const insights = useMemo(() => buildInsights(analytics), [analytics]);

  const hasGraded = decided(analytics.legTally) > 0;

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView
        contentContainerStyle={{
          paddingTop: insets.top + 8,
          paddingHorizontal: 16,
          paddingBottom: insets.bottom + 24,
        }}
      >
        <View style={{ marginBottom: 16, paddingLeft: 48 }}>
          <Text style={{ color: colors.foreground, fontFamily: FONT.display, fontSize: 24 }}>
            Model Report
          </Text>
          <Text
            style={{
              color: colors.mutedForeground,
              fontFamily: FONT.body,
              fontSize: 12,
              marginTop: 2,
            }}
          >
            Real graded results from your settled slips
          </Text>
        </View>

        {!hasGraded ? (
          <EmptyState
            title="No settled bets yet"
            subtitle="Save a slip from the Coach or Props tab. Once its games finish, we grade every leg against the real result and your performance shows up here."
          />
        ) : (
          <>
            {/* Headline records */}
            <View style={{ flexDirection: "row", gap: 12 }}>
              <StatTile
                label="Parlay record"
                record={recordText(analytics.slipTally)}
                pct={winPct(analytics.slipTally)}
              />
              <StatTile
                label="Leg record"
                record={recordText(analytics.legTally)}
                pct={winPct(analytics.legTally)}
              />
            </View>

            {analytics.ungradedLegs > 0 ? (
              <Text
                style={{
                  color: colors.mutedForeground,
                  fontFamily: FONT.body,
                  fontSize: 11,
                  marginTop: 8,
                }}
              >
                {analytics.ungradedLegs} leg{analytics.ungradedLegs === 1 ? "" : "s"} couldn't
                be graded from real data and are excluded from these numbers.
              </Text>
            ) : null}

            {/* Insights — only when the sample is real enough to mean something */}
            {insights.length > 0 ? (
              <View style={{ marginTop: 20 }}>
                <Text
                  style={{
                    color: colors.primary,
                    fontFamily: FONT.display,
                    fontSize: 13,
                    letterSpacing: 0.5,
                    marginBottom: 10,
                  }}
                >
                  WHAT THE MODEL IS HITTING
                </Text>
                <View style={{ gap: 8 }}>
                  {insights.map((line, i) => (
                    <View
                      key={i}
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
                      <Text style={{ color: colors.primary, fontFamily: FONT.bold, fontSize: 13 }}>
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
                        {line}
                      </Text>
                    </View>
                  ))}
                </View>
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
                Collecting results — insights unlock once enough bets settle
                (need {MIN_INSIGHT_SAMPLE}+ graded per category).
              </Text>
            )}

            <BreakdownSection title="Over / Under" rows={analytics.bySide} />
            <BreakdownSection title="By Market" rows={analytics.byFamily} />
            <BreakdownSection title="By Sport" rows={analytics.bySport} />
          </>
        )}
      </ScrollView>
    </View>
  );
}

import { Feather } from "@expo/vector-icons";
import { useMemo, useState } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { FONT } from "@/components/ui";
import { usePickTracker } from "@/context/PickTrackerContext";
import { useColors } from "@/hooks/useColors";
import {
  buildPerformanceHeadlines,
  computeLearningCardStats,
  formatPct,
  formatSignedPct,
  worstBreakdown,
} from "@/lib/coachLearningDisplay";
import {
  decided,
  recordText,
  winPct,
  type TrackedAnalytics,
} from "@/lib/pickTrackerAnalytics";

function StatCell({ label, value }: { label: string; value: string }) {
  const colors = useColors();
  return (
    <View style={{ flex: 1, minWidth: "46%" }}>
      <Text
        style={{
          color: colors.mutedForeground,
          fontFamily: FONT.medium,
          fontSize: 10,
          letterSpacing: 0.4,
          textTransform: "uppercase",
        }}
      >
        {label}
      </Text>
      <Text
        style={{
          color: colors.foreground,
          fontFamily: FONT.display,
          fontSize: 17,
          marginTop: 2,
        }}
      >
        {value}
      </Text>
    </View>
  );
}

function ModalRow({ label, value }: { label: string; value: string }) {
  const colors = useColors();
  return (
    <View
      style={{
        flexDirection: "row",
        justifyContent: "space-between",
        gap: 12,
        paddingVertical: 8,
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
      }}
    >
      <Text style={{ color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 13, flex: 1 }}>
        {label}
      </Text>
      <Text style={{ color: colors.foreground, fontFamily: FONT.semibold, fontSize: 13 }}>
        {value}
      </Text>
    </View>
  );
}

function LearningDetailModal({
  visible,
  onClose,
  analytics,
}: {
  visible: boolean;
  onClose: () => void;
  analytics: TrackedAnalytics;
}) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const decidedCount = decided(analytics.legTally);
  const worstSport = worstBreakdown(analytics.bySport);
  const bestSport = analytics.bySport.find((b) => decided(b.tally) >= 3) ?? null;
  const bestMarket = analytics.byFamily.find((b) => decided(b.tally) >= 3) ?? null;

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "flex-end" }}>
        <View
          style={{
            backgroundColor: colors.background,
            borderTopLeftRadius: 18,
            borderTopRightRadius: 18,
            maxHeight: "88%",
            paddingBottom: insets.bottom + 12,
          }}
        >
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              paddingHorizontal: 16,
              paddingTop: 16,
              paddingBottom: 10,
              borderBottomWidth: 1,
              borderBottomColor: colors.border,
            }}
          >
            <Text style={{ color: colors.foreground, fontFamily: FONT.display, fontSize: 18 }}>
              AI Learning History
            </Text>
            <Pressable onPress={onClose} hitSlop={12}>
              <Feather name="x" size={22} color={colors.foreground} />
            </Pressable>
          </View>
          <ScrollView
            contentContainerStyle={{ padding: 16, gap: 4 }}
            showsVerticalScrollIndicator
          >
            <ModalRow label="Wins" value={`${analytics.legTally.wins}`} />
            <ModalRow label="Losses" value={`${analytics.legTally.losses}`} />
            <ModalRow label="Pushes" value={`${analytics.legTally.pushes}`} />
            <ModalRow
              label="ROI"
              value={
                analytics.roiPct != null
                  ? formatSignedPct(analytics.roiPct) ?? "—"
                  : "—"
              }
            />
            <ModalRow
              label="Units won"
              value={
                decidedCount > 0
                  ? `${analytics.unitsWon > 0 ? "+" : ""}${analytics.unitsWon}`
                  : "—"
              }
            />
            <ModalRow
              label="Profit"
              value={
                decidedCount > 0
                  ? `${analytics.unitsWon > 0 ? "+" : ""}${analytics.unitsWon} units`
                  : "—"
              }
            />
            {bestSport ? (
              <ModalRow
                label="Best sport"
                value={`${bestSport.label} (${winPct(bestSport.tally)?.toFixed(0)}%)`}
              />
            ) : null}
            {worstSport ? (
              <ModalRow
                label="Worst sport"
                value={`${worstSport.label} (${winPct(worstSport.tally)?.toFixed(0)}%)`}
              />
            ) : null}
            {bestMarket ? (
              <ModalRow
                label="Best market"
                value={`${bestMarket.label} (${winPct(bestMarket.tally)?.toFixed(0)}%)`}
              />
            ) : null}
            {analytics.byGrade.length > 0 ? (
              <View style={{ marginTop: 12, gap: 6 }}>
                <Text
                  style={{
                    color: colors.primary,
                    fontFamily: FONT.semibold,
                    fontSize: 12,
                    letterSpacing: 0.3,
                    textTransform: "uppercase",
                  }}
                >
                  Accuracy by AI grade
                </Text>
                {analytics.byGrade
                  .filter((b) => decided(b.tally) >= 2)
                  .map((b) => (
                    <ModalRow
                      key={b.key}
                      label={b.label}
                      value={`${winPct(b.tally)?.toFixed(0)}% (${recordText(b.tally)})`}
                    />
                  ))}
              </View>
            ) : null}
            {decidedCount === 0 ? (
              <Text
                style={{
                  color: colors.mutedForeground,
                  fontFamily: FONT.body,
                  fontSize: 12,
                  marginTop: 12,
                  lineHeight: 18,
                }}
              >
                Picks are tracked before kickoff. Detailed stats appear here after games
                finish and results are graded.
              </Text>
            ) : null}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

export function CoachLearningPanel() {
  const colors = useColors();
  const { analytics, picks } = usePickTracker();
  const [detailOpen, setDetailOpen] = useState(false);

  const stats = useMemo(
    () => computeLearningCardStats(picks, analytics),
    [picks, analytics],
  );
  const headlines = useMemo(() => buildPerformanceHeadlines(picks), [picks]);
  const decidedCount = decided(analytics.legTally);

  if (analytics.total === 0) return null;

  return (
    <>
      <View
        style={{
          backgroundColor: colors.card,
          borderColor: colors.border,
          borderWidth: 1,
          borderRadius: 14,
          padding: 14,
          gap: 12,
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <Feather name="cpu" size={14} color={colors.primary} />
          <Text
            style={{
              color: colors.primary,
              fontFamily: FONT.display,
              fontSize: 13,
              letterSpacing: 0.3,
            }}
          >
            AI LEARNING
          </Text>
        </View>

        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 14 }}>
          <StatCell
            label="Picks tracked"
            value={stats.picksTracked.toLocaleString()}
          />
          {stats.winRatePct != null ? (
            <StatCell label="Win rate" value={formatPct(stats.winRatePct) ?? "—"} />
          ) : null}
          {stats.roiPct != null ? (
            <StatCell label="ROI" value={formatSignedPct(stats.roiPct) ?? "—"} />
          ) : null}
          {stats.last30Record ? (
            <StatCell label="Last 30 days" value={stats.last30Record} />
          ) : null}
          {stats.bestSport ? (
            <StatCell label="Best sport" value={stats.bestSport} />
          ) : null}
          {stats.bestMarket ? (
            <StatCell label="Best market" value={stats.bestMarket} />
          ) : null}
          {stats.avgLineValuePct != null ? (
            <StatCell
              label="Avg line value"
              value={formatSignedPct(stats.avgLineValuePct) ?? "—"}
            />
          ) : null}
          {stats.pending > 0 && decidedCount === 0 ? (
            <StatCell label="Pending" value={`${stats.pending}`} />
          ) : null}
        </View>

        {headlines.length > 0 ? (
          <View
            style={{
              backgroundColor: colors.background,
              borderRadius: 10,
              padding: 10,
              gap: 6,
              borderWidth: 1,
              borderColor: colors.border,
            }}
          >
            {headlines.map((line) => (
              <Text
                key={line}
                style={{
                  color: colors.foreground,
                  fontFamily: FONT.medium,
                  fontSize: 12,
                  lineHeight: 18,
                }}
              >
                {line}
              </Text>
            ))}
          </View>
        ) : null}

        <Pressable onPress={() => setDetailOpen(true)}>
          <Text
            style={{
              color: colors.primary,
              fontFamily: FONT.medium,
              fontSize: 11,
              lineHeight: 17,
              textDecorationLine: "underline",
            }}
          >
            {decidedCount > 0
              ? "View full learning history — wins, ROI, best sports & markets"
              : "History updates automatically after games finish — tap for details"}
          </Text>
        </Pressable>
      </View>

      <LearningDetailModal
        visible={detailOpen}
        onClose={() => setDetailOpen(false)}
        analytics={analytics}
      />
    </>
  );
}

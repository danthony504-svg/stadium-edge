import { Feather } from "@expo/vector-icons";
import { Text, View } from "react-native";

import { FONT } from "@/components/ui";
import { useColors } from "@/hooks/useColors";
import type { CombinedPickScore, PickSubScores } from "@/lib/pickScore";
import { confidenceTierLabel } from "@/lib/finalAiScore";
import type { ParsedPick } from "@/components/PickCard";
import type { PropHolisticScore } from "@/lib/propHolisticRecommendation";
import { propHolisticTopDrivers, buildCoachCardHolistic } from "@/lib/propHolisticRecommendation";
import { preliminaryHolisticCoverageCaption } from "@/lib/coachResultState";
import { NOT_YET_AI_GRADED } from "@/lib/simMarketSupport";
import { NOT_AI_RECOMMENDED, NOT_AI_RECOMMENDED_COMPACT } from "@/lib/pickRecommendation";

// Renders the pick rubric plus combined AI Grade, Confidence, and Edge %.
// For player props, the compact strip shows EV / sim / matchup / form / injury /
// market efficiency — missing signals render dim rather than disappearing.

function useScoreColor() {
  const colors = useColors();
  return (score: number | null) =>
    score == null
      ? colors.mutedForeground
      : score >= 7
        ? colors.success
        : score >= 5.5
          ? colors.primary
          : colors.mutedForeground;
}

const COACH_CARD_STRIP: Array<{ key: string; label: string; altKeys?: string[] }> = [
  { key: "sportsbookValue", label: "EV" },
  { key: "simulation", label: "Sim" },
  { key: "matchup", label: "Match", altKeys: ["opponentTendency"] },
  { key: "recentForm", label: "Form", altKeys: ["playingTime"] },
  { key: "injury", label: "Inj" },
  { key: "lineMovement", label: "Mkt" },
];

function stripSlotFactor(
  factors: PropHolisticScore["factors"],
  slot: { key: string; altKeys?: string[] },
): { score: number | null; present: boolean; applicable: boolean } {
  const keys = [slot.key, ...(slot.altKeys ?? [])];
  const matched = keys.map((k) => factors.find((x) => x.key === k)).filter(Boolean);
  if (!matched.length) return { score: null, present: false, applicable: true };
  const applicable = matched.some((f) => f!.applicable);
  if (!applicable) return { score: null, present: false, applicable: false };
  const scores = matched
    .filter((f) => f!.applicable && f!.present && f!.score != null)
    .map((f) => f!.score as number);
  if (!scores.length) return { score: null, present: false, applicable: true };
  return {
    score: Math.max(...scores),
    present: true,
    applicable: true,
  };
}

function HolisticFactorStrip({ holistic }: { holistic: PropHolisticScore }) {
  const colors = useColors();
  const scoreColor = useScoreColor();
  const factors = holistic.factors;
  const preliminary = holistic.missingCount >= 4;
  const missingLabels = factors
    .filter((f) => f.applicable && !f.present)
    .map((f) => f.label);
  const topKeys = new Set(
    COACH_CARD_STRIP.map((slot) => {
      const { score, present } = stripSlotFactor(factors, slot);
      return present && score != null ? { key: slot.key, score } : null;
    })
      .filter((x): x is { key: string; score: number } => x != null)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
      .map((x) => x.key),
  );
  const drivers = propHolisticTopDrivers(holistic);
  return (
    <View style={{ gap: 5 }}>
      <Text style={{ color: colors.foreground, fontFamily: FONT.medium, fontSize: 10.5, lineHeight: 15 }}>
        {drivers}
      </Text>
      <View style={{ flexDirection: "row", gap: 3 }}>
        {COACH_CARD_STRIP.map((slot) => {
          const slotScore = stripSlotFactor(factors, slot);
          if (!slotScore.applicable) {
            return <View key={slot.key} style={{ flex: 1 }} />;
          }
          const present = slotScore.present && slotScore.score != null;
          const s = slotScore.score;
          const isTop = present && topKeys.has(slot.key);
          return (
            <View key={slot.key} style={{ flex: 1, alignItems: "center", gap: 3 }}>
              <View
                style={{
                  width: "100%",
                  height: isTop ? 6 : 4,
                  borderRadius: 999,
                  backgroundColor: present ? scoreColor(s) : colors.border,
                  opacity: present ? 1 : 0.35,
                }}
              />
              <Text
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.65}
                style={{
                  color: present ? (isTop ? colors.foreground : colors.mutedForeground) : colors.mutedForeground,
                  fontFamily: isTop ? FONT.bold : FONT.medium,
                  fontSize: 8,
                  opacity: present ? 1 : 0.55,
                }}
              >
                {slot.label}
              </Text>
            </View>
          );
        })}
      </View>
      <Text style={{ color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 9.5 }}>
        {preliminary
          ? preliminaryHolisticCoverageCaption(holistic, missingLabels)
          : `${holistic.coveragePct}% context grounded${
              holistic.missingCount > 0
                ? ` · ${holistic.missingCount} signal${holistic.missingCount === 1 ? "" : "s"} missing`
                : ""
            }`}
      </Text>
    </View>
  );
}

/** Five full-detail bars for prop/game detail pages (not coach cards). */
const FACTORS: Array<{ key: keyof PickSubScores; label: string; icon: keyof typeof Feather.glyphMap }> = [
  { key: "matchup", label: "Matchup", icon: "users" },
  { key: "trend", label: "Trend", icon: "trending-up" },
  { key: "lineValue", label: "Expected Value", icon: "tag" },
  { key: "injury", label: "Injury Impact", icon: "activity" },
  { key: "lineShopping", label: "Market Efficiency", icon: "shopping-cart" },
  { key: "simulation", label: "Model Sim", icon: "cpu" },
];

function MetricTile({
  icon,
  label,
  value,
  valueColor,
  caption,
  suffix,
  compactValue,
}: {
  icon: keyof typeof Feather.glyphMap;
  label: string;
  value: string;
  valueColor: string;
  caption: string;
  suffix?: string;
  /** When set, shown instead of `value` in the large tile text (e.g. long grade labels). */
  compactValue?: string;
}) {
  const colors = useColors();
  const displayValue = compactValue ?? value;
  const longValue = displayValue.length > 8;
  return (
    <View
      style={{
        flex: 1,
        minWidth: 96,
        paddingVertical: 12,
        paddingHorizontal: 11,
        borderRadius: 14,
        backgroundColor: colors.card,
        borderWidth: 1,
        borderColor: colors.border,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
        <Feather name={icon} size={12} color={valueColor} />
        <Text
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.8}
          style={{
            flexShrink: 1,
            color: colors.mutedForeground,
            fontFamily: FONT.medium,
            fontSize: 9.5,
            letterSpacing: 0.3,
            textTransform: "uppercase",
          }}
        >
          {label}
        </Text>
      </View>
      <Text
        numberOfLines={2}
        adjustsFontSizeToFit
        minimumFontScale={0.55}
        style={{
          color: valueColor,
          fontFamily: FONT.bold,
          fontSize: longValue ? 17 : 26,
          marginTop: 8,
          lineHeight: longValue ? 20 : 30,
        }}
      >
        {displayValue}
        {suffix ? (
          <Text style={{ color: colors.mutedForeground, fontFamily: FONT.bold, fontSize: 14 }}>
            {suffix}
          </Text>
        ) : null}
      </Text>
      <Text style={{ color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 10.5, marginTop: 4 }}>
        {caption}
      </Text>
    </View>
  );
}

function gradeBlurb(score: number | null): string {
  if (score == null) return "Not graded";
  if (score >= 8) return "Strong Value";
  if (score >= 6.5) return "Solid Value";
  if (score >= 5) return "Fair Value";
  return "Thin Value";
}
function confidenceBlurb(pct: number | null, composite?: number | null): string {
  if (pct == null) return "—";
  return confidenceTierLabel({ confidencePct: pct, composite });
}

// The header row of combined metrics: AI Grade, Confidence, and (when real)
// Edge %. Edge is omitted rather than shown as "—" when there is no genuine
// betting edge to report.
function HeaderTiles({
  data,
  gradeLabel,
  gradeCaption,
  simGradePending,
}: {
  data: CombinedPickScore;
  gradeLabel?: string | null;
  gradeCaption?: string | null;
  simGradePending?: boolean;
}) {
  const colors = useColors();
  const scoreColor = useScoreColor();
  const displayGrade = gradeLabel ?? data.grade ?? "—";
  const notRecommended = displayGrade === NOT_AI_RECOMMENDED || displayGrade === NOT_YET_AI_GRADED;
  const gradeColor = notRecommended ? colors.mutedForeground : scoreColor(data.composite);
  const edge = data.edgePct;
  const edgeColor =
    edge == null ? colors.mutedForeground : edge >= 0 ? colors.success : colors.destructive;
  return (
    <View style={{ flexDirection: "row", gap: 8 }}>
      {simGradePending ? null : (
        <MetricTile
          icon="award"
          label="AI Grade"
          value={displayGrade}
          compactValue={displayGrade === NOT_AI_RECOMMENDED ? NOT_AI_RECOMMENDED_COMPACT : undefined}
          valueColor={gradeColor}
          caption={gradeCaption ?? gradeBlurb(data.composite)}
        />
      )}
      <MetricTile
        icon="target"
        label="Confidence"
        value={data.confidencePct == null ? "—" : String(data.confidencePct)}
        valueColor={colors.primary}
        caption={confidenceBlurb(data.confidencePct, data.composite)}
      />
      {edge != null ? (
        <MetricTile
          icon="trending-up"
          label="Edge"
          value={`${edge >= 0 ? "+" : ""}${edge.toFixed(1)}`}
          valueColor={edgeColor}
          caption={edge >= 0 ? "Positive Edge" : "Negative Edge"}
          suffix="%"
        />
      ) : null}
    </View>
  );
}

// One labeled 1-10 bar. A null score reads "no data" over an empty track so the
// absence is explicit, never disguised as a low score.
function FactorBar({
  icon,
  label,
  score,
}: {
  icon: keyof typeof Feather.glyphMap;
  label: string;
  score: number | null;
}) {
  const colors = useColors();
  const scoreColor = useScoreColor();
  const fill = scoreColor(score);
  const pct = score == null ? 0 : Math.max(0, Math.min(1, score / 10));
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 5 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6, width: 116 }}>
        <Feather name={icon} size={13} color={colors.mutedForeground} />
        <Text style={{ color: colors.foreground, fontFamily: FONT.medium, fontSize: 12.5 }}>
          {label}
        </Text>
      </View>
      <View
        style={{
          flex: 1,
          height: 8,
          borderRadius: 999,
          backgroundColor: colors.border,
          overflow: "hidden",
        }}
      >
        {score != null ? (
          <View style={{ width: `${pct * 100}%`, height: "100%", backgroundColor: fill, borderRadius: 999 }} />
        ) : null}
      </View>
      <Text
        style={{
          width: 56,
          textAlign: "right",
          color: score == null ? colors.mutedForeground : fill,
          fontFamily: score == null ? FONT.medium : FONT.bold,
          fontSize: score == null ? 11 : 13,
        }}
      >
        {score == null ? "no data" : `${score.toFixed(1)}`}
      </Text>
    </View>
  );
}

export function ScoreBreakdown({
  data,
  variant = "full",
  title,
  note,
  simulationPending,
  simGradePending,
  gradeLabel,
  gradeCaption,
  propHolistic,
  pick,
}: {
  data: CombinedPickScore;
  variant?: "full" | "compact";
  title?: string;
  note?: string;
  simulationPending?: boolean;
  simGradePending?: boolean;
  gradeLabel?: string | null;
  gradeCaption?: string | null;
  /** Holistic prop factor breakdown — replaces the legacy 6-factor strip on prop cards. */
  propHolistic?: PropHolisticScore | null;
  /** Source pick for synthesizing holistic factors when propHolistic is absent. */
  pick?: ParsedPick;
}) {
  const colors = useColors();
  const scoreColor = useScoreColor();
  const present = FACTORS.filter((f) => data.scores[f.key] != null).length;
  const isPropCard = !!(pick?.isProp || pick?.player);
  const holisticDisplay =
    isPropCard && pick
      ? buildCoachCardHolistic(pick) ?? propHolistic ?? null
      : propHolistic ?? null;

  // Compact (cards): show nothing when the pick can't be graded at all, so a
  // card never carries an empty rubric.
  if (variant === "compact") {
    if (data.composite == null && !isPropCard) return null;
    if (data.composite == null && isPropCard && !holisticDisplay) return null;
    return (
      <View style={{ gap: 8 }}>
        <HeaderTiles
          data={data}
          gradeLabel={gradeLabel}
          gradeCaption={gradeCaption}
          simGradePending={simGradePending}
        />
        {simulationPending && !simGradePending ? (
          <Text
            style={{
              color: colors.mutedForeground,
              fontFamily: FONT.medium,
              fontSize: 11,
              fontStyle: "italic",
            }}
          >
            Simulation updating…
          </Text>
        ) : null}
        {holisticDisplay ? <HolisticFactorStrip holistic={holisticDisplay} /> : null}
      </View>
    );
  }

  // Full (detail pages): header tiles + all five bars + an honest footer note.
  return (
    <View
      style={{
        gap: 10,
        padding: 14,
        borderRadius: 16,
        backgroundColor: colors.card,
        borderWidth: 1,
        borderColor: colors.border,
      }}
    >
      <Text
        style={{
          color: colors.foreground,
          fontFamily: FONT.bold,
          fontSize: 13,
          letterSpacing: 0.4,
          textTransform: "uppercase",
        }}
      >
        {title ?? "Pick Score"}
      </Text>
      <HeaderTiles
        data={data}
        gradeLabel={gradeLabel}
        gradeCaption={gradeCaption}
        simGradePending={simGradePending}
      />
      {simulationPending && !simGradePending ? (
        <Text
          style={{
            color: colors.mutedForeground,
            fontFamily: FONT.medium,
            fontSize: 11,
            fontStyle: "italic",
          }}
        >
          Simulation updating…
        </Text>
      ) : null}
      <View style={{ marginTop: 2 }}>
        {FACTORS.map((f) => (
          <FactorBar key={f.key} icon={f.icon} label={f.label} score={data.scores[f.key]} />
        ))}
      </View>
      <Text style={{ color: colors.mutedForeground, fontFamily: FONT.body, fontSize: 10.5, lineHeight: 15 }}>
        {note ??
          (present === FACTORS.length
            ? "Grade blends all five signals from real feed data."
            : `Grade blends the ${present} signal${present === 1 ? "" : "s"} we could ground from real data; the rest are shown as no-data.`)}
      </Text>
    </View>
  );
}

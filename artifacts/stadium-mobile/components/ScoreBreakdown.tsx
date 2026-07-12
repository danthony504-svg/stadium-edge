import { Feather } from "@expo/vector-icons";
import { Text, View } from "react-native";

import { FONT } from "@/components/ui";
import { useColors } from "@/hooks/useColors";
import type { CombinedPickScore, PickSubScores } from "@/lib/pickScore";
import { confidenceTierLabel } from "@/lib/finalAiScore";
import type { ParsedPick } from "@/components/PickCard";
import type { PropHolisticScore } from "@/lib/propHolisticRecommendation";
import { propHolisticTopDrivers, resolvePropHolisticForDisplay, minimalPropHolisticForPick } from "@/lib/propHolisticRecommendation";
import { NOT_YET_AI_GRADED } from "@/lib/simMarketSupport";
import { NOT_AI_RECOMMENDED } from "@/lib/pickRecommendation";

// Renders the pick rubric plus combined AI Grade, Confidence, and Edge %.
// For player props with a holistic score, the compact strip shows all nine
// contextual factors (form, matchup, opponent, injury, minutes, weather, line
// move, value, sim) — missing signals render dim rather than disappearing.

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

const HOLISTIC_STRIP: Array<{ key: string; label: string }> = [
  { key: "recentForm", label: "Form" },
  { key: "matchup", label: "Match" },
  { key: "opponentTendency", label: "Opp" },
  { key: "injury", label: "Inj" },
  { key: "playingTime", label: "Min" },
  { key: "weather", label: "Wx" },
  { key: "lineMovement", label: "Move" },
  { key: "sportsbookValue", label: "Value" },
  { key: "simulation", label: "Sim" },
];

function HolisticFactorStrip({ holistic }: { holistic: PropHolisticScore }) {
  const colors = useColors();
  const scoreColor = useScoreColor();
  const factors = holistic.factors;
  const topKeys = new Set(
    factors
      .filter((f) => f.applicable && f.present && f.score != null)
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
      .slice(0, 3)
      .map((f) => f.key),
  );
  const drivers = propHolisticTopDrivers(holistic);
  return (
    <View style={{ gap: 5 }}>
      <Text style={{ color: colors.foreground, fontFamily: FONT.medium, fontSize: 10.5, lineHeight: 15 }}>
        {drivers}
      </Text>
      <View style={{ flexDirection: "row", gap: 3 }}>
        {HOLISTIC_STRIP.map((slot) => {
          const f = factors.find((x) => x.key === slot.key);
          const applicable = f?.applicable ?? true;
          if (!applicable) {
            return <View key={slot.key} style={{ flex: 1 }} />;
          }
          const present = f?.present && f.score != null;
          const s = f?.score ?? null;
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
        {holistic.coveragePct}% context grounded
        {holistic.missingCount > 0
          ? ` · ${holistic.missingCount} signal${holistic.missingCount === 1 ? "" : "s"} missing`
          : ""}
      </Text>
    </View>
  );
}

const FACTORS: Array<{ key: keyof PickSubScores; label: string; icon: keyof typeof Feather.glyphMap }> = [
  { key: "matchup", label: "Matchup", icon: "users" },
  { key: "trend", label: "Trend", icon: "trending-up" },
  { key: "lineValue", label: "Line Value", icon: "tag" },
  { key: "injury", label: "Injury Impact", icon: "activity" },
  { key: "lineShopping", label: "Line Shopping", icon: "shopping-cart" },
  { key: "simulation", label: "Model Sim", icon: "cpu" },
];

/** Five compact slots — line value + line shopping merge into one Value bar (no duplicate Line). */
const LEGACY_COMPACT_STRIP: Array<{
  key: string;
  label: string;
  scoreKeys: (keyof PickSubScores)[];
}> = [
  { key: "matchup", label: "Match", scoreKeys: ["matchup"] },
  { key: "trend", label: "Trend", scoreKeys: ["trend"] },
  { key: "value", label: "Value", scoreKeys: ["lineValue", "lineShopping"] },
  { key: "injury", label: "Inj", scoreKeys: ["injury"] },
  { key: "simulation", label: "Sim", scoreKeys: ["simulation"] },
];

function mergedStripScore(scores: PickSubScores, keys: (keyof PickSubScores)[]): number | null {
  const vals = keys.map((k) => scores[k]).filter((v): v is number => v != null);
  if (!vals.length) return null;
  return Math.max(...vals);
}

function LegacyCompactFactorStrip({ scores }: { scores: PickSubScores }) {
  const colors = useColors();
  const scoreColor = useScoreColor();
  return (
    <View style={{ flexDirection: "row", gap: 4 }}>
      {LEGACY_COMPACT_STRIP.map((slot) => {
        const s = mergedStripScore(scores, slot.scoreKeys);
        return (
          <View key={slot.key} style={{ flex: 1, alignItems: "center", gap: 3 }}>
            <View
              style={{
                width: "100%",
                height: 4,
                borderRadius: 999,
                backgroundColor: s == null ? colors.border : scoreColor(s),
                opacity: s == null ? 0.5 : 1,
              }}
            />
            <Text
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.7}
              style={{ color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 8.5 }}
            >
              {slot.label}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

function MetricTile({
  icon,
  label,
  value,
  valueColor,
  caption,
  suffix,
}: {
  icon: keyof typeof Feather.glyphMap;
  label: string;
  value: string;
  valueColor: string;
  caption: string;
  suffix?: string;
}) {
  const colors = useColors();
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
      <Text style={{ color: valueColor, fontFamily: FONT.bold, fontSize: 26, marginTop: 8 }}>
        {value}
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
  const holisticDisplay =
    pick?.isProp || pick?.player
      ? propHolistic ?? resolvePropHolisticForDisplay(pick) ?? (pick ? minimalPropHolisticForPick(pick) : null)
      : propHolistic ?? null;
  const isPropCard = !!(pick?.isProp || pick?.player);

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
        {isPropCard && holisticDisplay ? (
          <HolisticFactorStrip holistic={holisticDisplay} />
        ) : holisticDisplay ? (
          <HolisticFactorStrip holistic={holisticDisplay} />
        ) : (
          <LegacyCompactFactorStrip scores={data.scores} />
        )}
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

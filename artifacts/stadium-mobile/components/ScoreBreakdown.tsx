import { Feather } from "@expo/vector-icons";
import { Text, View } from "react-native";

import { FONT } from "@/components/ui";
import { useColors } from "@/hooks/useColors";
import type { CombinedPickScore, PickSubScores } from "@/lib/pickScore";

// Renders the 5-component pick rubric (Matchup / Trend / Line Value / Injury /
// Line-Shopping) plus the combined AI Grade, Confidence, and Edge % it rolls
// up into. EVERY value here is real or honestly absent: a sub-score the surface
// could not ground shows "no data" with an empty track, and the header omits
// Edge when there is no real betting edge to report. Nothing is fabricated.
//
// `variant="full"` (detail pages) shows the header tiles + all five labeled bars.
// `variant="compact"` (Coach / Props / Slip cards) shows just the header tiles +
// a thin five-segment strip, and renders nothing at all when the pick cannot be
// graded — keeping cards clean rather than showing an empty rubric.

const FACTORS: Array<{ key: keyof PickSubScores; label: string; icon: keyof typeof Feather.glyphMap }> = [
  { key: "matchup", label: "Matchup", icon: "users" },
  { key: "trend", label: "Trend", icon: "trending-up" },
  { key: "lineValue", label: "Line Value", icon: "tag" },
  { key: "injury", label: "Injury Impact", icon: "activity" },
  { key: "lineShopping", label: "Line Shopping", icon: "shopping-cart" },
];

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
function confidenceBlurb(pct: number | null): string {
  if (pct == null) return "—";
  if (pct >= 75) return "High Confidence";
  if (pct >= 60) return "Solid Confidence";
  if (pct >= 45) return "Moderate Confidence";
  return "Low Confidence";
}

// The header row of combined metrics: AI Grade, Confidence, and (when real)
// Edge %. Edge is omitted rather than shown as "—" when there is no genuine
// betting edge to report.
function HeaderTiles({ data }: { data: CombinedPickScore }) {
  const colors = useColors();
  const scoreColor = useScoreColor();
  const gradeColor = scoreColor(data.composite);
  const edge = data.edgePct;
  const edgeColor =
    edge == null ? colors.mutedForeground : edge >= 0 ? colors.success : colors.destructive;
  return (
    <View style={{ flexDirection: "row", gap: 8 }}>
      <MetricTile
        icon="award"
        label="AI Grade"
        value={data.grade ?? "—"}
        valueColor={gradeColor}
        caption={gradeBlurb(data.composite)}
      />
      <MetricTile
        icon="target"
        label="Confidence"
        value={data.confidencePct == null ? "—" : String(data.confidencePct)}
        valueColor={colors.primary}
        caption={confidenceBlurb(data.confidencePct)}
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
}: {
  data: CombinedPickScore;
  variant?: "full" | "compact";
  title?: string;
  note?: string;
}) {
  const colors = useColors();
  const scoreColor = useScoreColor();
  const present = FACTORS.filter((f) => data.scores[f.key] != null).length;

  // Compact (cards): show nothing when the pick can't be graded at all, so a
  // card never carries an empty rubric.
  if (variant === "compact") {
    if (data.composite == null) return null;
    return (
      <View style={{ gap: 8 }}>
        <HeaderTiles data={data} />
        <View style={{ flexDirection: "row", gap: 4 }}>
          {FACTORS.map((f) => {
            const s = data.scores[f.key];
            return (
              <View key={f.key} style={{ flex: 1, alignItems: "center", gap: 3 }}>
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
                  {f.label.split(" ")[0]}
                </Text>
              </View>
            );
          })}
        </View>
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
      <HeaderTiles data={data} />
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

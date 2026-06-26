import { Feather } from "@expo/vector-icons";
import { Text, View } from "react-native";
import Svg, { Circle } from "react-native-svg";

import { FONT } from "@/components/ui";
import { useColors } from "@/hooks/useColors";

// Premium, presentational-only visuals for the Player Props surfaces. Every
// component here is fed REAL pre-computed values by its caller and is null-safe:
// when there's no data it renders an honest empty/"no data" state rather than a
// fabricated number. Nothing in this file derives or invents a stat.

// A short opponent tag for a chart axis: drop a leading "@"/"vs", keep the team
// nickname, upper-cased and capped so the axis never overflows. Purely cosmetic.
function shortOpp(opp: string | null): string {
  if (!opp) return "—";
  const cleaned = opp.replace(/^@\s*/, "").replace(/^vs\.?\s*/i, "").trim();
  const word = cleaned.split(/\s+/).pop() ?? cleaned;
  return word.slice(0, 4).toUpperCase();
}

// Pick a tier color for a 0-100 confidence-style value.
function tierColor(
  value: number | null,
  colors: ReturnType<typeof useColors>,
  hi = 66,
  mid = 50,
): string {
  if (value == null) return colors.mutedForeground;
  if (value >= hi) return colors.success;
  if (value >= mid) return colors.primary;
  return colors.mutedForeground;
}

// Circular gauge (SVG). `value` is 0-100 or null. When null the ring shows an
// empty track and a muted "—" so the absence reads as "no data", never as zero.
export function ConfidenceRing({
  value,
  size = 108,
  stroke = 10,
  centerSub,
  color,
}: {
  value: number | null;
  size?: number;
  stroke?: number;
  centerSub?: string;
  color?: string;
}) {
  const colors = useColors();
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const pct = value == null ? 0 : Math.max(0, Math.min(100, value));
  const dash = (pct / 100) * circ;
  const ringColor = color ?? tierColor(value, colors, 66, 50);
  const cx = size / 2;
  const cy = size / 2;
  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      <Svg width={size} height={size} style={{ position: "absolute" }}>
        <Circle cx={cx} cy={cy} r={r} stroke={colors.border} strokeWidth={stroke} fill="none" />
        {value != null ? (
          <Circle
            cx={cx}
            cy={cy}
            r={r}
            stroke={ringColor}
            strokeWidth={stroke}
            fill="none"
            strokeLinecap="round"
            strokeDasharray={[dash, circ - dash]}
            transform={`rotate(-90, ${cx}, ${cy})`}
          />
        ) : null}
      </Svg>
      <View style={{ alignItems: "center" }}>
        <Text style={{ color: value == null ? colors.mutedForeground : ringColor, fontFamily: FONT.bold, fontSize: size * 0.3 }}>
          {value == null ? "—" : Math.round(value)}
        </Text>
        {centerSub ? (
          <Text
            style={{
              color: colors.mutedForeground,
              fontFamily: FONT.bold,
              fontSize: 9,
              letterSpacing: 0.6,
              textTransform: "uppercase",
              marginTop: 1,
            }}
          >
            {centerSub}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

export type TrendGame = {
  value: number;
  opp: string | null;
  date: string | null;
  isHome: boolean | null;
};

// Vertical bar chart of a player's REAL last-N values for one market, with the
// posted line drawn as a dashed marker. Bars that cleared the pick are accented
// green; misses are muted. Built with flex columns so it scales cleanly to any
// iPhone width with no clipping. Caller passes newest-first games; we render
// oldest→newest (left→right) so the most recent game sits on the right.
export function TrendBarChart({
  games,
  threshold,
  max,
  isUnder,
  height = 168,
}: {
  games: TrendGame[];
  threshold: number;
  max: number;
  isUnder: boolean;
  height?: number;
}) {
  const colors = useColors();
  if (games.length === 0) return null;
  const ordered = [...games].reverse();
  const domain = max > 0 ? max : 1;
  const linePct = Math.max(0, Math.min(1, threshold / domain));
  const hit = (v: number) => (isUnder ? v < threshold : v >= threshold);

  return (
    <View style={{ gap: 8 }}>
      <View style={{ height, flexDirection: "row" }}>
        {/* Plot area with the dashed posted-line marker overlaid. */}
        <View style={{ flex: 1, position: "relative" }}>
          {/* Dashed posted-line marker. */}
          <View
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              bottom: linePct * height,
              flexDirection: "row",
              alignItems: "center",
              gap: 3,
            }}
          >
            <View style={{ flex: 1, height: 0, borderTopWidth: 1.5, borderColor: colors.primary, borderStyle: "dashed", opacity: 0.8 }} />
            <View style={{ backgroundColor: colors.primary, borderRadius: 6, paddingHorizontal: 5, paddingVertical: 1 }}>
              <Text style={{ color: colors.primaryForeground, fontFamily: FONT.bold, fontSize: 9 }}>
                {threshold}
              </Text>
            </View>
          </View>
          {/* Bars. */}
          <View style={{ flex: 1, flexDirection: "row", alignItems: "flex-end", gap: 6 }}>
            {ordered.map((g, i) => {
              const h = Math.max(3, Math.min(1, g.value / domain) * height);
              const cleared = hit(g.value);
              return (
                <View key={i} style={{ flex: 1, alignItems: "center", justifyContent: "flex-end" }}>
                  <Text
                    numberOfLines={1}
                    style={{ color: colors.foreground, fontFamily: FONT.bold, fontSize: 9.5, marginBottom: 3 }}
                  >
                    {g.value % 1 === 0 ? g.value : g.value.toFixed(1)}
                  </Text>
                  <View
                    style={{
                      width: "100%",
                      maxWidth: 30,
                      height: h,
                      borderTopLeftRadius: 5,
                      borderTopRightRadius: 5,
                      backgroundColor: cleared ? colors.success : colors.border,
                      borderWidth: cleared ? 0 : 1,
                      borderColor: colors.border,
                      opacity: cleared ? 1 : 0.85,
                    }}
                  />
                </View>
              );
            })}
          </View>
        </View>
      </View>
      {/* X axis: opponent tags, oldest→newest. */}
      <View style={{ flexDirection: "row", gap: 6 }}>
        {ordered.map((g, i) => (
          <Text
            key={i}
            numberOfLines={1}
            style={{
              flex: 1,
              textAlign: "center",
              color: colors.mutedForeground,
              fontFamily: FONT.medium,
              fontSize: 8.5,
            }}
          >
            {shortOpp(g.opp)}
          </Text>
        ))}
      </View>
      {/* Legend. */}
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 14, marginTop: 2 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
          <View style={{ width: 9, height: 9, borderRadius: 2, backgroundColor: colors.success }} />
          <Text style={{ color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 10 }}>
            {isUnder ? "Under" : "Over"} line
          </Text>
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
          <View style={{ width: 9, height: 9, borderRadius: 2, backgroundColor: colors.border }} />
          <Text style={{ color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 10 }}>Missed</Text>
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
          <Feather name="arrow-right" size={11} color={colors.mutedForeground} />
          <Text style={{ color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 10 }}>Recent</Text>
        </View>
      </View>
    </View>
  );
}

// A horizontal range bar showing the player's REAL low→high spread over the
// window, with the average (projection) and the posted line marked. All inputs
// are real numbers; renders nothing when there are no games.
export function ProjectedRangeBar({
  values,
  projection,
  threshold,
  max,
}: {
  values: number[];
  projection: number | null;
  threshold: number;
  max: number;
}) {
  const colors = useColors();
  if (values.length === 0 || projection == null) return null;
  const domain = max > 0 ? max : 1;
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const pos = (v: number): `${number}%` => `${Math.max(0, Math.min(1, v / domain)) * 100}%`;
  const rangeLeft: `${number}%` = `${Math.max(0, Math.min(1, lo / domain)) * 100}%`;
  const rangeWidth: `${number}%` = `${Math.max(2, (Math.max(0, Math.min(1, hi / domain)) - Math.max(0, Math.min(1, lo / domain))) * 100)}%`;
  const fmt = (v: number) => (v % 1 === 0 ? String(v) : v.toFixed(1));

  return (
    <View style={{ gap: 8 }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
        <Text style={{ color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 11 }}>
          Low {fmt(lo)}
        </Text>
        <Text style={{ color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 11 }}>
          High {fmt(hi)}
        </Text>
      </View>
      <View style={{ height: 14, justifyContent: "center" }}>
        {/* Track. */}
        <View style={{ height: 6, borderRadius: 999, backgroundColor: colors.border }} />
        {/* Range fill. */}
        <View
          style={{
            position: "absolute",
            left: rangeLeft,
            width: rangeWidth,
            height: 6,
            borderRadius: 999,
            backgroundColor: colors.primary,
            opacity: 0.35,
          }}
        />
        {/* Posted line marker. */}
        <View style={{ position: "absolute", left: pos(threshold), width: 2, height: 14, backgroundColor: colors.foreground, opacity: 0.55 }} />
        {/* Projection (average) marker. */}
        <View
          style={{
            position: "absolute",
            left: pos(projection),
            width: 12,
            height: 12,
            borderRadius: 6,
            marginLeft: -6,
            backgroundColor: colors.primary,
            borderWidth: 2,
            borderColor: colors.background,
          }}
        />
      </View>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 16 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
          <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: colors.primary }} />
          <Text style={{ color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 10.5 }}>
            Projected {fmt(projection)}
          </Text>
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
          <View style={{ width: 2, height: 11, backgroundColor: colors.foreground, opacity: 0.6 }} />
          <Text style={{ color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 10.5 }}>
            Line {fmt(threshold)}
          </Text>
        </View>
      </View>
    </View>
  );
}

// Compact "rich card" stat tile used on list rail cards: an uppercase label over
// a colored value. Caller supplies real values; a null value shows "—".
export function MiniStat({
  label,
  value,
  valueColor,
  icon,
}: {
  label: string;
  value: string;
  valueColor?: string;
  icon?: keyof typeof Feather.glyphMap;
}) {
  const colors = useColors();
  return (
    <View style={{ flex: 1, alignItems: "center", gap: 2 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
        {icon ? <Feather name={icon} size={9} color={colors.mutedForeground} /> : null}
        <Text
          numberOfLines={1}
          style={{ color: colors.mutedForeground, fontFamily: FONT.bold, fontSize: 8.5, letterSpacing: 0.4, textTransform: "uppercase" }}
        >
          {label}
        </Text>
      </View>
      <Text style={{ color: valueColor ?? colors.foreground, fontFamily: FONT.bold, fontSize: 14 }}>
        {value}
      </Text>
    </View>
  );
}

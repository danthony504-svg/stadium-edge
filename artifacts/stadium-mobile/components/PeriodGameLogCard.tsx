import { Text, View } from "react-native";

import { useColors } from "@/hooks/useColors";
import type { StatMuseGameLog } from "@/lib/api";
import { FONT } from "@/components/ui";

// Real game-by-game PERIOD breakdown (e.g. "first quarter points, last 5
// games"). ESPN game logs only carry full-game totals, so these per-period rows
// come from StatMuse's results grid. Every value is real; totals/averages are
// derived from those real values, never fabricated. The card also carries the
// resolved player name (StatMuse may not echo it).
export type PeriodGameLogCardData = StatMuseGameLog & {
  player: string | null;
  opponent?: string | null;
};

const cap = (s: string | null) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : "");

const fmtDate = (d: string) => {
  const m = String(d).match(/^(\d{1,2})\/(\d{1,2})/);
  return m ? `${m[1]}/${m[2]}` : d;
};

export function PeriodGameLogCard({ data }: { data: PeriodGameLogCardData }) {
  const colors = useColors();
  const { player, period, stat, opponent, rows = [] } = data || ({} as PeriodGameLogCardData);
  const nums = rows
    .map((r) => parseFloat(String(r.value).replace(/[^0-9.\-]/g, "")))
    .filter((n) => Number.isFinite(n));
  const total = nums.reduce((a, b) => a + b, 0);
  const avg = nums.length ? total / nums.length : 0;
  const title = `${cap(period)}${period ? " " : ""}${stat || "points"}`.trim();

  // Only claim an opponent filter when one was requested AND every returned row
  // shares the same opponent — then label it with the REAL abbreviation from the
  // rows (e.g. "vs NYK"), never the unverified requested name. If StatMuse came
  // back with mixed opponents, we don't mislabel it as filtered.
  const opps = rows.map((r) => (r.opp || "").toUpperCase()).filter(Boolean);
  const uniformOpp =
    opps.length > 0 && opps.every((o) => o === opps[0]) ? opps[0] : null;
  const oppLabel = opponent && uniformOpp ? ` vs ${uniformOpp}` : "";

  return (
    <View
      style={{
        borderRadius: colors.radius,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.card,
        padding: 14,
      }}
    >
      <Text style={{ color: colors.primary, fontFamily: FONT.medium, fontSize: 10, letterSpacing: 0.5 }}>
        GAME BY GAME
      </Text>
      <Text style={{ color: colors.foreground, fontFamily: FONT.display, fontSize: 16, marginTop: 2 }}>
        {player || "Player"}
      </Text>
      <Text style={{ color: colors.mutedForeground, fontFamily: FONT.body, fontSize: 12, marginBottom: 10 }}>
        {title} · last {rows.length} game{rows.length === 1 ? "" : "s"}
        {oppLabel}
      </Text>

      {rows.map((r, i) => (
        <View
          key={i}
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            paddingVertical: 7,
            borderTopWidth: i === 0 ? 0 : 1,
            borderTopColor: colors.border,
          }}
        >
          <Text style={{ width: 48, color: colors.mutedForeground, fontFamily: FONT.body, fontSize: 13 }}>
            {fmtDate(r.date)}
          </Text>
          <Text
            numberOfLines={1}
            style={{ flex: 1, textAlign: "center", color: colors.foreground, fontFamily: FONT.body, fontSize: 13 }}
          >
            {r.loc ? `${r.loc} ` : ""}
            {r.opp}
          </Text>
          <Text
            style={{
              width: 44,
              textAlign: "right",
              color: colors.foreground,
              fontFamily: FONT.bold,
              fontSize: 13,
              fontVariant: ["tabular-nums"],
            }}
          >
            {r.value}
          </Text>
        </View>
      ))}

      {nums.length > 0 && (
        <View
          style={{
            flexDirection: "row",
            justifyContent: "space-between",
            marginTop: 10,
            paddingTop: 8,
            borderTopWidth: 1,
            borderTopColor: colors.border,
          }}
        >
          <Text style={{ color: colors.mutedForeground, fontFamily: FONT.body, fontSize: 12 }}>
            Total <Text style={{ color: colors.foreground, fontFamily: FONT.semibold }}>{total}</Text>
          </Text>
          <Text style={{ color: colors.mutedForeground, fontFamily: FONT.body, fontSize: 12 }}>
            Avg <Text style={{ color: colors.foreground, fontFamily: FONT.semibold }}>{avg.toFixed(1)}</Text>
          </Text>
        </View>
      )}
      <Text style={{ color: colors.mutedForeground, fontFamily: FONT.body, fontSize: 10, marginTop: 8 }}>
        Real per-game data — period splits aren&apos;t in ESPN game logs.
      </Text>
    </View>
  );
}

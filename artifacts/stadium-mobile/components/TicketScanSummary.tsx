import { Feather } from "@expo/vector-icons";
import { Text, View } from "react-native";

import { useColors } from "@/hooks/useColors";
import { FONT } from "@/components/ui";
import {
  computeTicketScan,
  type TicketLeg,
  type TicketLegRef,
} from "@/lib/ticketScan";
import { parseEdgeStats } from "@/components/PickCard";
import { deriveConfidenceScore } from "@/lib/confidence";

export type TicketScanLeg = {
  pick: string;
  odds: number;
  edge?: string;
};

const pct = (p: number): string => `${Math.round(p * 1000) / 10}%`;

// A compact summary the Coach shows the instant a slip scan starts: real leg
// count + metrics derived only from the slip's own odds and the model's own
// stated edges. While the deep analysis is still streaming, derived rows read
// "Calculating…"; they resolve to real numbers (never fabricated) below.
export function TicketScanSummary({
  legs,
  loading,
}: {
  legs: TicketScanLeg[];
  loading?: boolean;
}) {
  const colors = useColors();
  const scan = computeTicketScan(
    legs.map<TicketLeg>((l) => {
      const edgePct = parseEdgeStats(l.edge).edge;
      // Grade each leg with the SAME win-chance confidence the pick cards use, so
      // "Highest Confidence Leg" stays consistent with the rest of the app.
      const confidence = deriveConfidenceScore(edgePct, l.odds);
      return { pick: l.pick, odds: l.odds, edgePct, confidence };
    }),
  );

  const calc = (
    <Text style={{ color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 13 }}>
      Calculating…
    </Text>
  );

  const valueText = (s: string, color?: string) => (
    <Text
      numberOfLines={1}
      style={{
        color: color ?? colors.foreground,
        fontFamily: FONT.semibold,
        fontSize: 13,
        flexShrink: 1,
        textAlign: "right",
      }}
    >
      {s}
    </Text>
  );

  const legValue = (ref: TicketLegRef | null) => {
    if (loading) return calc;
    if (!ref) return valueText("—", colors.mutedForeground);
    const sub = ref.mode === "conf" ? `${ref.metric.toFixed(1)}/10` : pct(ref.metric);
    return (
      <View style={{ flexDirection: "row", alignItems: "baseline", gap: 6, flexShrink: 1 }}>
        {valueText(ref.pick)}
        <Text style={{ color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 12 }}>
          {sub}
        </Text>
      </View>
    );
  };

  const rows: { label: string; value: React.ReactNode }[] = [
    {
      label: "Legs",
      value: valueText(String(scan.count)),
    },
    {
      label: "Estimated Hit Rate",
      value: loading
        ? calc
        : scan.hitRate == null
          ? valueText("—", colors.mutedForeground)
          : valueText(pct(scan.hitRate)),
    },
    {
      label: "Highest Confidence Leg",
      value: legValue(scan.highest),
    },
    {
      label: "Weakest Leg",
      value: legValue(scan.weakest),
    },
    {
      label: "Average Edge",
      value: loading
        ? calc
        : scan.avgEdge == null
          ? valueText("—", colors.mutedForeground)
          : valueText(
              `${scan.avgEdge >= 0 ? "+" : ""}${scan.avgEdge}%`,
              scan.avgEdge >= 0 ? colors.success : colors.destructive,
            ),
    },
  ];

  return (
    <View
      style={{
        alignSelf: "stretch",
        backgroundColor: colors.card,
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: 16,
        paddingHorizontal: 14,
        paddingVertical: 12,
        gap: 10,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Feather name="search" size={15} color={colors.accent} />
        <Text style={{ color: colors.foreground, fontFamily: FONT.semibold, fontSize: 14 }}>
          Ticket Scan
        </Text>
      </View>
      <View style={{ gap: 8 }}>
        {rows.map((r) => (
          <View
            key={r.label}
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
            }}
          >
            <Text
              style={{ color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 13 }}
            >
              {r.label}
            </Text>
            {r.value}
          </View>
        ))}
      </View>
    </View>
  );
}

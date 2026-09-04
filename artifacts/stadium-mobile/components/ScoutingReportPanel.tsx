import { Text, View } from "react-native";

import { useColors } from "@/hooks/useColors";
import { FONT } from "@/components/ui";
import type { ScoutingReport } from "@/lib/scoutingReport";

function verdictLabel(v: ScoutingReport["priceVerdict"]): string {
  if (!v) return "Not available";
  if (v === "underpriced") return "Underpriced / valuable";
  if (v === "overpriced") return "Overpriced";
  return "Fair";
}

export function ScoutingReportPanel({ report }: { report: ScoutingReport }) {
  const colors = useColors();
  const asOf = (() => {
    try {
      return new Date(report.asOf).toLocaleString();
    } catch {
      return report.asOf;
    }
  })();

  return (
    <View
      style={{
        backgroundColor: colors.card,
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: 16,
        overflow: "hidden",
        gap: 0,
      }}
    >
      <View
        style={{
          padding: 14,
          borderBottomWidth: 1,
          borderBottomColor: colors.border,
          backgroundColor: colors.surface,
          gap: 4,
        }}
      >
        <Text style={{ color: colors.foreground, fontFamily: FONT.display, fontSize: 17 }}>
          Scouting Report — {report.title}
        </Text>
        <Text style={{ color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 12 }}>
          {report.subtitle}
        </Text>
        <Text style={{ color: colors.primary, fontFamily: FONT.medium, fontSize: 11 }}>
          Updated {asOf}
        </Text>
        <Text style={{ color: colors.mutedForeground, fontFamily: FONT.body, fontSize: 11 }}>
          Sources: {report.sources.join(" · ")}
        </Text>
      </View>

      <View style={{ padding: 14, gap: 10, borderBottomWidth: 1, borderBottomColor: colors.border }}>
        <Text style={{ color: colors.foreground, fontFamily: FONT.semibold, fontSize: 13 }}>
          Market vs model
        </Text>
        <Row label="Market expects" value={report.marketExpectation} colors={colors} />
        <Row label="Model expects" value={report.modelExpectation} colors={colors} />
        <Row label="Price" value={verdictLabel(report.priceVerdict)} colors={colors} />
        <Row label="AI grade" value={report.aiGrade} colors={colors} />
        <Row label="Confidence" value={report.confidencePct != null ? `${report.confidencePct}%` : null} colors={colors} />
        <Row label="Risk" value={report.riskLevel} colors={colors} />
      </View>

      {report.sections.map((sec) => (
        <View
          key={sec.title}
          style={{ padding: 14, gap: 8, borderBottomWidth: 1, borderBottomColor: colors.border }}
        >
          <Text style={{ color: colors.foreground, fontFamily: FONT.semibold, fontSize: 13 }}>
            {sec.title}
          </Text>
          {sec.fields.map((f) => (
            <Row key={f.label} label={f.label} value={f.value} colors={colors} />
          ))}
        </View>
      ))}
    </View>
  );
}

function Row({
  label,
  value,
  colors,
}: {
  label: string;
  value: string | null;
  colors: ReturnType<typeof useColors>;
}) {
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 10 }}>
      <Text style={{ color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 12, flex: 1 }}>
        {label}
      </Text>
      <Text
        style={{
          color: value ? colors.foreground : colors.mutedForeground,
          fontFamily: FONT.semibold,
          fontSize: 12,
          flex: 1.1,
          textAlign: "right",
        }}
      >
        {value ?? "Not available"}
      </Text>
    </View>
  );
}

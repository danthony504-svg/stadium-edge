import { Text, View } from "react-native";
import { FONT } from "@/components/ui";
import { useColors } from "@/hooks/useColors";
import type { PropSimulationResult } from "@/lib/api";

export function PropProjectionBreakdown({
  breakdown,
}: { breakdown?: PropSimulationResult["projectionBreakdown"] }) {
  const colors = useColors();
  const comparable = breakdown?.comparable;
  if (!breakdown) return null;

  const { baseline, adjusted, expectedCarries, matchupPenalty, workloadComparison } = breakdown;
  const matchupChange = ((comparable?.multiplier ?? 1) - 1) * 100;
  const games = `${comparable?.games ?? 0} comparable opponent ${comparable?.games === 1 ? "game" : "games"}`;
  const details = [
    !comparable || comparable.status === "unsupported" ? "Comparable-player adjustment unavailable"
      : comparable.status === "missing" ? "Comparable opponent data unavailable"
      : comparable.status === "limited" ? `${games} · Sample too small for an adjustment`
        : `${games} · Matched by position and ${comparable.workload}`,
    comparable?.workload === "carries" && matchupPenalty != null && matchupPenalty > 0
      ? `Matchup penalty ${matchupPenalty.toFixed(1)} yards`
      : comparable?.status === "applied" && Math.abs(matchupChange) >= 0.05
        ? `Comparable matchup ${matchupChange > 0 ? "+" : ""}${matchupChange.toFixed(1)}%` : null,
    comparable?.workload === "carries"
      ? expectedCarries == null ? "Expected carries unavailable" : `Expected carries ${expectedCarries.toFixed(1)}`
      : null,
    breakdown.expectedCarriesEvidence
      ? `${breakdown.expectedCarriesEvidence.source} · ${breakdown.expectedCarriesEvidence.capturedAt}` : null,
    workloadComparison && workloadComparison.yardsGained > 0
      ? `Expected workload adds ${workloadComparison.yardsGained.toFixed(1)} yards`
        + (workloadComparison.offset === "full" ? " · Full penalty offset"
          : workloadComparison.offset === "partial" ? " · Partial penalty offset" : "")
      : null,
  ].filter(Boolean);

  return (
    <View accessibilityLabel="Projection breakdown" style={{ gap: 3, paddingVertical: 4 }}>
      <Text style={{ color: colors.foreground, fontFamily: FONT.semibold, fontSize: 12 }}>
        Recent-form baseline {baseline.toFixed(1)} · Adjusted projection {adjusted.toFixed(1)}
      </Text>
      {[...new Set([...details, ...breakdown.reasons])].map((detail) => (
        <Text key={detail} style={{ color: colors.mutedForeground, fontFamily: FONT.body, fontSize: 11 }}>
          {detail}
        </Text>
      ))}
    </View>
  );
}

import React from "react";
import { Text, View } from "react-native";

import { Badge, Card, FONT } from "@/components/ui";
import { useColors } from "@/hooks/useColors";

export type FantasyPlayerAnalysis = {
  projectedPoints?: number | null;
  simulationAverage?: number | null;
  floor?: number | null;
  ceiling?: number | null;
  boomProbability?: number | null;
  bustProbability?: number | null;
  matchupGrade?: string | null;
  opportunityGrade?: string | null;
  confidence?: number | null;
  recommendation?: string | null;
  why?: string | null;
  injuryStatus?: string | null;
  dataNote?: string | null;
};

export type FantasyPlayerCardData = FantasyPlayerAnalysis & {
  name: string;
  team?: string | null;
  position?: string | null;
  opponent?: string | null;
};

const metric = (value: number | null | undefined, suffix = "") =>
  value == null || !Number.isFinite(value) ? "Data unavailable" : `${value.toFixed(1)}${suffix}`;

/** Reusable, data-honest player analysis card. Missing backend evidence stays unavailable. */
export function FantasyPlayerCard({ player }: { player: FantasyPlayerCardData }) {
  const colors = useColors();
  const hasAnalysis = Object.values({
    projectedPoints: player.projectedPoints,
    simulationAverage: player.simulationAverage,
    floor: player.floor,
    ceiling: player.ceiling,
  }).some((value) => value != null);
  return (
    <Card style={{ gap: 12 }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 12 }}>
        <View style={{ flex: 1 }}>
          <Text style={{ color: colors.foreground, fontFamily: FONT.semibold, fontSize: 17 }}>
            {player.name}
          </Text>
          <Text style={{ color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 13, marginTop: 3 }}>
            {[player.team, player.position].filter(Boolean).join(" • ") || "NFL player"}
            {player.opponent ? ` · vs ${player.opponent}` : ""}
          </Text>
        </View>
        {player.recommendation ? <Badge label={player.recommendation} tone="success" /> : null}
      </View>
      {!hasAnalysis ? (
        <Text style={{ color: colors.mutedForeground, fontFamily: FONT.body, fontSize: 14 }}>
          Data unavailable
        </Text>
      ) : (
        <>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {[
              ["Projection", metric(player.projectedPoints, " FP")],
              ["Recent Avg", metric(player.simulationAverage, " FP")],
              ["Floor", metric(player.floor)],
              ["Ceiling", metric(player.ceiling)],
              ["Boom", metric(player.boomProbability, "%")],
              ["Bust", metric(player.bustProbability, "%")],
            ].map(([label, value]) => (
              <View key={label} style={{ minWidth: "30%" }}>
                <Text style={{ color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 11 }}>{label}</Text>
                <Text style={{ color: colors.foreground, fontFamily: FONT.semibold, fontSize: 14 }}>{value}</Text>
              </View>
            ))}
          </View>
          <Text style={{ color: colors.mutedForeground, fontFamily: FONT.body, fontSize: 13 }}>
            Matchup: {player.matchupGrade ?? "Data unavailable"} · Opportunity: {player.opportunityGrade ?? "Data unavailable"} · AI confidence: {metric(player.confidence, "/10")}
          </Text>
          <Text style={{ color: colors.mutedForeground, fontFamily: FONT.body, fontSize: 13 }}>
            Injury: {player.injuryStatus ?? "Unavailable"} · Snap share, targets/touches and red-zone usage: unavailable
          </Text>
          {player.why ? <Text style={{ color: colors.foreground, fontFamily: FONT.body, fontSize: 13 }}>{player.why}</Text> : null}
          {player.dataNote ? <Text style={{ color: colors.mutedForeground, fontFamily: FONT.body, fontSize: 12 }}>{player.dataNote}</Text> : null}
        </>
      )}
    </Card>
  );
}

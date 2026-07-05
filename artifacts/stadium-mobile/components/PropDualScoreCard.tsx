import { Feather } from "@expo/vector-icons";
import { Text, View } from "react-native";

import { FONT } from "@/components/ui";
import { useColors } from "@/hooks/useColors";
import type { PropDualScore } from "@/lib/propDualScore";

function scoreTone(score: number | null, colors: ReturnType<typeof useColors>) {
  if (score == null) return colors.mutedForeground;
  if (score >= 62) return colors.success;
  if (score >= 55) return colors.primary;
  if (score >= 48) return colors.warning;
  return colors.destructive;
}

function FactorRow({
  label,
  display,
  sub,
  last,
}: {
  label: string;
  display: string | null;
  sub: number | null;
  last?: boolean;
}) {
  const colors = useColors();
  if (sub == null) return null;
  const tone = scoreTone(Math.round(sub * 100), colors);
  return (
    <View
      style={{
        gap: 4,
        paddingBottom: last ? 0 : 8,
        borderBottomWidth: last ? 0 : 1,
        borderBottomColor: colors.border,
      }}
    >
      <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
        <Text style={{ color: colors.foreground, fontFamily: FONT.medium, fontSize: 12, flex: 1 }}>
          {label}
        </Text>
        <Text style={{ color: tone, fontFamily: FONT.bold, fontSize: 12 }} numberOfLines={1}>
          {display ?? "—"}
        </Text>
      </View>
      <View
        style={{
          height: 4,
          borderRadius: 2,
          backgroundColor: colors.border,
          overflow: "hidden",
        }}
      >
        <View
          style={{
            width: `${Math.round(sub * 100)}%`,
            height: "100%",
            backgroundColor: tone,
            borderRadius: 2,
          }}
        />
      </View>
    </View>
  );
}

export function PropDualScoreCard({ data }: { data: PropDualScore }) {
  const colors = useColors();
  const playerTone = scoreTone(data.playerScore, colors);
  const matchupTone = scoreTone(data.matchupScore, colors);
  const verdictTone = data.recommends ? colors.success : colors.destructive;
  const playerFactors = data.playerFactors.filter((f) => f.sub != null);
  const matchupFactors = data.matchupFactors.filter((f) => f.sub != null);
  const hasAny = data.playerScore != null || data.matchupScore != null;
  if (!hasAny) return null;

  return (
    <View
      style={{
        backgroundColor: colors.surface,
        borderColor: verdictTone,
        borderWidth: 1,
        borderRadius: colors.radius,
        padding: 14,
        gap: 12,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
        <View style={{ flex: 1, gap: 4 }}>
          <Text style={{ color: colors.mutedForeground, fontFamily: FONT.bold, fontSize: 11, letterSpacing: 0.8 }}>
            PLAYER + MATCHUP SCORE
          </Text>
          <Text style={{ color: verdictTone, fontFamily: FONT.bold, fontSize: 14 }}>{data.headline}</Text>
          <Text style={{ color: colors.mutedForeground, fontFamily: FONT.body, fontSize: 11, lineHeight: 16 }}>
            {data.explanation}
          </Text>
        </View>
        <Feather
          name={data.recommends ? "check-circle" : "x-circle"}
          size={22}
          color={verdictTone}
        />
      </View>

      <View style={{ flexDirection: "row", gap: 10 }}>
        <View
          style={{
            flex: 1,
            padding: 12,
            borderRadius: 12,
            backgroundColor: colors.card,
            borderWidth: 1,
            borderColor: colors.border,
            alignItems: "center",
            gap: 4,
          }}
        >
          <Text style={{ color: colors.mutedForeground, fontFamily: FONT.bold, fontSize: 9, letterSpacing: 0.5 }}>
            PLAYER SCORE
          </Text>
          <Text style={{ color: playerTone, fontFamily: FONT.display, fontSize: 28, lineHeight: 30 }}>
            {data.playerScore ?? "—"}
          </Text>
          <Text style={{ color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 10 }}>
            form · sim · grade · edge
          </Text>
        </View>
        <View
          style={{
            flex: 1,
            padding: 12,
            borderRadius: 12,
            backgroundColor: colors.card,
            borderWidth: 1,
            borderColor: colors.border,
            alignItems: "center",
            gap: 4,
          }}
        >
          <Text style={{ color: colors.mutedForeground, fontFamily: FONT.bold, fontSize: 9, letterSpacing: 0.5 }}>
            MATCHUP SCORE
          </Text>
          <Text style={{ color: matchupTone, fontFamily: FONT.display, fontSize: 28, lineHeight: 30 }}>
            {data.matchupScore ?? "—"}
          </Text>
          <Text style={{ color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 10 }}>
            pitcher · park · defense · lean
          </Text>
        </View>
      </View>

      {playerFactors.length > 0 ? (
        <View style={{ gap: 6 }}>
          <Text style={{ color: colors.mutedForeground, fontFamily: FONT.bold, fontSize: 10, letterSpacing: 0.6 }}>
            PLAYER FACTORS
          </Text>
          {playerFactors.map((f, i) => (
            <FactorRow
              key={f.key}
              label={f.label}
              display={f.display}
              sub={f.sub}
              last={i === playerFactors.length - 1}
            />
          ))}
        </View>
      ) : null}

      {matchupFactors.length > 0 ? (
        <View style={{ gap: 6 }}>
          <Text style={{ color: colors.mutedForeground, fontFamily: FONT.bold, fontSize: 10, letterSpacing: 0.6 }}>
            MATCHUP FACTORS
          </Text>
          {matchupFactors.map((f, i) => (
            <FactorRow
              key={f.key}
              label={f.label}
              display={f.display}
              sub={f.sub}
              last={i === matchupFactors.length - 1}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}

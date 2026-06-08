import { Text, View } from "react-native";

import { FONT } from "@/components/ui";
import { useColors } from "@/hooks/useColors";
import { TIER_META, type PropFactor } from "@/lib/propFactors";

// Shared two-column advisory grid used by both the player prop detail page and
// the team props sheet. Pure presentation — the cards carry only advisory text.
export function FactorGrid({ factors }: { factors: PropFactor[] }) {
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
      {factors.map((f, i) => (
        <FactorCard key={i} factor={f} />
      ))}
    </View>
  );
}

function FactorCard({ factor }: { factor: PropFactor }) {
  const colors = useColors();
  const tint =
    factor.tier === "critical"
      ? colors.destructive
      : factor.tier === "important"
        ? colors.warning
        : colors.mutedForeground;
  const meta = TIER_META[factor.tier];
  return (
    <View
      style={{
        // Two columns: half the row minus the 10px gap.
        width: "47.5%",
        flexGrow: 1,
        backgroundColor: colors.card,
        borderColor: colors.border,
        borderWidth: 1,
        borderTopColor: tint,
        borderTopWidth: 2,
        borderRadius: colors.radius,
        padding: 12,
        gap: 7,
      }}
    >
      <Text style={{ color: tint, fontFamily: FONT.bold, fontSize: 9, letterSpacing: 0.8 }}>
        {meta.prefix} {meta.label}
      </Text>
      <Text style={{ fontSize: 18 }}>{factor.emoji}</Text>
      <Text style={{ color: colors.foreground, fontFamily: FONT.bold, fontSize: 13, lineHeight: 17 }}>
        {factor.title}
      </Text>
      <Text style={{ color: colors.mutedForeground, fontFamily: FONT.body, fontSize: 11, lineHeight: 16 }}>
        {factor.body}
      </Text>
    </View>
  );
}

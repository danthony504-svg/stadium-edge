import { ActivityIndicator, Text, View } from "react-native";

import { FONT } from "@/components/ui";
import { useColors } from "@/hooks/useColors";

/**
 * Minimal build progress — one job, one headline, no staged limbo checklist.
 * Cards (or an honest empty/shortfall note) replace this once the session latches.
 */
export function CoachBuildProgress({
  requestedLegs,
  status,
}: {
  requestedLegs: number;
  status: string;
}) {
  const colors = useColors();
  return (
    <View
      style={{
        marginHorizontal: 16,
        marginTop: 12,
        padding: 16,
        borderRadius: 14,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.card,
        gap: 10,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        <ActivityIndicator color={colors.primary} />
        <Text
          style={{
            flex: 1,
            color: colors.foreground,
            fontFamily: FONT.semibold,
            fontSize: 15,
          }}
        >
          {requestedLegs >= 3
            ? `Building your ${requestedLegs}-leg ticket…`
            : "Working on your ask…"}
        </Text>
      </View>
      <Text
        style={{
          color: colors.mutedForeground,
          fontFamily: FONT.body,
          fontSize: 13,
          lineHeight: 18,
        }}
      >
        {status}
      </Text>
    </View>
  );
}

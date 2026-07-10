import { useState } from "react";
import { Image, Text, View } from "react-native";

import { FONT } from "@/components/ui";
import { useColors } from "@/hooks/useColors";

function initials(name: string): string {
  return (name || "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(-2)
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 3);
}

/** UFC feed/sim row avatar — circular face crop or initials fallback. */
export function FighterAvatar({
  uri,
  name,
  size = 24,
  photo = false,
}: {
  uri?: string | null;
  name: string;
  size?: number;
  photo?: boolean;
}) {
  const colors = useColors();
  const [failed, setFailed] = useState(false);
  const show = uri && !failed;

  if (show) {
    return (
      <Image
        source={{ uri }}
        style={{
          width: size,
          height: size,
          borderRadius: photo ? size / 2 : 6,
          backgroundColor: colors.surface,
        }}
        resizeMode={photo ? "cover" : "contain"}
        onError={() => setFailed(true)}
      />
    );
  }

  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: photo ? size / 2 : 6,
        backgroundColor: colors.surface,
        borderWidth: 1,
        borderColor: colors.border,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Text style={{ color: colors.mutedForeground, fontFamily: FONT.bold, fontSize: size * 0.38 }}>
        {initials(name)}
      </Text>
    </View>
  );
}

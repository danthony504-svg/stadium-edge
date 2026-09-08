import { Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { FONT } from "@/components/ui";
import { BUNDLE_IDENTITY } from "@/lib/bundleIdentity";

/** Temporary dev bundle label — confirms phone is on the expected Metro commit. */
export function BundleIdentityBanner() {
  const insets = useSafeAreaInsets();

  return (
    <View
      pointerEvents="none"
      style={{
        position: "absolute",
        top: insets.top + 4,
        left: 8,
        right: 8,
        zIndex: 10000,
        backgroundColor: "rgba(220,38,38,0.92)",
        borderRadius: 6,
        paddingHorizontal: 8,
        paddingVertical: 4,
      }}
    >
      <Text
        selectable
        style={{
          color: "#fff",
          fontFamily: FONT.medium,
          fontSize: 10,
          lineHeight: 13,
          textAlign: "center",
        }}
      >
        {`bundle ${BUNDLE_IDENTITY.branch} · ${BUNDLE_IDENTITY.commit} · ${BUNDLE_IDENTITY.builtAt}`}
      </Text>
    </View>
  );
}

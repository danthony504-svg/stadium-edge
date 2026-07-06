import * as Updates from "expo-updates";
import { addUpdatesStateChangeListener, latestContext } from "expo-updates";
import { useEffect, useState, type ReactNode } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { FONT } from "@/components/ui";
import { clearDiscoverCache } from "@/lib/discoverSessionCache";

/**
 * Blocks interaction when a downloaded OTA is waiting to apply. Prevents users
 * from running stale in-memory JS (e.g. old Home reloadAsync on sport pills)
 * after a new bundle has already been fetched.
 */
export function OtaRequiredGate({ children }: { children: ReactNode }) {
  const insets = useSafeAreaInsets();
  const [pending, setPending] = useState(() => !!latestContext?.isUpdatePending);

  useEffect(() => {
    if (__DEV__ || !Updates.isEnabled) return;
    const sub = addUpdatesStateChangeListener((event) => {
      setPending(!!event.context.isUpdatePending);
    });
    return () => sub.remove();
  }, []);

  if (__DEV__ || !Updates.isEnabled || !pending) {
    return <>{children}</>;
  }

  const restart = () => {
    void clearDiscoverCache().finally(() => {
      void Updates.reloadAsync({ reloadScreenOptions: { fade: true } });
    });
  };

  return (
    <View style={{ flex: 1, backgroundColor: "#0f172a" }}>
      {children}
      <View
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: 0,
          bottom: 0,
          backgroundColor: "rgba(15,23,42,0.96)",
          alignItems: "center",
          justifyContent: "center",
          paddingHorizontal: 28,
          paddingTop: insets.top,
          paddingBottom: insets.bottom,
        }}
      >
        <ActivityIndicator size="large" color="#38bdf8" />
        <Text
          style={{
            color: "#f8fafc",
            fontFamily: FONT.display,
            fontSize: 22,
            textAlign: "center",
            marginTop: 20,
          }}
        >
          Update ready
        </Text>
        <Text
          style={{
            color: "#94a3b8",
            fontFamily: FONT.medium,
            fontSize: 15,
            lineHeight: 22,
            textAlign: "center",
            marginTop: 10,
          }}
        >
          Stadium Edge downloaded a fix for Home and Tennis. Restart once to load it — using the
          app before restarting can cause crashes like &quot;userFound is not a function&quot;.
        </Text>
        <Pressable
          onPress={restart}
          style={({ pressed }) => ({
            marginTop: 22,
            backgroundColor: "#2563eb",
            borderRadius: 12,
            paddingVertical: 14,
            paddingHorizontal: 32,
            opacity: pressed ? 0.9 : 1,
          })}
        >
          <Text style={{ color: "#fff", fontFamily: FONT.bold, fontSize: 16 }}>Restart now</Text>
        </Pressable>
      </View>
    </View>
  );
}

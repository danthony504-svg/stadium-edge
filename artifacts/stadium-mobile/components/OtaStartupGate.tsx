import * as Updates from "expo-updates";
import { useEffect, useState, type ReactNode } from "react";
import { ActivityIndicator, Text, View } from "react-native";

import { FONT } from "@/components/ui";
import { clearDiscoverCache } from "@/lib/discoverSessionCache";
import { launchOtaCheckFetchReload } from "@/lib/otaLaunch";
import { clearSlatePreAnalysisCache } from "@/lib/slatePreAnalysisCache";

/**
 * Blocks the app until expo-updates check → fetch → reload completes on launch.
 * App Store users receive JS fixes here — no new binary required.
 */
export function OtaStartupGate({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(() => __DEV__ || !Updates.isEnabled);

  useEffect(() => {
    if (__DEV__ || !Updates.isEnabled) return;

    let cancelled = false;
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

    (async () => {
      await clearDiscoverCache();
      await clearSlatePreAnalysisCache();

      for (let attempt = 0; attempt < 3; attempt++) {
        if (cancelled) return;
        const outcome = await launchOtaCheckFetchReload();
        if (outcome === "reloaded") return;
        if (attempt < 2) await sleep(1500 * (attempt + 1));
      }

      if (!cancelled) setReady(true);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  if (ready) return <>{children}</>;

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: "#0f172a",
        alignItems: "center",
        justifyContent: "center",
        padding: 32,
      }}
    >
      <ActivityIndicator size="large" color="#38bdf8" />
      <Text
        style={{
          color: "#e2e8f0",
          fontFamily: FONT.medium,
          fontSize: 15,
          lineHeight: 21,
          textAlign: "center",
          marginTop: 18,
        }}
      >
        Checking for updates…
      </Text>
    </View>
  );
}

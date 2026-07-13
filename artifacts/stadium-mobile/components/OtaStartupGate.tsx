import * as Updates from "expo-updates";
import { latestContext } from "expo-updates";
import { useEffect, useState, type ReactNode } from "react";
import { ActivityIndicator, Text, View } from "react-native";

import { FONT } from "@/components/ui";
import { clearDiscoverCache } from "@/lib/discoverSessionCache";
import { clearSlatePreAnalysisCache } from "@/lib/slatePreAnalysisCache";

/**
 * Blocks the app until expo-updates has checked for (and applied) a pending
 * production bundle. Prevents crash-loops where a corrupt OTA is already on
 * disk and the rest of the tree throws before any update fetch runs.
 *
 * App Store users get JS fixes here — no new binary / review required.
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
        try {
          const pendingBefore = !!latestContext?.isUpdatePending;
          const check = await Updates.checkForUpdateAsync();
          if (check.isAvailable) {
            await Updates.fetchUpdateAsync();
            await Updates.reloadAsync({ reloadScreenOptions: { fade: true } });
            return;
          }
          const pending = pendingBefore || !!latestContext?.isUpdatePending;
          if (pending) {
            await Updates.reloadAsync({ reloadScreenOptions: { fade: true } });
            return;
          }
          break;
        } catch {
          if (attempt < 2) await sleep(1500 * (attempt + 1));
        }
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

import React, { useEffect, useState } from "react";
import { ActivityIndicator, View } from "react-native";

import { ForceUpdateScreen } from "@/components/ForceUpdateScreen";
import {
  evaluateForceUpdate,
} from "@/lib/appVersionGate";
import type { ForceUpdateDecision } from "@/lib/appVersion";

/**
 * Blocks the app shell when the native iOS version is below the server
 * (or embedded) minimum. Children render only when allowed.
 */
export function MinVersionGate({ children }: { children: React.ReactNode }) {
  const [decision, setDecision] = useState<ForceUpdateDecision | null>(null);

  useEffect(() => {
    let cancelled = false;
    const ctrl = new AbortController();
    (async () => {
      try {
        const result = await evaluateForceUpdate(ctrl.signal);
        if (!cancelled) setDecision(result);
      } catch {
        if (!cancelled) {
          setDecision({
            required: false,
            currentVersion: "—",
            minIosVersion: "1.1.0",
            appStoreUrl: "https://apps.apple.com/app/id6776024127",
            message: "",
          });
        }
      }
    })();
    return () => {
      cancelled = true;
      ctrl.abort();
    };
  }, []);

  if (!decision) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: "#0f172a",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <ActivityIndicator size="large" color="#38bdf8" />
      </View>
    );
  }

  if (decision.required) {
    return <ForceUpdateScreen decision={decision} />;
  }

  return <>{children}</>;
}

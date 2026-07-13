import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { FONT } from "@/components/ui";
import { readOtaDebugSnapshot } from "@/lib/otaDebug";
import { formatOtaLogLines, subscribeOtaLaunchLogs } from "@/lib/otaLaunchLog";

/**
 * Temporary on-screen OTA deployment label (all tabs). Tap to expand launch logs.
 */
export function OtaDiagnosticsBanner() {
  const insets = useSafeAreaInsets();
  const [expanded, setExpanded] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => subscribeOtaLaunchLogs(() => setTick((n) => n + 1)), []);

  if (__DEV__) return null;

  const snap = readOtaDebugSnapshot();
  const logs = formatOtaLogLines();
  void tick;

  const shortId =
    snap.updateId.length > 12 ? `${snap.updateId.slice(0, 8)}…` : snap.updateId;
  const shortCommit =
    snap.commitHash.length > 10 ? snap.commitHash.slice(0, 8) : snap.commitHash;

  return (
    <View
      pointerEvents="box-none"
      style={{
        position: "absolute",
        left: 8,
        right: 8,
        bottom: insets.bottom + 6,
        zIndex: 9998,
      }}
    >
      <Pressable
        onPress={() => setExpanded((v) => !v)}
        style={{
          backgroundColor: "rgba(15,23,42,0.94)",
          borderWidth: 1,
          borderColor: "#334155",
          borderRadius: 8,
          paddingHorizontal: 10,
          paddingVertical: 8,
        }}
      >
        <Text
          style={{
            color: "#94a3b8",
            fontFamily: FONT.medium,
            fontSize: 10,
            lineHeight: 14,
          }}
          selectable
        >
          OTA {snap.bundleSource} · ch {snap.channel} · rt {snap.runtimeVersion} · id {shortId}
        </Text>
        <Text
          style={{
            color: "#64748b",
            fontFamily: FONT.body,
            fontSize: 9,
            lineHeight: 13,
            marginTop: 2,
          }}
          selectable
        >
          commit {shortCommit} · {snap.updateCreatedAt} · {snap.deployMessage}
        </Text>
        {expanded ? (
          <View style={{ marginTop: 6, gap: 2 }}>
            {logs.length === 0 ? (
              <Text style={{ color: "#64748b", fontSize: 9 }}>No launch OTA logs yet</Text>
            ) : (
              logs.slice(-8).map((line) => (
                <Text
                  key={line}
                  style={{ color: "#94a3b8", fontFamily: FONT.body, fontSize: 8, lineHeight: 11 }}
                  selectable
                >
                  {line}
                </Text>
              ))
            )}
          </View>
        ) : null}
      </Pressable>
    </View>
  );
}

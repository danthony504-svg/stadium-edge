/**
 * Shown when EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY is empty at module scope.
 * Mounted BEFORE ClerkProvider — must expose bundle identity + OTA recovery
 * because DeferredOtaRuntime normally lives inside AppShell (unreachable here).
 */
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  Text,
  View,
} from "react-native";

import { DeferredOtaRuntime } from "@/components/DeferredOtaRuntime";
import {
  readMissingAuthBundleIdentity,
  runPreClerkOtaRecovery,
  type MissingAuthBundleIdentity,
} from "@/lib/missingAuthKeyIdentity";

const DARK_BG = "#0f172a";

type Props = {
  /** Dead-branch-only marker for export DCE proofs; not shown in UI. */
  startupSentinel?: string;
};

export function MissingAuthKeyScreen(_props: Props) {
  const [identity, setIdentity] = useState<MissingAuthBundleIdentity>(() =>
    readMissingAuthBundleIdentity(),
  );
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    // Re-read after first paint in case Updates hydrates late.
    setIdentity(readMissingAuthBundleIdentity());
  }, []);

  const onRecover = useCallback(async () => {
    setBusy(true);
    setStatus("Checking for an update…");
    const outcome = await runPreClerkOtaRecovery();
    if (outcome === "reloaded") {
      setStatus("Reload requested…");
      return;
    }
    if (outcome === "unavailable") {
      setStatus("Updates unavailable. Force-quit and reopen, or reinstall the preview build.");
    } else if (outcome === "error") {
      setStatus("Update check failed. Force-quit and reopen the app, then try again.");
    } else {
      setStatus("No newer update on this channel. Force-quit and reopen, or reinstall preview.");
    }
    setBusy(false);
    setIdentity(readMissingAuthBundleIdentity());
  }, []);

  return (
    <View style={{ flex: 1, backgroundColor: DARK_BG }}>
      <View
        style={{
          flex: 1,
          padding: 28,
          justifyContent: "center",
          gap: 14,
        }}
      >
        <Text
          style={{
            color: "#e2e8f0",
            fontSize: 16,
            fontWeight: "600",
            textAlign: "center",
            lineHeight: 22,
          }}
        >
          App configuration error (missing auth key)
        </Text>
        <Text
          style={{
            color: "#94a3b8",
            fontSize: 13,
            textAlign: "center",
            lineHeight: 19,
          }}
        >
          This JS bundle was exported without a Clerk publishable key. OTA recovery
          is available below without signing in.
        </Text>

        <View
          style={{
            marginTop: 8,
            padding: 14,
            borderRadius: 10,
            backgroundColor: "#1e293b",
            gap: 6,
          }}
        >
          <Text style={{ color: "#64748b", fontSize: 11, letterSpacing: 0.4 }}>
            RUNNING BUNDLE
          </Text>
          <Text selectable style={{ color: "#e2e8f0", fontSize: 12, lineHeight: 18 }}>
            {`updateId: ${identity.updateId}`}
          </Text>
          <Text selectable style={{ color: "#e2e8f0", fontSize: 12, lineHeight: 18 }}>
            {`channel: ${identity.channel}`}
          </Text>
          <Text selectable style={{ color: "#e2e8f0", fontSize: 12, lineHeight: 18 }}>
            {`baked SHA: ${identity.bakedSha}`}
          </Text>
        </View>

        <Pressable
          accessibilityRole="button"
          disabled={busy}
          onPress={() => {
            void onRecover();
          }}
          style={({ pressed }) => ({
            marginTop: 10,
            backgroundColor: pressed || busy ? "#0369a1" : "#0284c7",
            paddingVertical: 14,
            paddingHorizontal: 16,
            borderRadius: 10,
            alignItems: "center",
            opacity: busy ? 0.75 : 1,
          })}
        >
          {busy ? (
            <ActivityIndicator color="#f8fafc" />
          ) : (
            <Text style={{ color: "#f8fafc", fontSize: 15, fontWeight: "600" }}>
              Check for update & reload
            </Text>
          )}
        </Pressable>

        {status ? (
          <Text
            style={{
              color: "#cbd5e1",
              fontSize: 12,
              textAlign: "center",
              lineHeight: 17,
            }}
          >
            {status}
          </Text>
        ) : null}

        <Text
          style={{
            color: "#64748b",
            fontSize: 11,
            textAlign: "center",
            lineHeight: 16,
            marginTop: 4,
          }}
        >
          If reload does nothing: force-quit → reopen (native ON_LOAD fetch), or
          delete & reinstall the preview IPA. Production is unchanged.
        </Text>
      </View>
      {/* Keep OTA controller mounted even when Clerk never starts. */}
      <DeferredOtaRuntime />
    </View>
  );
}

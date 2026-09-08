import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { usePathname } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { FONT } from "@/components/ui";
import {
  getOtaRecoveryStatus,
  subscribeOtaRecoveryStatus,
  type OtaRecoveryStatus,
} from "@/lib/otaRecoveryStatus";

function shortId(id: string): string {
  if (!id || id === "—") return id;
  return id.length > 12 ? `${id.slice(0, 8)}…` : id;
}

/**
 * Production-safe OTA recovery diagnostics footer.
 * Shows running/available IDs, fetch result, pending, reload block, last error.
 */
export function OtaDiagnosticsBanner() {
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  const [expanded, setExpanded] = useState(false);
  const [status, setStatus] = useState<OtaRecoveryStatus>(() => getOtaRecoveryStatus());

  useEffect(() => subscribeOtaRecoveryStatus(() => setStatus(getOtaRecoveryStatus())), []);

  if (__DEV__) return null;

  // Coach pins a chat composer to the bottom — keep this footer off Coach.
  const onCoach = pathname === "/coach" || pathname.startsWith("/coach/");
  if (onCoach) return null;

  const pendingLabel = status.pending ? "YES" : "NO";
  const blockedLabel = status.reloadBlocked ? "YES" : "NO";

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
          RUNNING {shortId(status.runningUpdateId)} · AVAILABLE {shortId(status.availableUpdateId)}
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
          FETCH {status.fetchResult} · PENDING {pendingLabel} · RELOAD BLOCKED {blockedLabel}
        </Text>
        <Text
          style={{
            color: status.lastOtaError !== "—" ? "#f87171" : "#64748b",
            fontFamily: FONT.body,
            fontSize: 9,
            lineHeight: 13,
            marginTop: 2,
          }}
          selectable
        >
          LAST OTA ERROR {status.lastOtaError}
        </Text>
        {expanded ? (
          <View style={{ marginTop: 6, gap: 2 }}>
            <Text style={{ color: "#94a3b8", fontSize: 8, lineHeight: 11 }} selectable>
              RUNNING UPDATE ID {status.runningUpdateId}
            </Text>
            <Text style={{ color: "#94a3b8", fontSize: 8, lineHeight: 11 }} selectable>
              AVAILABLE UPDATE ID {status.availableUpdateId}
            </Text>
            <Text style={{ color: "#94a3b8", fontSize: 8, lineHeight: 11 }} selectable>
              FETCH RESULT {status.fetchResult}
            </Text>
            <Text style={{ color: "#94a3b8", fontSize: 8, lineHeight: 11 }} selectable>
              PENDING {pendingLabel}
            </Text>
            <Text style={{ color: "#94a3b8", fontSize: 8, lineHeight: 11 }} selectable>
              RELOAD BLOCKED {blockedLabel}
            </Text>
            <Text style={{ color: "#94a3b8", fontSize: 8, lineHeight: 11 }} selectable>
              LAST OTA ERROR {status.lastOtaError}
            </Text>
            <Text style={{ color: "#64748b", fontSize: 8, lineHeight: 11 }} selectable>
              checkReason={status.checkReason} emergency={String(status.isEmergencyLaunch)}{" "}
              rollback={status.rollbackCommitTime}
            </Text>
          </View>
        ) : null}
      </Pressable>
    </View>
  );
}

/**
 * Always-on, fail-soft OTA identity readout for screens that exist on older
 * bundles after this tip applies — Account / Sign-in — so Device attestation
 * menu is not required to read Updates.updateId / embed / apply outcome.
 *
 * Lazy expo-updates only (never static import).
 */
import * as Clipboard from "expo-clipboard";
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";

import { FONT } from "@/components/ui";
import { tryGetExpoUpdates } from "@/lib/expoUpdatesAccess";
import { peekOtaController } from "@/lib/ota";

type Identity = {
  updateId: string;
  runtimeVersion: string;
  isEmbeddedLaunch: boolean;
  isEmergencyLaunch: boolean;
  channel: string;
  launchOutcome: string;
  launchOutcomeDetail: string;
};

function readIdentity(): Identity {
  const Updates = tryGetExpoUpdates();
  const snap = peekOtaController()?.getSnapshot();
  return {
    updateId: Updates?.updateId
      ? String(Updates.updateId)
      : Updates?.isEmbeddedLaunch
        ? "embedded"
        : "—",
    runtimeVersion: Updates?.runtimeVersion
      ? String(Updates.runtimeVersion)
      : "—",
    isEmbeddedLaunch: !!Updates?.isEmbeddedLaunch,
    isEmergencyLaunch: !!Updates?.isEmergencyLaunch,
    channel:
      (Updates as { channel?: string } | null)?.channel != null
        ? String((Updates as { channel?: string }).channel)
        : "—",
    launchOutcome: snap?.launchOutcome ?? "unknown",
    launchOutcomeDetail: snap?.launchOutcomeDetail ?? "—",
  };
}

function formatReport(id: Identity): string {
  return [
    `Updates.updateId: ${id.updateId}`,
    `Updates.runtimeVersion: ${id.runtimeVersion}`,
    `Updates.isEmbeddedLaunch: ${id.isEmbeddedLaunch}`,
    `Updates.isEmergencyLaunch: ${id.isEmergencyLaunch}`,
    `channel: ${id.channel}`,
    `applyOutcome: ${id.launchOutcome}`,
    `applyDetail: ${id.launchOutcomeDetail}`,
    "Deep link (older bundles without Device attestation menu): stadium-mobile://ota-debug",
  ].join("\n");
}

export function OtaRunningIdentity({
  compact = false,
}: {
  compact?: boolean;
}) {
  const router = useRouter();
  const [id, setId] = useState<Identity | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (typeof __DEV__ !== "undefined" && __DEV__) return;
    let cancelled = false;
    const tick = () => {
      if (cancelled) return;
      try {
        setId(readIdentity());
      } catch {
        setId(null);
      }
    };
    tick();
    const t = setInterval(tick, 2_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  if (typeof __DEV__ !== "undefined" && __DEV__) return null;
  if (!id) return null;

  const border =
    id.launchOutcome === "launch_failed" || id.launchOutcome === "selection_failed"
      ? "#fca5a5"
      : id.isEmbeddedLaunch
        ? "#fde68a"
        : "#86efac";

  return (
    <View
      style={{
        marginTop: compact ? 8 : 16,
        padding: 10,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: border,
        backgroundColor: "rgba(15,23,42,0.92)",
        gap: 4,
      }}
    >
      <Text
        style={{
          color: "#f8fafc",
          fontFamily: FONT.semibold,
          fontSize: 11,
        }}
      >
        Running update (copy / open diagnostics)
      </Text>
      <Text
        selectable
        style={{
          color: "#e2e8f0",
          fontFamily: FONT.medium,
          fontSize: 10,
          lineHeight: 14,
        }}
      >
        {`updateId: ${id.updateId}\nruntime: ${id.runtimeVersion} · embedded: ${String(id.isEmbeddedLaunch)} · emergency: ${String(id.isEmergencyLaunch)}\napply: ${id.launchOutcome}`}
      </Text>
      {!compact ? (
        <Text
          selectable
          style={{
            color: "#94a3b8",
            fontFamily: FONT.medium,
            fontSize: 9,
            lineHeight: 12,
          }}
        >
          {id.launchOutcomeDetail}
        </Text>
      ) : null}
      <View style={{ flexDirection: "row", gap: 12, marginTop: 4 }}>
        <Pressable
          onPress={async () => {
            try {
              await Clipboard.setStringAsync(formatReport(id));
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            } catch {
              // selectable text remains
            }
          }}
        >
          <Text style={{ color: "#93c5fd", fontFamily: FONT.semibold, fontSize: 11 }}>
            {copied ? "Copied" : "Copy update report"}
          </Text>
        </Pressable>
        <Pressable onPress={() => router.push("/ota-debug")}>
          <Text style={{ color: "#93c5fd", fontFamily: FONT.semibold, fontSize: 11 }}>
            Open /ota-debug
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

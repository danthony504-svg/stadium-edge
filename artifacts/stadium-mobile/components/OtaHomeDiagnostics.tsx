import Constants from "expo-constants";
import * as Updates from "expo-updates";
import { useEffect, useState } from "react";
import { Text, View } from "react-native";

import { FONT } from "@/components/ui";

type OtaHomeDiag = {
  updateId: string;
  runtimeVersion: string;
  channel: string;
  createdAt: string;
  isEmbeddedLaunch: string;
  checkResult: string;
  fetchResult: string;
  updatesEnabled: string;
  updateUrl: string;
  projectId: string;
  buildNumber: string;
};

function str(v: unknown, fallback = "—"): string {
  if (v == null || v === "") return fallback;
  return String(v);
}

function formatCreatedAt(): string {
  const raw =
    (Updates as { createdAt?: Date | string | null }).createdAt ??
    (Updates.manifest as { createdAt?: string } | null)?.createdAt;
  if (!raw) return "—";
  const d = raw instanceof Date ? raw : new Date(raw);
  return Number.isFinite(d.getTime()) ? d.toISOString() : str(raw);
}

function readStatic(): Pick<
  OtaHomeDiag,
  "updateId" | "runtimeVersion" | "channel" | "createdAt" | "isEmbeddedLaunch" | "updatesEnabled" | "updateUrl" | "projectId" | "buildNumber"
> {
  const expo = Constants.expoConfig;
  const updatesCfg = expo?.updates as
    | { url?: string; requestHeaders?: Record<string, string> }
    | undefined;
  const channelHeader = updatesCfg?.requestHeaders?.["expo-channel-name"];
  const channel =
    str((Updates as { channel?: string }).channel, "") ||
    str(channelHeader, "") ||
    "embedded-at-build";

  return {
    updateId: str(Updates.updateId, Updates.isEmbeddedLaunch ? "embedded" : "—"),
    runtimeVersion: str(Updates.runtimeVersion ?? expo?.runtimeVersion),
    channel,
    createdAt: formatCreatedAt(),
    isEmbeddedLaunch: String(Updates.isEmbeddedLaunch),
    updatesEnabled: String(Updates.isEnabled),
    updateUrl: str(updatesCfg?.url),
    projectId: str((expo?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId),
    buildNumber: str(Constants.nativeBuildVersion),
  };
}

/**
 * On-screen OTA diagnostics for Home — shows live Updates.* values and
 * check/fetch results so App Store users can confirm which bundle is running.
 */
export function OtaHomeDiagnostics() {
  const [diag, setDiag] = useState<OtaHomeDiag>(() => ({
    ...readStatic(),
    checkResult: "pending…",
    fetchResult: "pending…",
  }));

  useEffect(() => {
    if (__DEV__ || !Updates.isEnabled) {
      setDiag((d) => ({
        ...d,
        checkResult: __DEV__ ? "skipped: __DEV__" : "skipped: Updates.isEnabled=false",
        fetchResult: "skipped",
      }));
      return;
    }

    let cancelled = false;

    (async () => {
      const base = readStatic();
      let checkResult = "—";
      let fetchResult = "—";

      try {
        const check = await Updates.checkForUpdateAsync();
        const roll = (check as { isRollBackToEmbedded?: boolean }).isRollBackToEmbedded;
        checkResult = JSON.stringify({
          isAvailable: check.isAvailable,
          isRollBackToEmbedded: roll === true,
          reason: (check as { reason?: string }).reason ?? null,
        });

        if (check.isAvailable || roll) {
          try {
            await Updates.fetchUpdateAsync();
            fetchResult = "fetchUpdateAsync: success";
          } catch (e) {
            fetchResult = `fetchUpdateAsync ERR: ${e instanceof Error ? e.message : String(e)}`;
          }
        } else {
          fetchResult = "fetch skipped (check.isAvailable=false)";
        }
      } catch (e) {
        checkResult = `checkForUpdateAsync ERR: ${e instanceof Error ? e.message : String(e)}`;
        fetchResult = "fetch skipped (check failed)";
      }

      if (!cancelled) {
        setDiag({
          ...readStatic(),
          checkResult,
          fetchResult,
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  if (__DEV__) return null;

  const lines: [string, string][] = [
    ["build", diag.buildNumber],
    ["Updates.updateId", diag.updateId],
    ["Updates.runtimeVersion", diag.runtimeVersion],
    ["Updates.channel", diag.channel],
    ["Updates.createdAt", diag.createdAt],
    ["Updates.isEmbeddedLaunch", diag.isEmbeddedLaunch],
    ["Updates.isEnabled", diag.updatesEnabled],
    ["updates.url", diag.updateUrl],
    ["projectId", diag.projectId],
    ["checkForUpdateAsync", diag.checkResult],
    ["fetchUpdateAsync", diag.fetchResult],
  ];

  return (
    <View
      style={{
        marginHorizontal: 16,
        marginTop: 8,
        marginBottom: 4,
        padding: 10,
        backgroundColor: "rgba(30,41,59,0.95)",
        borderWidth: 1,
        borderColor: "#475569",
        borderRadius: 8,
      }}
    >
      <Text
        style={{
          color: "#f8fafc",
          fontFamily: FONT.semibold,
          fontSize: 11,
          marginBottom: 6,
        }}
      >
        OTA diagnostics (Home)
      </Text>
      {lines.map(([label, value]) => (
        <Text
          key={label}
          selectable
          style={{
            color: "#94a3b8",
            fontFamily: FONT.body,
            fontSize: 9,
            lineHeight: 13,
          }}
        >
          {label}: {value}
        </Text>
      ))}
    </View>
  );
}

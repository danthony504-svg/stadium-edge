import * as Clipboard from "expo-clipboard";
import Feather from "@expo/vector-icons/Feather";
import { useRouter } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { FONT } from "@/components/ui";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { useColors } from "@/hooks/useColors";
import {
  clearCoachScanDiagnostics,
  formatCoachScanDiagnosticsReport,
  getCoachScanDiagnostics,
  subscribeCoachScanDiagnostics,
  type CoachScanDiagnosticsSnapshot,
} from "@/lib/coachScanDiagnosticsStore";

function Row({ label, value }: { label: string; value: string }) {
  const colors = useColors();
  return (
    <View style={{ gap: 4 }}>
      <Text style={{ color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 12 }}>
        {label}
      </Text>
      <Text
        selectable
        style={{ color: colors.foreground, fontFamily: FONT.body, fontSize: 13, lineHeight: 19 }}
      >
        {value}
      </Text>
    </View>
  );
}

function SectionTitle({ children }: { children: string }) {
  const colors = useColors();
  return (
    <Text
      style={{
        color: colors.foreground,
        fontFamily: FONT.semibold,
        fontSize: 15,
        marginTop: 8,
      }}
    >
      {children}
    </Text>
  );
}

function ReportBlock({ text }: { text: string }) {
  const colors = useColors();
  return (
    <Text
      selectable
      style={{
        color: colors.foreground,
        fontFamily: FONT.body,
        fontSize: 11,
        lineHeight: 16,
      }}
    >
      {text}
    </Text>
  );
}

export default function CoachScanDebugScreen() {
  return (
    <ErrorBoundary>
      <CoachScanDebugScreenInner />
    </ErrorBoundary>
  );
}

function CoachScanDebugScreenInner() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [snap, setSnap] = useState<CoachScanDiagnosticsSnapshot | null>(() =>
    getCoachScanDiagnostics(),
  );
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => subscribeCoachScanDiagnostics(setSnap), []);

  const refresh = useCallback(() => {
    setSnap(getCoachScanDiagnostics());
    setStatus("Refreshed from last Coach build");
  }, []);

  const copyAll = async () => {
    await Clipboard.setStringAsync(formatCoachScanDiagnosticsReport(snap));
    setStatus("Copied full report to clipboard");
  };

  const clear = () => {
    clearCoachScanDiagnostics();
    setStatus("Cleared last scan snapshot");
  };

  const report = formatCoachScanDiagnosticsReport(snap);
  const when = snap ? new Date(snap.capturedAt).toLocaleString() : "—";

  return (
    <View style={{ flex: 1, backgroundColor: colors.background, paddingTop: insets.top }}>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          paddingHorizontal: 16,
          paddingVertical: 12,
          gap: 12,
        }}
      >
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <Feather name="arrow-left" size={22} color={colors.foreground} />
        </Pressable>
        <Text
          style={{
            flex: 1,
            color: colors.foreground,
            fontFamily: FONT.semibold,
            fontSize: 17,
          }}
        >
          Coach Scan Diagnostics
        </Text>
      </View>

      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: 16,
          paddingBottom: insets.bottom + 32,
          gap: 14,
        }}
      >
        <Text
          style={{
            color: colors.mutedForeground,
            fontFamily: FONT.body,
            fontSize: 13,
            lineHeight: 19,
          }}
        >
          Private diagnostics (Menu → Coach Scan Diagnostics in dev builds).
          Read-only view of the last Coach board scan: which legs landed, which
          candidates were rejected, and why. Does not change Coach hold,
          scoring, or delivery.
        </Text>

        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          <Pressable
            onPress={refresh}
            style={({ pressed }) => ({
              paddingHorizontal: 12,
              paddingVertical: 10,
              borderRadius: 10,
              backgroundColor: colors.card,
              borderWidth: 1,
              borderColor: colors.border,
              opacity: pressed ? 0.8 : 1,
            })}
          >
            <Text style={{ color: colors.foreground, fontFamily: FONT.medium, fontSize: 13 }}>
              Refresh
            </Text>
          </Pressable>
          <Pressable
            onPress={() => void copyAll()}
            style={({ pressed }) => ({
              paddingHorizontal: 12,
              paddingVertical: 10,
              borderRadius: 10,
              backgroundColor: colors.card,
              borderWidth: 1,
              borderColor: colors.border,
              opacity: pressed ? 0.8 : 1,
            })}
          >
            <Text style={{ color: colors.foreground, fontFamily: FONT.medium, fontSize: 13 }}>
              Copy report
            </Text>
          </Pressable>
          <Pressable
            onPress={clear}
            style={({ pressed }) => ({
              paddingHorizontal: 12,
              paddingVertical: 10,
              borderRadius: 10,
              backgroundColor: colors.card,
              borderWidth: 1,
              borderColor: colors.border,
              opacity: pressed ? 0.8 : 1,
            })}
          >
            <Text style={{ color: colors.foreground, fontFamily: FONT.medium, fontSize: 13 }}>
              Clear
            </Text>
          </Pressable>
        </View>

        {status ? (
          <Text style={{ color: colors.primary, fontFamily: FONT.medium, fontSize: 12 }}>
            {status}
          </Text>
        ) : null}

        <SectionTitle>Last build</SectionTitle>
        <Row label="Captured" value={when} />
        <Row label="Ask" value={snap?.askText ?? "(none yet — run a Coach parlay first)"} />
        <Row
          label="Legs"
          value={
            snap
              ? `${snap.deliveredLegs} delivered / ${snap.requestedLegs} requested`
              : "—"
          }
        />
        <Row
          label="Prop pool / timeout"
          value={
            snap
              ? `${snap.propPoolSize} props · timedOut=${snap.timedOut ? "yes" : "no"}`
              : "—"
          }
        />

        {snap?.deliveredPicks?.length ? (
          <>
            <SectionTitle>On ticket</SectionTitle>
            {snap.deliveredPicks.map((p, i) => (
              <Row
                key={`${i}-${p.game}-${p.pick}`}
                label={`${i + 1}. ${p.player || p.pick}`}
                value={`${p.market} · ${p.pick}${typeof p.odds === "number" ? ` @ ${p.odds}` : ""}\n${p.game}${p.sport ? ` · ${p.sport}` : ""}`}
              />
            ))}
          </>
        ) : null}

        <SectionTitle>Full report (considered / rejected / why)</SectionTitle>
        <View
          style={{
            backgroundColor: colors.card,
            borderWidth: 1,
            borderColor: colors.border,
            borderRadius: 12,
            padding: 12,
          }}
        >
          <ReportBlock text={report} />
        </View>
      </ScrollView>
    </View>
  );
}

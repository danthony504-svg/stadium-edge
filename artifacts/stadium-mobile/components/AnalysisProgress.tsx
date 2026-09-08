import { Feather } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useEffect, useRef } from "react";
import { ActivityIndicator, Animated, Easing, Text, View } from "react-native";

import { FONT } from "@/components/ui";
import { useColors } from "@/hooks/useColors";
import type { CoachBuildProgressView } from "@/lib/coachBuildProgress";

const CYAN = "#22d3ee";
const BLUE = "#3b82f6";

const ASK_STAGES = [
  "Reading your question…",
  "Pulling live odds and props…",
  "Checking player matchups…",
  "Processing recent stats…",
  "Comparing odds across sportsbooks…",
  "Identifying key factors…",
  "Calculating edge and value…",
  "Running AI analysis…",
  "Writing your answer…",
] as const;

const ASK_TARGETS = [8, 20, 32, 44, 56, 68, 80, 91, 100] as const;

const ASK_CHECKLIST: { label: string; doneAt: number }[] = [
  { label: "Question understood", doneAt: 1 },
  { label: "Live data pulled", doneAt: 4 },
  { label: "Key factors identified", doneAt: 5 },
  { label: "Value calculated", doneAt: 7 },
  { label: "Answer ready", doneAt: 8 },
];

export type { ParlayBuildPhase } from "@/lib/coachBuildProgress";

export function AnalysisProgress({
  mode = "build",
  progress,
  legCount = 0,
}: {
  mode?: "build" | "analyze" | "ask";
  progress?: CoachBuildProgressView | null;
  legCount?: number;
}) {
  const colors = useColors();
  const isAsk = mode === "ask";
  const isAnalyze = mode === "analyze";

  const askStageIndex =
    legCount > 0 ? ASK_STAGES.length - 1 : Math.min(4, ASK_STAGES.length - 2);
  const askPercent =
    legCount > 0 ? 100 : ASK_TARGETS[Math.min(4, ASK_STAGES.length - 2)];

  const displayPct = isAsk ? askPercent : isAnalyze ? 48 : (progress?.percent ?? 0);
  const displayStage = isAsk
    ? ASK_STAGES[askStageIndex]
    : isAnalyze
      ? "Analyzing your ticket…"
      : progress?.headline ?? "Starting analysis";
  const checklist = isAsk
    ? ASK_CHECKLIST.map((item, idx) => ({
        id: `ask-${idx}`,
        label: item.label,
        done: legCount > 0 ? true : askStageIndex >= item.doneAt,
        active: legCount <= 0 && askStageIndex < item.doneAt && idx === ASK_CHECKLIST.findIndex((c) => askStageIndex < c.doneAt),
      }))
    : (progress?.checklist ?? []);

  const spinning = isAsk || isAnalyze ? legCount <= 0 : (progress?.spinning ?? false);
  const timedOut = progress?.timedOut ?? false;
  const failed = progress?.failed ?? false;

  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 900,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: 900,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);
  const pulseOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.45, 1] });

  return (
    <View
      style={{
        alignSelf: "stretch",
        marginTop: 10,
        backgroundColor: colors.card,
        borderWidth: 1,
        borderColor: timedOut || failed ? "rgba(248,113,113,0.45)" : "rgba(34,211,238,0.35)",
        borderRadius: 16,
        paddingHorizontal: 14,
        paddingVertical: 14,
        gap: 14,
        shadowColor: timedOut || failed ? "#f87171" : CYAN,
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0.3,
        shadowRadius: 16,
        elevation: 8,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        <Animated.View
          style={{
            width: 10,
            height: 10,
            borderRadius: 999,
            backgroundColor: timedOut || failed ? "#f87171" : CYAN,
            opacity: pulseOpacity,
            shadowColor: timedOut || failed ? "#f87171" : CYAN,
            shadowOffset: { width: 0, height: 0 },
            shadowOpacity: 0.9,
            shadowRadius: 6,
            elevation: 4,
          }}
        />
        <Text
          numberOfLines={2}
          style={{
            flex: 1,
            color: colors.foreground,
            fontFamily: FONT.semibold,
            fontSize: 14,
          }}
        >
          {displayStage}
        </Text>
        <Text
          style={{
            color: timedOut || failed ? "#f87171" : CYAN,
            fontFamily: FONT.bold,
            fontSize: 15,
            fontVariant: ["tabular-nums"],
          }}
        >
          {Math.round(displayPct)}%
        </Text>
      </View>

      {failed && progress?.failureMessage ? (
        <Text style={{ color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 13 }}>
          {progress.failureMessage}
        </Text>
      ) : null}

      <Animated.View style={{ opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1] }) }}>
        <View
          style={{
            height: 8,
            borderRadius: 999,
            backgroundColor: "rgba(148,163,184,0.18)",
            overflow: "hidden",
          }}
        >
          <LinearGradient
            colors={timedOut || failed ? ["#ef4444", "#f87171"] : [BLUE, CYAN]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={{
              width: `${Math.max(Math.round(displayPct), 2)}%`,
              height: "100%",
              borderRadius: 999,
            }}
          />
        </View>
      </Animated.View>

      <View
        style={{
          backgroundColor: colors.surface,
          borderRadius: 12,
          borderWidth: 1,
          borderColor: colors.border,
          paddingHorizontal: 12,
          paddingVertical: 10,
          gap: 9,
        }}
      >
        {checklist.map((item) => (
          <View key={item.id} style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            {item.done ? (
              <View
                style={{
                  width: 20,
                  height: 20,
                  borderRadius: 999,
                  backgroundColor: CYAN,
                  alignItems: "center",
                  justifyContent: "center",
                  shadowColor: CYAN,
                  shadowOffset: { width: 0, height: 0 },
                  shadowOpacity: 0.8,
                  shadowRadius: 5,
                  elevation: 3,
                }}
              >
                <Feather name="check" size={13} color={colors.card} />
              </View>
            ) : item.active && spinning ? (
              <View
                style={{
                  width: 20,
                  height: 20,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <ActivityIndicator size="small" color={CYAN} />
              </View>
            ) : (
              <View
                style={{
                  width: 20,
                  height: 20,
                  borderRadius: 999,
                  borderWidth: 2,
                  borderColor: colors.border,
                }}
              />
            )}
            <Text
              style={{
                flex: 1,
                color: item.done ? colors.foreground : item.active ? colors.foreground : colors.mutedForeground,
                fontFamily: item.done || item.active ? FONT.semibold : FONT.medium,
                fontSize: 13,
              }}
            >
              {item.label}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

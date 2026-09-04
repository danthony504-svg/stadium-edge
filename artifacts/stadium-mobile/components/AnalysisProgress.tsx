import { Feather } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useEffect, useMemo, useRef } from "react";
import { ActivityIndicator, Animated, Easing, Text, View } from "react-native";

import { FONT } from "@/components/ui";
import { useColors } from "@/hooks/useColors";
import { coachBuildProgressFromPhase, type ParlayBuildPhase } from "@/lib/coachBuildProgress";

const CYAN = "#22d3ee";
const BLUE = "#3b82f6";

const STAGES = [
  "Reading your ticket…",
  "Scanning available props…",
  "Checking player matchups…",
  "Reviewing injuries and lineups…",
  "Comparing odds across sportsbooks…",
  "Calculating edge and confidence…",
  "Checking parlay correlation…",
  "Finding weak legs…",
  "Building final AI grade…",
  "Finalizing your ticket…",
] as const;

const TARGETS = [6, 16, 28, 40, 52, 64, 74, 84, 93, 100] as const;

const CHECKLIST: { label: string; doneAt: number }[] = [
  { label: "Matchups analyzed", doneAt: 3 },
  { label: "Injury report checked", doneAt: 4 },
  { label: "Line value calculated", doneAt: 6 },
  { label: "Correlation scored", doneAt: 7 },
  { label: "Final ticket ready", doneAt: 9 },
];

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
  legCount = 0,
  buildPhase,
  timedOut = false,
  slowStageLabel,
}: {
  mode?: "build" | "analyze" | "ask";
  legCount?: number;
  buildPhase?: ParlayBuildPhase;
  timedOut?: boolean;
  slowStageLabel?: string;
}) {
  const colors = useColors();
  const isAsk = mode === "ask";
  const stageList = isAsk ? ASK_STAGES : STAGES;
  const targetList = isAsk ? ASK_TARGETS : TARGETS;
  const checklist = isAsk ? ASK_CHECKLIST : CHECKLIST;

  const progress = useMemo(() => {
    if (mode === "build") {
      return coachBuildProgressFromPhase(buildPhase, legCount);
    }
    if (legCount > 0) {
      return { stageIndex: stageList.length - 1, percent: 100 };
    }
    return {
      stageIndex: Math.min(4, stageList.length - 2),
      percent: targetList[Math.min(4, stageList.length - 2)],
    };
  }, [buildPhase, legCount, mode, stageList.length, targetList]);

  const effectiveIndex = Math.min(progress.stageIndex, stageList.length - 1);
  const displayPct = progress.percent;
  const phaseStage =
    mode === "build" && buildPhase === "board-scan"
      ? "Scanning every posted market on the live board…"
      : mode === "build" && buildPhase === "context"
        ? "Pulling live odds and props…"
        : mode === "build" && buildPhase === "score" && legCount > 0
          ? "Finalizing your ticket…"
          : timedOut && slowStageLabel
            ? `Still working on ${slowStageLabel}…`
            : null;
  const displayStage = phaseStage ?? stageList[effectiveIndex];

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

  const activeChecklist = checklist.findIndex((c) => {
    if (c.label === "Final ticket ready") return legCount <= 0 && effectiveIndex < c.doneAt;
    return effectiveIndex < c.doneAt;
  });

  return (
    <View
      style={{
        alignSelf: "stretch",
        marginTop: 10,
        backgroundColor: colors.card,
        borderWidth: 1,
        borderColor: "rgba(34,211,238,0.35)",
        borderRadius: 16,
        paddingHorizontal: 14,
        paddingVertical: 14,
        gap: 14,
        shadowColor: CYAN,
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
            backgroundColor: CYAN,
            opacity: pulseOpacity,
            shadowColor: CYAN,
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
            color: CYAN,
            fontFamily: FONT.bold,
            fontSize: 15,
            fontVariant: ["tabular-nums"],
          }}
        >
          {Math.round(displayPct)}%
        </Text>
      </View>

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
            colors={[BLUE, CYAN]}
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
        {checklist.map((item, idx) => {
          const done =
            item.label === "Final ticket ready" ? legCount > 0 : effectiveIndex >= item.doneAt;
          const active = idx === activeChecklist;
          return (
            <View key={item.label} style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              {done ? (
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
              ) : active ? (
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
                  color: done ? colors.foreground : active ? colors.foreground : colors.mutedForeground,
                  fontFamily: done || active ? FONT.semibold : FONT.medium,
                  fontSize: 13,
                }}
              >
                {item.label}
              </Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

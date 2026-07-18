import { Feather } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Animated, Easing, Text, View } from "react-native";

import { FONT } from "@/components/ui";
import { useColors } from "@/hooks/useColors";
import {
  coachProgressChecklist,
  coachProgressHeadline,
  type CoachCanonicalProgress,
} from "@/lib/coachProgressState";

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

const ANALYZE_STAGES = [
  "Reading your ticket…",
  "Scanning available props…",
  "Checking player matchups…",
  "Reviewing injuries and lineups…",
  "Comparing odds across sportsbooks…",
  "Calculating edge and confidence…",
  "Running AI analysis…",
  "Writing your breakdown…",
] as const;

const ANALYZE_TARGETS = [8, 20, 32, 44, 56, 68, 80, 100] as const;

const ANALYZE_CHECKLIST: { label: string; doneAt: number }[] = [
  { label: "Ticket understood", doneAt: 1 },
  { label: "Live data pulled", doneAt: 4 },
  { label: "Matchups analyzed", doneAt: 5 },
  { label: "Edge calculated", doneAt: 6 },
  { label: "Analysis ready", doneAt: 7 },
];

export type ParlayBuildPhase = "context" | "board-scan" | "stream" | "score";

function CanonicalProgressCard({
  colors,
  headline,
  percent,
  checklist,
}: {
  colors: ReturnType<typeof useColors>;
  headline: string;
  percent: number;
  checklist: { label: string; done: boolean; active: boolean }[];
}) {
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
          }}
        />
        <Text
          numberOfLines={2}
          style={{ flex: 1, color: colors.foreground, fontFamily: FONT.semibold, fontSize: 14 }}
        >
          {headline}
        </Text>
        <Text
          style={{
            color: CYAN,
            fontFamily: FONT.bold,
            fontSize: 15,
            fontVariant: ["tabular-nums"],
          }}
        >
          {percent}%
        </Text>
      </View>
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
            width: `${Math.max(percent, 2)}%`,
            height: "100%",
            borderRadius: 999,
          }}
        />
      </View>
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
          <View key={item.label} style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            {item.done ? (
              <View
                style={{
                  width: 20,
                  height: 20,
                  borderRadius: 999,
                  backgroundColor: CYAN,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Feather name="check" size={13} color={colors.card} />
              </View>
            ) : item.active ? (
              <View style={{ width: 20, height: 20, alignItems: "center", justifyContent: "center" }}>
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
                color: item.done || item.active ? colors.foreground : colors.mutedForeground,
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

function TimedAnalysisProgress({ mode }: { mode: "analyze" | "ask" }) {
  const colors = useColors();
  const [autoIndex, setAutoIndex] = useState(0);
  const [pct, setPct] = useState(0);
  const stageList = mode === "ask" ? ASK_STAGES : ANALYZE_STAGES;
  const targetList = mode === "ask" ? ASK_TARGETS : ANALYZE_TARGETS;
  const checklist = mode === "ask" ? ASK_CHECKLIST : ANALYZE_CHECKLIST;
  const maxAuto = stageList.length - 1;
  const target = targetList[Math.min(autoIndex, maxAuto)];

  useEffect(() => {
    const id = setInterval(() => {
      setAutoIndex((i) => (i < maxAuto ? i + 1 : i));
    }, 1500);
    return () => clearInterval(id);
  }, [maxAuto]);

  useEffect(() => {
    const id = setInterval(() => {
      setPct((p) => {
        if (p >= target) return target;
        const next = p + Math.max(0.4, (target - p) * 0.14);
        return next >= target ? target : next;
      });
    }, 70);
    return () => clearInterval(id);
  }, [target]);

  const activeChecklist = checklist.findIndex((c) => autoIndex < c.doneAt);
  const displayPct = Math.round(pct);

  return (
    <CanonicalProgressCard
      colors={colors}
      headline={stageList[Math.min(autoIndex, maxAuto)]}
      percent={displayPct}
      checklist={checklist.map((item, idx) => ({
        label: item.label,
        done: autoIndex >= item.doneAt,
        active: idx === activeChecklist,
      }))}
    />
  );
}

export function AnalysisProgress({
  mode = "build",
  progress,
}: {
  mode?: "build" | "analyze" | "ask";
  legCount?: number;
  buildPhase?: ParlayBuildPhase;
  progress?: CoachCanonicalProgress | null;
}) {
  const colors = useColors();

  if (progress) {
    return (
      <CanonicalProgressCard
        colors={colors}
        headline={coachProgressHeadline(progress.stage)}
        percent={progress.percent}
        checklist={coachProgressChecklist(progress)}
      />
    );
  }

  if (mode === "analyze" || mode === "ask") {
    return <TimedAnalysisProgress mode={mode} />;
  }

  return null;
}

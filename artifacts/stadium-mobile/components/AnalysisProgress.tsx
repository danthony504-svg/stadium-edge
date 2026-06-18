import { Feather } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Animated, Easing, Text, View } from "react-native";

import { FONT } from "@/components/ui";
import { useColors } from "@/hooks/useColors";

// Cyan glow accent that pairs with the brand blue (#3b82f6). Kept local so the
// loading screen reads as "AI analysis in progress" without changing the global
// theme tokens.
const CYAN = "#22d3ee";
const BLUE = "#3b82f6";

// The ordered work the Coach actually performs while building a ticket: it reads
// the prompt, fetches real props + matchups + injuries, compares odds across the
// books in context, then the model reasons over edge / correlation / weak legs
// and finalizes. Each label maps to a genuine phase — see the stage→phase
// grounding in coach.tsx (context fetch → reasoning → picks streaming).
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

// Where the progress bar sits for each stage. Climbs steadily through the data
// phases, eases through model reasoning, and only hits 100% on the final stage.
const TARGETS = [6, 16, 28, 40, 52, 64, 74, 84, 93, 100] as const;

// The live checklist. Each item flips to "done" once we pass the stage where
// that work genuinely completes.
const CHECKLIST: { label: string; doneAt: number }[] = [
  { label: "Matchups analyzed", doneAt: 3 },
  { label: "Injury report checked", doneAt: 4 },
  { label: "Line value calculated", doneAt: 6 },
  { label: "Correlation scored", doneAt: 7 },
  { label: "Final ticket ready", doneAt: 9 },
];

/**
 * A step-by-step "AI is analyzing real data" loading screen shown while the
 * Coach builds a parlay or analyzes a ticket. Shows the current stage, a
 * 0→100% progress bar, and a live checklist that ticks off as work completes.
 *
 * It is grounded in the real build, not a cosmetic timer: stages advance while
 * context (odds/props/matchups) is fetched and the model reasons, and the final
 * "Finalizing your ticket…" stage + 100% only lands once real PICK lines start
 * streaming back (`legCount` > 0). In analyze mode there is no leg stream, so it
 * progresses on its own and is replaced by the analysis the moment it arrives.
 */
export function AnalysisProgress({
  mode = "build",
  legCount = 0,
}: {
  mode?: "build" | "analyze";
  legCount?: number;
}) {
  const colors = useColors();
  const [autoIndex, setAutoIndex] = useState(0);
  const [pct, setPct] = useState(0);

  // In build mode the auto-timer holds on "Building final AI grade…" (index 8)
  // until real picks stream — the finalize stage is driven by `legCount`, not a
  // clock. In analyze mode there is no leg signal, so it walks all the way to
  // the finalize stage on its own.
  const maxAuto = mode === "build" ? 8 : STAGES.length - 1;
  const effectiveIndex = mode === "build" && legCount > 0 ? STAGES.length - 1 : autoIndex;
  const target = TARGETS[effectiveIndex];

  // Advance the stage on a steady cadence (capped at maxAuto).
  useEffect(() => {
    const id = setInterval(() => {
      setAutoIndex((i) => (i < maxAuto ? i + 1 : i));
    }, 1500);
    return () => clearInterval(id);
  }, [maxAuto]);

  // Ease the displayed percentage toward the current stage's target so the bar
  // glides instead of jumping, and never looks frozen or goes backwards.
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

  // Soft pulse for the header glow dot + the progress bar so the surface always
  // reads as "actively working".
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

  const displayPct = Math.round(pct);
  // The first not-yet-done checklist item is the one currently in progress.
  const activeChecklist = CHECKLIST.findIndex((c) => effectiveIndex < c.doneAt);

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
        // Cyan glow
        shadowColor: CYAN,
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0.3,
        shadowRadius: 16,
        elevation: 8,
      }}
    >
      {/* Header: pulsing dot + current stage + live percentage */}
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
          numberOfLines={1}
          style={{
            flex: 1,
            color: colors.foreground,
            fontFamily: FONT.semibold,
            fontSize: 14,
          }}
        >
          {STAGES[effectiveIndex]}
        </Text>
        <Text
          style={{
            color: CYAN,
            fontFamily: FONT.bold,
            fontSize: 15,
            fontVariant: ["tabular-nums"],
          }}
        >
          {displayPct}%
        </Text>
      </View>

      {/* Progress bar 0 → 100% */}
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
              width: `${Math.max(displayPct, 2)}%`,
              height: "100%",
              borderRadius: 999,
            }}
          />
        </View>
      </Animated.View>

      {/* Live checklist */}
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
        {CHECKLIST.map((item, idx) => {
          const done = effectiveIndex >= item.doneAt;
          const active = idx === activeChecklist;
          return (
            <View
              key={item.label}
              style={{ flexDirection: "row", alignItems: "center", gap: 10 }}
            >
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

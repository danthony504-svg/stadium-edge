import Feather from "@expo/vector-icons/Feather";
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

// "ask" mode: a plain question (not a parlay build / ticket analysis). The Coach
// still does real work — it pulls live odds + props + matchup context and the
// model reasons over it — but there is no ticket, no correlation, and no weak-leg
// pass, so the copy stays generic and honest (no ticket-specific claims). Like
// analyze mode there is no leg stream, so it walks to the final stage on its own
// and is replaced the moment the answer streams in.
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

export type ParlayBuildPhase = "context" | "board-scan" | "stream" | "score";

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
  scoredLegCount = 0,
  requestedLegs = 0,
  buildPhase,
  awaitingPropSlots = false,
}: {
  mode?: "build" | "analyze" | "ask";
  /** When > 0, progress finalizes to 100% / Final ticket ready (cards on screen). */
  legCount?: number;
  /** Legs scored in the scan stash while cards may still be held off-screen. */
  scoredLegCount?: number;
  requestedLegs?: number;
  buildPhase?: ParlayBuildPhase;
  /** Preview is holding game lines while player props are still scoring. */
  awaitingPropSlots?: boolean;
}) {
  const colors = useColors();
  const [autoIndex, setAutoIndex] = useState(0);
  const [pct, setPct] = useState(0);

  // "ask" (plain question) has its own generic, honest stage set; build + analyze
  // share the ticket-oriented one.
  const isAsk = mode === "ask";
  const stageList = isAsk ? ASK_STAGES : STAGES;
  const targetList = isAsk ? ASK_TARGETS : TARGETS;
  const checklist = isAsk ? ASK_CHECKLIST : CHECKLIST;

  // In build mode the auto-timer holds below the penultimate stage during the
  // long context/board-scan fetch, then advances through grading while the scan
  // runs. During board-scan with no pick cards yet, cap below 100% until cards land.
  // Allow progress through 93% so the bar doesn't look frozen at 84% while sims run.
  const boardScanWaiting =
    mode === "build" && buildPhase === "board-scan" && legCount === 0;
  // Hold below "Final ticket ready" / 93% until real scored stash legs exist.
  // Soft timers alone used to park on Final ticket ready with an empty bubble.
  // Never enter "Final ticket ready" (stage 8 / 93% checklist) until cards are
  // actually on screen. Scored stash alone used to spin Final forever at 93%
  // while fixed-leg hold / broken escape left the bubble empty.
  const maxAuto =
    mode === "build"
      ? legCount > 0
        ? stageList.length - 1
        : boardScanWaiting ||
            buildPhase === "board-scan" ||
            buildPhase === "stream" ||
            buildPhase === "score"
          ? 7
          : 6
      : stageList.length - 1;
  const effectiveIndex =
    mode === "build" && legCount > 0
      ? stageList.length - 1
      : mode === "build"
        ? Math.min(autoIndex, maxAuto)
        : autoIndex;
  const target = legCount > 0 && mode === "build" ? 100 : targetList[effectiveIndex];
  const phaseStage =
    mode === "build" &&
    buildPhase === "board-scan" &&
    awaitingPropSlots &&
    scoredLegCount > 0 &&
    requestedLegs > 0
      ? `Scoring player props for your ${requestedLegs}-leg ticket…`
      : mode === "build" &&
          buildPhase === "board-scan" &&
          scoredLegCount > 0 &&
          requestedLegs > 0
        ? `Scored ${scoredLegCount} of ${requestedLegs} legs — finishing your ticket…`
        : mode === "build" && buildPhase === "board-scan" && scoredLegCount > 0
          ? `Scored ${scoredLegCount} legs — finishing your ticket…`
          : mode === "build" && buildPhase === "board-scan"
            ? "Scanning every posted market on the live board…"
            : mode === "build" && buildPhase === "context"
              ? "Pulling live odds and props…"
              : mode === "build" && buildPhase === "score" && legCount > 0
                ? "Finalizing your ticket…"
                : null;
  const displayStage = phaseStage ?? stageList[effectiveIndex];

  // Board-scan waits can last a minute — advance stages quickly so the bar does
  // not crawl (e.g. sit on 60% / "Line value") while feeds + sims warm up.
  const stageIntervalMs =
    mode === "build" && (buildPhase === "board-scan" || buildPhase === "stream")
      ? 550
      : 1500;

  // Advance the stage on a steady cadence (capped at maxAuto).
  useEffect(() => {
    const id = setInterval(() => {
      setAutoIndex((i) => (i < maxAuto ? i + 1 : i));
    }, stageIntervalMs);
    return () => clearInterval(id);
  }, [maxAuto, stageIntervalMs]);

  // Full-board scans can take a minute with no streamed PICK lines — hold on the
  // penultimate stage until real pick cards land so we never show a false 100%.
  // (The bar still eases to 93%; finalize only when legCount > 0.)

  // When legs are scoring off-screen / in stash, lift the floor so % tracks work
  // (2/6 → ~58%, 4/6 → ~75%) instead of crawling a cosmetic timer at 60%.
  const scoredFloor =
    mode === "build" && requestedLegs > 0 && scoredLegCount > 0 && legCount === 0
      ? Math.min(93, Math.round(40 + (53 * scoredLegCount) / requestedLegs))
      : 0;

  // Never pull % backwards below the scored floor; only cap runaway overshoot.
  useEffect(() => {
    if (mode === "build" && legCount === 0) {
      const stageCap = targetList[Math.min(autoIndex, maxAuto)]!;
      const cap = Math.max(scoredFloor, stageCap);
      setPct((p) => (p > cap ? cap : Math.max(p, scoredFloor)));
    }
  }, [mode, legCount, autoIndex, maxAuto, targetList, scoredFloor]);

  useEffect(() => {
    const ease = boardScanWaiting || scoredFloor > 0 ? 0.28 : 0.14;
    const id = setInterval(() => {
      setPct((p) => {
        const floor = Math.max(p, scoredFloor);
        const goal = Math.max(target, scoredFloor);
        if (floor >= goal) return goal;
        const next = floor + Math.max(0.8, (goal - floor) * ease);
        return next >= goal ? goal : next;
      });
    }, 50);
    return () => clearInterval(id);
  }, [target, boardScanWaiting, scoredFloor]);

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
  // First not-yet-done checklist item is active. When every pre-Final row is
  // already scored-done (e.g. Scored 6 of 6 @ 93%) but cards have not landed,
  // keep "Final ticket ready" spinning — never a dead empty circle.
  const scoredRatioForChecklist =
    !isAsk && requestedLegs > 0 && scoredLegCount > 0
      ? scoredLegCount / requestedLegs
      : 0;
  const checklistDoneFlags = checklist.map((item) => {
    const scoredDone =
      item.label === "Final ticket ready"
        ? false
        : item.label === "Correlation scored"
          ? scoredRatioForChecklist >= 0.75
          : item.label === "Line value calculated"
            ? scoredRatioForChecklist >= 0.5
            : item.label === "Injury report checked"
              ? scoredRatioForChecklist >= 0.35
              : item.label === "Matchups analyzed"
                ? scoredRatioForChecklist >= 0.2
                : false;
    if (item.label === "Final ticket ready") return legCount > 0;
    return effectiveIndex >= item.doneAt || scoredDone;
  });
  // Never activate "Final ticket ready" while cards are still missing — scored
  // stash alone used to leave Final spinning at 93% with an empty bubble.
  let activeChecklist = checklistDoneFlags.findIndex((done, i) => {
    if (done) return false;
    if (
      mode === "build" &&
      legCount === 0 &&
      checklist[i]?.label === "Final ticket ready"
    ) {
      return false;
    }
    return true;
  });
  if (activeChecklist < 0 && mode === "build" && legCount === 0) {
    activeChecklist = checklist.findIndex((c) => c.label === "Correlation scored");
  }

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
        {checklist.map((item, idx) => {
          const done = checklistDoneFlags[idx] ?? false;
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

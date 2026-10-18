import AsyncStorage from "@react-native-async-storage/async-storage";
import { setTourMenuFocus } from "@/lib/tourMenuFocus";
import { placeTourTooltip } from "@/lib/coachTourPlacement";
import React, { useCallback, useEffect, useState, type RefObject } from "react";
import { Modal, Pressable, Text, View, useWindowDimensions } from "react-native";

const TOUR_KEY = "stadium-edge:first-run-tour:v1";
export const FIRST_RUN_TOUR_STEPS = [
  { title: "Welcome to Stadium Edge", body: "Start with Search to explore games, players and real sportsbook lines without signing in." },
  { title: "Build Best Parlay", body: "Open AI Coach to request picks. Only qualified selections are shown." },
  { title: "Choose a sport", body: "Select a sport at the top to see its games and available markets." },
  { title: "Explore the Game Simulator", body: "Run simulations to explore possible game outcomes and estimated probabilities. Simulations inform decisions, not guaranteed results." },
  { title: "Discover Edge Lock", body: "Explore Edge Lock to review potential value between sportsbook odds and model estimates. An edge is an estimate, not a guaranteed win." },
] as const;

type TourFrame = { x: number; y: number; width: number; height: number };
type TourProps = {
  replayKey?: number;
  searchAnchorRef?: RefObject<View | null>;
  coachAnchorRef?: RefObject<View | null>;
  sportAnchorRef?: RefObject<View | null>;
};
export function FirstRunCoachTour({ replayKey = 0, searchAnchorRef, coachAnchorRef, sportAnchorRef }: TourProps) {
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const [anchorFrame, setAnchorFrame] = useState<TourFrame | null>(null);
  const [visible, setVisible] = useState(false);
  const [index, setIndex] = useState(0);
  useEffect(() => {
    let active = true;
    void AsyncStorage.getItem(TOUR_KEY)
      .then((value) => { if (active && value !== "completed") setVisible(true); })
      .catch(() => { /* fail closed: don't interrupt users when storage is unavailable */ });
    return () => { active = false; };
  }, []);
  useEffect(() => { if (replayKey > 0) { setIndex(0); setVisible(true); } }, [replayKey]);
  useEffect(() => {
    if (!visible) { setAnchorFrame(null); return; }
    setAnchorFrame(null);
    const target = index === 0 ? searchAnchorRef : index === 1 ? coachAnchorRef : index === 2 ? sportAnchorRef : undefined;
    if (!target?.current) { setAnchorFrame(null); return; }
    let active = true;
    const id = setTimeout(() => {
      target.current?.measureInWindow((x, y, width, height) => {
        if (!active) return;
        setAnchorFrame(width > 0 && height > 0 && y >= 0 && y < screenHeight
          ? { x, y, width, height } : null);
      });
    }, 80);
    return () => { active = false; clearTimeout(id); };
  }, [visible, index, searchAnchorRef, coachAnchorRef, sportAnchorRef, screenHeight]);
  const placement = placeTourTooltip(anchorFrame, screenHeight);
  const tooltipTop = placement?.top;
  const tooltipMaxWidth = Math.min(460, screenWidth - 48);

  const finish = useCallback(() => {
    setTourMenuFocus(null);
    setVisible(false);
    setIndex(0);
    void AsyncStorage.setItem(TOUR_KEY, "completed").catch(() => {});
  }, []);
  // Steps 4 and 5 live inside the actual navigation menu so both the
  // highlighted row and the tour controls remain visible at once.
  useEffect(() => {
    if (!visible || index < 3) {
      setTourMenuFocus(null);
      return;
    }
    setTourMenuFocus({
      route: index === 3 ? "/simulator" : "/arbitrage",
      step: index === 3 ? 4 : 5,
      onNext: () => index === 3 ? setIndex(4) : finish(),
      onBack: () => setIndex(index === 3 ? 2 : 3),
      onSkip: finish,
    });
  }, [visible, index, finish]);
  return (
    <Modal visible={visible && index < 3} transparent animationType="fade" onRequestClose={finish}>
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center", padding: 24 }}>
        {anchorFrame ? (
          // Four dark panes create a genuinely transparent spotlight instead of
          // tinting the control beneath a full-screen modal backdrop.
          <>
            <View pointerEvents="none" style={{ position: "absolute", left: 0, top: 0, right: 0, height: Math.max(0, anchorFrame.y - 5), backgroundColor: "rgba(2,8,22,0.84)" }} />
            <View pointerEvents="none" style={{ position: "absolute", left: 0, top: Math.max(0, anchorFrame.y - 5), width: Math.max(0, anchorFrame.x - 5), height: anchorFrame.height + 10, backgroundColor: "rgba(2,8,22,0.84)" }} />
            <View pointerEvents="none" style={{ position: "absolute", left: Math.min(screenWidth, anchorFrame.x + anchorFrame.width + 5), top: Math.max(0, anchorFrame.y - 5), right: 0, height: anchorFrame.height + 10, backgroundColor: "rgba(2,8,22,0.84)" }} />
            <View pointerEvents="none" style={{ position: "absolute", left: 0, top: anchorFrame.y + anchorFrame.height + 5, right: 0, bottom: 0, backgroundColor: "rgba(2,8,22,0.84)" }} />
            <View pointerEvents="none" accessibilityElementsHidden style={{ position: "absolute", left: Math.max(0, anchorFrame.x - 5), top: Math.max(0, anchorFrame.y - 5), width: anchorFrame.width + 10, height: anchorFrame.height + 10, borderColor: "#63a8ff", borderWidth: 4, borderRadius: 14 }} />
          </>
        ) : (
          <View pointerEvents="none" style={{ position: "absolute", left: 0, top: 0, right: 0, bottom: 0, backgroundColor: "rgba(2,8,22,0.84)" }} />
        )}
        <View style={{ backgroundColor: "#101b31", borderColor: "#398bff", borderWidth: 1, borderRadius: 22, padding: 24, gap: 16, width: tooltipMaxWidth, ...(tooltipTop !== undefined ? { position: "absolute" as const, top: tooltipTop } : {}) }}>
          {anchorFrame && placement ? <Text style={{ color: "#63a8ff", fontSize: 13 }}>{placement.direction === "below" ? "↑" : "↓"} Highlighted control</Text> : null}
          <Text accessibilityRole="header" style={{ color: "#88a9df", fontSize: 13 }}>
            STADIUM EDGE TOUR · {index + 1} OF {FIRST_RUN_TOUR_STEPS.length}
          </Text>
          <Text style={{ color: "white", fontSize: 23, fontWeight: "700" }}>{FIRST_RUN_TOUR_STEPS[index].title}</Text>
          <Text style={{ color: "#d3def2", fontSize: 16, lineHeight: 24 }}>{FIRST_RUN_TOUR_STEPS[index].body}</Text>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <Pressable accessibilityRole="button" onPress={finish} style={{ padding: 10 }}>
              <Text style={{ color: "#aabdd9", fontSize: 15 }}>Skip</Text>
            </Pressable>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              {index > 0 && (
                <Pressable accessibilityRole="button" onPress={() => setIndex((i) => Math.max(0, i - 1))} style={{ padding: 10 }}>
                  <Text style={{ color: "white" }}>Back</Text>
                </Pressable>
              )}
              <Pressable accessibilityRole="button" onPress={() => index === FIRST_RUN_TOUR_STEPS.length - 1 ? finish() : setIndex((i) => i + 1)}
                style={{ paddingVertical: 12, paddingHorizontal: 18, backgroundColor: "#347feb", borderRadius: 12 }}>
                <Text style={{ color: "white", fontWeight: "700" }}>{index === FIRST_RUN_TOUR_STEPS.length - 1 ? "Finish" : "Next"}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}

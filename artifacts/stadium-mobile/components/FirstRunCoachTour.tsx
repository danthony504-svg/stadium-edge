import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { useCallback, useEffect, useState } from "react";
import { Modal, Pressable, Text, View } from "react-native";

const TOUR_KEY = "stadium-edge:first-run-tour:v1";
export const FIRST_RUN_TOUR_STEPS = [
  { title: "Welcome to Stadium Edge", body: "Explore games and real sportsbook lines without signing in." },
  { title: "Build Best Parlay", body: "Open AI Coach to request picks. Only qualified selections are shown." },
  { title: "Choose a sport", body: "Select a sport at the top to see its games and available markets." },
  { title: "Understand your picks", body: "Open View AI Breakdown to understand grades, confidence, and supported simulation evidence." },
  { title: "Save your picks", body: "Sign in to save picks and access features included in your subscription." },
] as const;

export function FirstRunCoachTour({ replayKey = 0 }: { replayKey?: number }) {
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
  const finish = useCallback(() => {
    setVisible(false);
    setIndex(0);
    void AsyncStorage.setItem(TOUR_KEY, "completed").catch(() => {});
  }, []);
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={finish}>
      <View style={{ flex: 1, justifyContent: "center", backgroundColor: "rgba(2,8,22,0.84)", padding: 24 }}>
        <View style={{ backgroundColor: "#101b31", borderColor: "#398bff", borderWidth: 1, borderRadius: 22, padding: 24, gap: 16 }}>
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

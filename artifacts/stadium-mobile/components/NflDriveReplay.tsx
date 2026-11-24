import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";

import { Card, FONT } from "@/components/ui";
import { useColors } from "@/hooks/useColors";
import type { GameSimulationResult } from "@/lib/api";

type Props = {
  drives: NonNullable<GameSimulationResult["driveReplay"]>;
  simulations: number;
  away: string;
  home: string;
};

export function NflDriveReplay({ drives, simulations, away, home }: Props) {
  const colors = useColors();
  const [cursor, setCursor] = useState(0);
  const [playing, setPlaying] = useState(false);
  const complete = cursor === drives.length;

  useEffect(() => {
    if (!playing || complete) return;
    const timer = setTimeout(() => {
      setCursor(cursor + 1);
      if (cursor + 1 === drives.length) setPlaying(false);
    }, 900);
    return () => clearTimeout(timer);
  }, [complete, cursor, drives.length, playing]);

  const shown = drives.slice(0, cursor);
  const score = { away: 0, home: 0 };
  for (const drive of shown) score[drive.side] += drive.points;
  const latest = shown.at(-1);
  const driveText = latest
    ? `${latest.side === "home" ? home : away} · ${latest.points ? `+${latest.points} points` : "No score"}`
    : "Kickoff";

  return (
    <Card style={{ marginBottom: 12, gap: 10 }}>
      <Text style={{ color: colors.foreground, fontFamily: FONT.semibold, fontSize: 16 }}>
        Watch a Sim
      </Text>
      <Text style={{ color: colors.foreground }}>
        1 of {simulations.toLocaleString()} simulations · NFL drive replay
      </Text>
      <View style={{ backgroundColor: "#164533", borderRadius: 10, padding: 14, gap: 8 }}>
        <Text style={{ color: "#fff", fontFamily: FONT.semibold, fontSize: 20 }}>
          {away} {score.away} · {score.home} {home}
        </Text>
        <View style={{ flexDirection: "row", height: 8, gap: 3 }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          {drives.map((_, i) => (
            <View key={i} style={{ flex: 1, borderRadius: 2, backgroundColor: i < cursor ? "#b9f5c8" : "#547c69" }} />
          ))}
        </View>
        <Text accessibilityLiveRegion={playing ? "none" : "polite"} style={{ color: "#fff" }}>
          {complete ? "Final · " : ""}Drive {cursor}/{drives.length} · {driveText}
        </Text>
      </View>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 18 }}>
        <Pressable
          accessibilityRole="button"
          hitSlop={8}
          onPress={() => {
            if (complete) setCursor(0);
            setPlaying(!playing);
          }}
        >
          <Text style={{ color: colors.foreground, fontFamily: FONT.semibold }}>
            {playing ? "Pause" : complete ? "Replay" : cursor ? "Resume" : "Play"}
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: complete }}
          disabled={complete}
          hitSlop={8}
          onPress={() => {
            setPlaying(false);
            setCursor(Math.min(cursor + 1, drives.length));
          }}
        >
          <Text style={{ color: colors.foreground, opacity: complete ? 0.45 : 1 }}>
            Next drive
          </Text>
        </Pressable>
      </View>
    </Card>
  );
}

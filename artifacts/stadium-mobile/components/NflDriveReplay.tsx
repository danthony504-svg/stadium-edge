import { useEffect, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";

import { Card, FONT } from "@/components/ui";
import { useColors } from "@/hooks/useColors";
import { formatPropProjectedStat, propSimulationCount } from "@/lib/simulatorPropMetrics";
import { propMarketLabel } from "@/lib/propMarketLabel";
import type { GameSimulationResult, PropSimulationResult } from "@/lib/api";

type Props = {
  drives: NonNullable<GameSimulationResult["driveReplay"]>;
  simulations: number;
  away: string;
  home: string;
  props: PropSimulationResult[];
  onSelectProps: () => void;
};

const YARD_MARKETS = new Set([
  "player_pass_yds",
  "player_rush_yds",
  "player_reception_yds",
  "player_pass_rush_yds",
  "player_rush_reception_yds",
  "player_pass_rush_reception_yds",
]);

export function NflDriveReplay({ drives, simulations, away, home, props, onSelectProps }: Props) {
  const colors = useColors();
  const [cursor, setCursor] = useState(0);
  const [playing, setPlaying] = useState(false);
  const complete = cursor === drives.length;
  const trackWidth = useRef(0);
  const trackStart = useRef(0);
  const position = cursor / drives.length;

  function seek(next: number) {
    setPlaying(false);
    setCursor(Math.max(0, Math.min(drives.length, next)));
  }

  function seekAt(pageX: number) {
    if (trackWidth.current > 0) {
      seek(Math.round(((pageX - trackStart.current) / trackWidth.current) * drives.length));
    }
  }

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
  const yardProps = props.filter((prop) => YARD_MARKETS.has(prop.market) && propSimulationCount(prop) > 0);
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
        <View
          accessible
          accessibilityRole="adjustable"
          accessibilityLabel="Replay position"
          accessibilityValue={{ min: 0, max: drives.length, now: cursor }}
          accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
          onAccessibilityAction={({ nativeEvent }) => {
            if (nativeEvent.actionName === "increment") seek(cursor + 1);
            if (nativeEvent.actionName === "decrement") seek(cursor - 1);
          }}
          onLayout={({ nativeEvent }) => { trackWidth.current = nativeEvent.layout.width; }}
          onStartShouldSetResponder={() => true}
          onResponderGrant={({ nativeEvent }) => {
            trackStart.current = nativeEvent.pageX - nativeEvent.locationX;
            seekAt(nativeEvent.pageX);
          }}
          onResponderMove={({ nativeEvent }) => seekAt(nativeEvent.pageX)}
          onResponderTerminationRequest={() => false}
          style={{ height: 44, justifyContent: "center", marginHorizontal: 10 }}
        >
          <View pointerEvents="none" style={{ height: 6, backgroundColor: "#547c69", borderRadius: 3 }}>
            <View style={{ width: `${position * 100}%`, height: 6, borderRadius: 3, backgroundColor: "#b9f5c8" }} />
            <View style={{ position: "absolute", left: `${position * 100}%`, top: -7, marginLeft: -10, width: 20, height: 20, borderRadius: 10, backgroundColor: "#fff" }} />
          </View>
        </View>
        <View
          accessible
          accessibilityLabel="Football field illustration"
          style={{ height: 118, borderRadius: 6, overflow: "hidden", flexDirection: "row", borderWidth: 1, borderColor: "#b9f5c8" }}
        >
          {[away, ...Array.from({ length: 10 }, () => null), home].map((team, index) => (
            <View
              key={index}
              style={{
                flex: 1,
                backgroundColor: team ? "#18335d" : index % 2 ? "#245c40" : "#1c5036",
                borderLeftWidth: index ? 1 : 0,
                borderLeftColor: "#b9f5c8",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              {team ? (
                <Text numberOfLines={1} style={{ color: "#fff", fontSize: 9, fontFamily: FONT.bold }}>{team}</Text>
              ) : index === 5 || index === 6 ? (
                <Text style={{ color: "#e3ffe9", fontSize: 9 }}>50</Text>
              ) : null}
            </View>
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
          onPress={() => seek(cursor + 1)}
        >
          <Text style={{ color: colors.foreground, opacity: complete ? 0.45 : 1 }}>
            Next drive
          </Text>
        </Pressable>
      </View>
      <View style={{ borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 12, gap: 8 }}>
        <Text style={{ color: colors.foreground, fontFamily: FONT.semibold }}>Player Props · Full Game</Text>
        {yardProps.length ? yardProps.map((prop) => (
          <View key={prop.key} style={{ flexDirection: "row", justifyContent: "space-between", gap: 12 }}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: colors.foreground, fontFamily: FONT.semibold }}>{prop.player}</Text>
              <Text style={{ color: colors.mutedForeground }}>
                {propMarketLabel(prop.market)} · {prop.side} {prop.line}
              </Text>
            </View>
            <View>
              <Text style={{ color: colors.foreground }}>{formatPropProjectedStat(prop)} projected</Text>
              {prop.hitProbability != null ? (
                <Text style={{ color: colors.mutedForeground }}>{Math.round(prop.hitProbability * 100)}% sim hit</Text>
              ) : null}
            </View>
          </View>
        )) : (
          <Pressable accessibilityRole="button" onPress={onSelectProps}>
            <Text style={{ color: colors.primary }}>Select yardage props in Full Simulation</Text>
          </Pressable>
        )}
      </View>
    </Card>
  );
}

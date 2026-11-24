import { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import Feather from "@expo/vector-icons/Feather";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import Svg, { Defs, LinearGradient as FieldGradient, Line, Path, Polygon, Stop, Text as FieldText } from "react-native-svg";

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
  awayLogo?: string | null;
  homeLogo?: string | null;
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

export function NflDriveReplay({ drives, simulations, away, home, awayLogo, homeLogo, props, onSelectProps }: Props) {
  const colors = useColors();
  const [cursor, setCursor] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [propsOpen, setPropsOpen] = useState(false);
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

  const playbackLabel = playing ? "Pause" : complete ? "Replay" : cursor ? "Resume" : "Play";
  function togglePlayback() {
    if (complete) setCursor(0);
    setPlaying(!playing);
  }

  return (
    <Card style={styles.card}>
      <View style={styles.heading}>
        <Feather name="film" color="#70d9ff" size={24} />
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Watch a Sim</Text>
          <Text style={styles.subtitle}>1 of {simulations.toLocaleString()} simulations · NFL drive replay</Text>
        </View>
      </View>
      <View style={styles.scoreboard}>
        <ReplayTeam name={away} logo={awayLogo} score={score.away} side="away" />
        <ReplayTeam name={home} logo={homeLogo} score={score.home} side="home" />
        <View pointerEvents="none" style={styles.scoreDivider}><Text style={styles.scoreDot}>·</Text></View>
      </View>
      <View style={styles.timeline}>
        <Pressable accessibilityRole="button" accessibilityLabel={playbackLabel} onPress={togglePlayback} style={styles.play}>
          <Feather name={playing ? "pause" : complete ? "rotate-ccw" : "play"} size={17} color="#c4edff" />
        </Pressable>
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
          style={styles.scrubber}
        >
          <View pointerEvents="none" style={{ height: 6, backgroundColor: "#27435e", borderRadius: 3 }}>
            <View style={{ width: `${position * 100}%`, height: 6, borderRadius: 3, backgroundColor: "#61d6ff" }} />
            <View style={{ position: "absolute", left: `${position * 100}%`, top: -7, marginLeft: -10, width: 20, height: 20, borderRadius: 10, backgroundColor: "#fff" }} />
          </View>
        </View>
      </View>
      <ReplayField away={away} home={home} activeSide={latest?.side} />
      <View style={styles.status}>
        <Text style={styles.statusText}>{complete ? "Final" : cursor ? `Drive ${cursor}/${drives.length}` : "Kickoff"}</Text>
        {complete ? <Text style={styles.subtitle}>Drive {cursor}/{drives.length}</Text> : null}
        {latest ? (
          <Text accessibilityLiveRegion={playing ? "none" : "polite"} style={styles.driveText}>{driveText}</Text>
        ) : null}
      </View>
      <View style={styles.actions}>
        <Pressable accessibilityRole="button" onPress={togglePlayback} style={[styles.action, styles.primaryAction]}>
          <Text style={styles.actionText}>{playbackLabel}</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: complete }}
          disabled={complete}
          onPress={() => seek(cursor + 1)}
          style={[styles.action, complete && { opacity: 0.45 }]}
        >
          <Text style={styles.actionText}>Next drive</Text>
          <Feather name="skip-forward" size={15} color="#c4edff" />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: propsOpen }}
          onPress={() => setPropsOpen((open) => !open)}
          style={styles.action}
        >
          <Text style={styles.actionText}>Full-game Props</Text>
          <Feather name={propsOpen ? "chevron-up" : "chevron-down"} size={15} color="#c4edff" />
        </Pressable>
      </View>
      {propsOpen ? <View style={{ backgroundColor: colors.card, borderRadius: 10, padding: 12, gap: 8 }}>
        <Text style={{ color: colors.foreground, fontFamily: FONT.semibold }}>Full-game projections</Text>
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
      </View> : null}
    </Card>
  );
}

function ReplayTeam({ name, logo, score, side }: {
  name: string;
  logo?: string | null;
  score: number;
  side: "away" | "home";
}) {
  return (
    <LinearGradient
      colors={side === "away" ? ["#164a3e", "#0c272e"] : ["#123462", "#102746"]}
      style={[styles.team, side === "home" && { flexDirection: "row-reverse" }]}
    >
      {logo ? <Image source={logo} contentFit="contain" style={styles.logo} /> : null}
      <Text numberOfLines={1} style={styles.teamLabel}>{name}</Text>
      <Text style={styles.score}>{score}</Text>
    </LinearGradient>
  );
}

const YARD_STRIPES = Array.from({ length: 11 }, (_, index) => index);
const HASH_MARKS = Array.from({ length: 49 }, (_, index) => index + 1);

function ReplayField({ away, home, activeSide }: {
  away: string;
  home: string;
  activeSide?: "away" | "home";
}) {
  const fieldX = (yard: number, y: number) => 43 - y * 0.105 + yard * (2.74 + y * 0.0021);
  const hashPath = [29, 69].flatMap((y) => HASH_MARKS.map((mark) =>
    `M${fieldX(mark * 2, y)},${y} L${fieldX(mark * 2, y + 4)},${y + 4}`,
  )).join(" ");

  return (
    <View accessible accessibilityLabel="Football field illustration" style={styles.field}>
      <Svg width="100%" height="100%" viewBox="0 0 360 104">
        <Defs>
          <FieldGradient id="replayTurf" x1="0%" y1="0%" x2="0%" y2="100%">
            <Stop offset="0%" stopColor="#206844" />
            <Stop offset="100%" stopColor="#103726" />
          </FieldGradient>
        </Defs>
        <Polygon points="18,5 342,5 356,99 4,99" fill="url(#replayTurf)" />
        <Polygon points="18,5 42.5,5 32.6,99 4,99" fill={activeSide === "away" ? "#177c57" : "#123e36"} />
        <Polygon points="317.5,5 342,5 356,99 327.4,99" fill={activeSide === "home" ? "#225bc5" : "#12396f"} />
        {YARD_STRIPES.map((index) => {
          const yard = index * 10;
          return (
            <Line key={yard} x1={fieldX(yard, 5)} y1={5} x2={fieldX(yard, 99)} y2={99} stroke="#deffec" strokeOpacity={index === 5 ? 0.9 : 0.55} />
          );
        })}
        <Path d={hashPath} stroke="#ceffe0" strokeOpacity={0.75} strokeWidth={0.65} />
        {[23, 89].flatMap((y) => YARD_STRIPES.slice(1, -1).map((index) => (
          <FieldText key={`${y}:${index}`} x={fieldX(index * 10, y)} y={y} fill="#f1fdf6" fontSize={9} fontWeight="bold" textAnchor="middle">
            {Math.min(index, 10 - index) * 10}
          </FieldText>
        )))}
        <FieldText x={25} y={56} rotation={-90} originX={25} originY={52} fill="#fff" fontSize={13} fontWeight="bold" textAnchor="middle">{away}</FieldText>
        <FieldText x={335} y={56} rotation={90} originX={335} originY={52} fill="#fff" fontSize={13} fontWeight="bold" textAnchor="middle">{home}</FieldText>
        {activeSide ? (
          <FieldText x={180} y={56} fill="#a5eaff" fontSize={10} fontWeight="bold" textAnchor="middle">
            {activeSide === "away" ? away : home} DRIVE
          </FieldText>
        ) : null}
        <Polygon points="18,5 342,5 356,99 4,99" fill="none" stroke="#defcf1" strokeWidth={1.8} strokeLinejoin="round" />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { marginBottom: 12, gap: 10, backgroundColor: "#09182a", borderColor: "#264866" },
  heading: { flexDirection: "row", alignItems: "center", gap: 10 },
  title: { color: "#f4f8ff", fontFamily: FONT.bold, fontSize: 20 },
  subtitle: { color: "#a9bdd5", fontSize: 12 },
  scoreboard: { flexDirection: "row", borderWidth: 1, borderColor: "#345876", borderRadius: 12, overflow: "hidden" },
  scoreDivider: { position: "absolute", left: "50%", top: 0, bottom: 0, width: 16, marginLeft: -8, alignItems: "center", justifyContent: "center" },
  scoreDot: { color: "#eff9ff", fontFamily: FONT.bold, fontSize: 22 },
  team: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", paddingVertical: 10, paddingHorizontal: 4, gap: 6 },
  logo: { width: 30, height: 30, backgroundColor: "#e8f4fb", borderRadius: 6 },
  teamLabel: { color: "#f4f8ff", fontFamily: FONT.bold, fontSize: 13, flexShrink: 1 },
  score: { color: "#fff", fontFamily: FONT.bold, fontSize: 25, fontVariant: ["tabular-nums"] },
  timeline: { flexDirection: "row", alignItems: "center", gap: 10 },
  play: { width: 44, height: 44, borderRadius: 22, borderWidth: 1, borderColor: "#497ba9", backgroundColor: "#12365b", alignItems: "center", justifyContent: "center" },
  scrubber: { flex: 1, height: 44, justifyContent: "center", marginHorizontal: 10 },
  field: { aspectRatio: 360 / 104, backgroundColor: "#0b2924", borderRadius: 12, padding: 3 },
  status: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 10, padding: 10, borderRadius: 10, backgroundColor: "#12253b" },
  statusText: { color: "#f4f8ff", fontFamily: FONT.semibold, fontSize: 13 },
  driveText: { color: "#79ddff", fontFamily: FONT.semibold, fontSize: 12 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
  action: { minHeight: 44, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4, paddingHorizontal: 10, borderRadius: 10, borderWidth: 1, borderColor: "#345876", backgroundColor: "#12253b" },
  primaryAction: { backgroundColor: "#144879", borderColor: "#5497d0" },
  actionText: { color: "#e6f4ff", fontFamily: FONT.semibold, fontSize: 12 },
});

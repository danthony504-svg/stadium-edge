import { useEffect, useRef, useState, type ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import Feather from "@expo/vector-icons/Feather";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import Svg, { Circle, Defs, LinearGradient as FieldGradient, Line, Path, Polygon, Rect, Stop, Text as FieldText } from "react-native-svg";

import { Card, FONT } from "@/components/ui";
import type { GameSimulationResult } from "@/lib/api";

type Props = {
  simulations: number;
  away: string;
  home: string;
  awayLogo?: string | null;
  homeLogo?: string | null;
  matchupTime: string;
  endOfGame?: ReactNode;
} & (
  | { sport: "nfl"; drives: NonNullable<GameSimulationResult["driveReplay"]> }
  | { sport: "nba"; finalScore: { away: number; home: number } }
);

export function GameReplay(replay: Props) {
  const { simulations, away, home, awayLogo, homeLogo, matchupTime, endOfGame } = replay;
  const stepCount = replay.sport === "nba" ? 4 : replay.drives.length;
  const [cursor, setCursor] = useState(0);
  const [playing, setPlaying] = useState(false);
  const complete = cursor === stepCount;
  const trackWidth = useRef(0);
  const trackStart = useRef(0);
  const position = cursor / stepCount;

  function seek(next: number) {
    setPlaying(false);
    setCursor(Math.max(0, Math.min(stepCount, next)));
  }

  function seekAt(pageX: number) {
    if (trackWidth.current > 0) {
      seek(Math.round(((pageX - trackStart.current) / trackWidth.current) * stepCount));
    }
  }

  useEffect(() => {
    if (!playing || complete) return;
    const timer = setTimeout(() => {
      setCursor(cursor + 1);
      if (cursor + 1 === stepCount) setPlaying(false);
    }, 900);
    return () => clearTimeout(timer);
  }, [complete, cursor, stepCount, playing]);

  const score = { away: 0, home: 0 };
  if (replay.sport === "nba") {
    score.away = Math.round(replay.finalScore.away * position);
    score.home = Math.round(replay.finalScore.home * position);
  } else {
    for (const drive of replay.drives.slice(0, cursor)) score[drive.side] += drive.points;
  }
  const latest = replay.sport === "nfl" && cursor ? replay.drives[cursor - 1] : undefined;
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
          <Text style={styles.subtitle}>{matchupTime}</Text>
          <Text style={styles.subtitle}>1 of {simulations.toLocaleString()} simulations · {replay.sport === "nba" ? "NBA replay" : "NFL drive replay"}</Text>
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
          accessibilityValue={{ min: 0, max: stepCount, now: cursor }}
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
      {replay.sport === "nba" ? (
        <>
          <View style={styles.quarterStops}>
            {["Tipoff", "Q1", "Q2", "Q3", "Q4"].map((label, index) => (
              <Pressable
                key={label}
                accessibilityRole="button"
                accessibilityState={{ selected: cursor === index }}
                onPress={() => seek(index)}
                style={[styles.quarterStop, cursor === index && styles.primaryAction]}
              >
                <Text style={styles.actionText}>{label}</Text>
              </Pressable>
            ))}
          </View>
          <ReplayCourt />
          <Text style={styles.subtitle}>Illustrative quarter scores from one simulated final</Text>
        </>
      ) : <ReplayField away={away} home={home} activeSide={latest?.side} />}
      <View style={styles.status}>
        <Text style={styles.statusText}>
          {replay.sport === "nba"
            ? cursor ? `End of Q${cursor} · ${cursor * 12}:00 elapsed` : "Tipoff"
            : complete ? "Final" : cursor ? `Drive ${cursor}/${stepCount}` : "Kickoff"}
        </Text>
        {complete && replay.sport === "nfl" ? <Text style={styles.subtitle}>Drive {cursor}/{stepCount}</Text> : null}
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
          <Text style={styles.actionText}>{replay.sport === "nba" ? "Next quarter" : "Next drive"}</Text>
          <Feather name="skip-forward" size={15} color="#c4edff" />
        </Pressable>
      </View>
      {complete ? endOfGame : null}
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

function ReplayCourt() {
  const line = "#fff2d3";
  return (
    <View accessible accessibilityLabel="Basketball court illustration" style={styles.field}>
      <Svg width="100%" height="100%" viewBox="0 0 360 104">
        <Rect x={4} y={4} width={352} height={96} rx={5} fill="#b77941" stroke={line} strokeWidth={2} />
        <Line x1={180} x2={180} y1={4} y2={100} stroke={line} />
        <Circle cx={180} cy={52} r={15} fill="#92522d" stroke={line} />
        <Rect x={4} y={34} width={56} height={36} fill="#92522d" stroke={line} />
        <Rect x={300} y={34} width={56} height={36} fill="#92522d" stroke={line} />
        <Circle cx={60} cy={52} r={12} fill="none" stroke={line} />
        <Circle cx={300} cy={52} r={12} fill="none" stroke={line} />
        <Path d="M4 12 H24 A48 40 0 0 1 24 92 H4 M356 12 H336 A48 40 0 0 0 336 92 H356" fill="none" stroke={line} />
        <Circle cx={18} cy={52} r={4} fill="none" stroke={line} />
        <Circle cx={342} cy={52} r={4} fill="none" stroke={line} />
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
  quarterStops: { flexDirection: "row", flexWrap: "wrap", gap: 5 },
  quarterStop: { flexGrow: 1, minHeight: 44, alignItems: "center", justifyContent: "center", borderRadius: 8, borderWidth: 1, borderColor: "#345876", paddingHorizontal: 6 },
  field: { aspectRatio: 360 / 104, backgroundColor: "#0b2924", borderRadius: 12, padding: 3 },
  status: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 10, padding: 10, borderRadius: 10, backgroundColor: "#12253b" },
  statusText: { color: "#f4f8ff", fontFamily: FONT.semibold, fontSize: 13 },
  driveText: { color: "#79ddff", fontFamily: FONT.semibold, fontSize: 12 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
  action: { minHeight: 44, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4, paddingHorizontal: 10, borderRadius: 10, borderWidth: 1, borderColor: "#345876", backgroundColor: "#12253b" },
  primaryAction: { backgroundColor: "#144879", borderColor: "#5497d0" },
  actionText: { color: "#e6f4ff", fontFamily: FONT.semibold, fontSize: 12 },
});

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import Feather from "@expo/vector-icons/Feather";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import Svg, {
  Circle,
  Defs,
  Ellipse,
  LinearGradient as FieldGradient,
  Line,
  Path,
  Polygon,
  Rect,
  Stop,
  Text as FieldText,
} from "react-native-svg";

import { Card, FONT } from "@/components/ui";
import type { GameSimulationResult } from "@/lib/api";

export type ReplaySport =
  | "nfl"
  | "ncaaf"
  | "nba"
  | "wnba"
  | "ncaab"
  | "nhl"
  | "mlb"
  | "soccer";

type Drive = NonNullable<GameSimulationResult["driveReplay"]>[number];

type Props = {
  sport: ReplaySport;
  simulations: number;
  away: string;
  home: string;
  awayLogo?: string | null;
  homeLogo?: string | null;
  matchupTime: string;
  /** Optional footer below actions (e.g. deep-link CTA). */
  footer?: ReactNode;
  drives?: Drive[];
  finalScore?: { away: number; home: number };
};

type SportReplayConfig = {
  label: string;
  segments: string[];
  nextLabel: string;
  surface: "field" | "court" | "rink" | "diamond" | "pitch";
  /** Minutes / clock text per completed segment (illustrative). */
  clockFor: (cursor: number, total: number) => string;
};

function sportConfig(sport: ReplaySport, hasDrives: boolean): SportReplayConfig {
  if (sport === "nfl" || sport === "ncaaf") {
    if (hasDrives) {
      return {
        label: sport === "nfl" ? "NFL drive replay" : "NCAAF drive replay",
        segments: [],
        nextLabel: "Next drive",
        surface: "field",
        clockFor: (c, total) => (c >= total ? "Final" : c ? `Drive ${c}/${total}` : "Kickoff"),
      };
    }
    return {
      label: sport === "nfl" ? "NFL score replay" : "NCAAF score replay",
      segments: ["Kickoff", "Q1", "Q2", "Q3", "Q4"],
      nextLabel: "Next quarter",
      surface: "field",
      clockFor: (c) => (c ? `End of Q${c} · ${c * 15}:00 elapsed` : "Kickoff"),
    };
  }
  if (sport === "nhl") {
    return {
      label: "NHL period replay",
      segments: ["Faceoff", "P1", "P2", "P3"],
      nextLabel: "Next period",
      surface: "rink",
      clockFor: (c) => (c ? `End of P${c} · ${c * 20}:00 elapsed` : "Faceoff"),
    };
  }
  if (sport === "mlb") {
    return {
      label: "MLB inning replay",
      segments: ["First", "3", "6", "9"],
      nextLabel: "Next inning",
      surface: "diamond",
      clockFor: (c, total) => (c >= total ? "Final" : c ? `Through inning ${[0, 3, 6, 9][c] ?? c}` : "First pitch"),
    };
  }
  if (sport === "soccer") {
    return {
      label: "Soccer half replay",
      segments: ["Kickoff", "H1", "H2"],
      nextLabel: "Next half",
      surface: "pitch",
      clockFor: (c) => (c === 0 ? "Kickoff" : c === 1 ? "Halftime · 45:00" : "Full time · 90:00"),
    };
  }
  if (sport === "wnba") {
    return {
      label: "WNBA replay",
      segments: ["Tipoff", "Q1", "Q2", "Q3", "Q4"],
      nextLabel: "Next quarter",
      surface: "court",
      clockFor: (c) => (c ? `End of Q${c} · ${c * 10}:00 elapsed` : "Tipoff"),
    };
  }
  if (sport === "ncaab") {
    return {
      label: "NCAAB replay",
      segments: ["Tipoff", "H1", "H2"],
      nextLabel: "Next half",
      surface: "court",
      clockFor: (c) => (c === 0 ? "Tipoff" : c === 1 ? "Halftime · 20:00" : "Final · 40:00"),
    };
  }
  return {
    label: "NBA replay",
    segments: ["Tipoff", "Q1", "Q2", "Q3", "Q4"],
    nextLabel: "Next quarter",
    surface: "court",
    clockFor: (c) => (c ? `End of Q${c} · ${c * 12}:00 elapsed` : "Tipoff"),
  };
}

export function supportsGameReplay(sport: string): sport is ReplaySport {
  return ["nfl", "ncaaf", "nba", "wnba", "ncaab", "nhl", "mlb", "soccer"].includes(sport);
}

export function GameReplay(replay: Props) {
  const drives = replay.drives ?? [];
  const isDriveSport =
    (replay.sport === "nfl" || replay.sport === "ncaaf") && drives.length > 0;
  const cfg = sportConfig(replay.sport, isDriveSport);
  const stepCount = isDriveSport
    ? Math.max(1, drives.length)
    : Math.max(1, cfg.segments.length - 1);
  const [cursor, setCursor] = useState(0);
  const [playing, setPlaying] = useState(false);
  const complete = cursor >= stepCount;
  const trackWidth = useRef(0);
  const trackStart = useRef(0);
  const position = stepCount ? cursor / stepCount : 0;

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
      const next = cursor + 1;
      setCursor(next);
      if (next >= stepCount) setPlaying(false);
    }, 900);
    return () => clearTimeout(timer);
  }, [complete, cursor, stepCount, playing]);

  const score = useMemo(() => {
    if (isDriveSport) {
      const out = { away: 0, home: 0 };
      for (const drive of drives.slice(0, cursor)) out[drive.side] += drive.points;
      return out;
    }
    const final = replay.finalScore ?? { away: 0, home: 0 };
    return {
      away: Math.round(final.away * position),
      home: Math.round(final.home * position),
    };
  }, [isDriveSport, drives, cursor, replay.finalScore, position]);

  const latest = isDriveSport && cursor ? drives[cursor - 1] : undefined;
  const driveText = latest
    ? `${latest.side === "home" ? replay.home : replay.away} · ${
        latest.points ? `+${latest.points} points` : "No score"
      }`
    : null;

  const leadingSide =
    score.away === score.home ? null : score.away > score.home ? "away" : "home";

  function togglePlayback() {
    if (complete) setCursor(0);
    setPlaying((p) => !p);
  }

  return (
    <Card style={styles.card}>
      <View style={styles.heading}>
        <View style={styles.filmBadge}>
          <Feather name="film" color="#70d9ff" size={18} />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={styles.title}>Watch a Sim</Text>
          <Text style={styles.subtitle}>{replay.matchupTime}</Text>
          <Text style={styles.subtitle}>
            Selected from {replay.simulations.toLocaleString()} simulations · {cfg.label}
          </Text>
        </View>
      </View>

      <View style={styles.scoreboard}>
        <ReplayTeam
          name={replay.away}
          logo={replay.awayLogo}
          score={score.away}
          side="away"
          glow={leadingSide === "away"}
        />
        <ReplayTeam
          name={replay.home}
          logo={replay.homeLogo}
          score={score.home}
          side="home"
          glow={leadingSide === "home"}
        />
        <View pointerEvents="none" style={styles.scoreDivider}>
          <View style={styles.scoreChevron}>
            <Feather name="chevrons-right" size={14} color="#8be9ff" />
          </View>
        </View>
      </View>

      <View style={styles.timeline}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={playing ? "Pause" : complete ? "Replay" : "Play"}
          onPress={togglePlayback}
          style={styles.playBtn}
        >
          <Feather name={playing ? "pause" : "play"} size={18} color="#e8f7ff" />
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
          onLayout={({ nativeEvent }) => {
            trackWidth.current = nativeEvent.layout.width;
          }}
          onStartShouldSetResponder={() => true}
          onResponderGrant={({ nativeEvent }) => {
            trackStart.current = nativeEvent.pageX - nativeEvent.locationX;
            seekAt(nativeEvent.pageX);
          }}
          onResponderMove={({ nativeEvent }) => seekAt(nativeEvent.pageX)}
          onResponderTerminationRequest={() => false}
          style={styles.scrubber}
        >
          <View pointerEvents="none" style={styles.scrubTrack}>
            <LinearGradient
              colors={["#1ec8ff", "#3b82f6"]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={{ width: `${position * 100}%`, height: 8, borderRadius: 4 }}
            />
            <View
              style={[
                styles.scrubThumb,
                { left: `${position * 100}%` },
              ]}
            />
          </View>
        </View>
      </View>

      {cfg.segments.length > 0 ? (
        <View style={styles.quarterStops}>
          {cfg.segments.map((label, index) => {
            const selected = cursor === index;
            return (
              <Pressable
                key={label}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                onPress={() => seek(index)}
                style={[styles.quarterStop, selected && styles.quarterStopActive]}
              >
                <Text style={[styles.actionText, selected && styles.actionTextOn]}>
                  {label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}

      {cfg.surface === "field" ? (
        <ReplayField
          away={replay.away}
          home={replay.home}
          activeSide={latest?.side}
          progress={position}
        />
      ) : null}
      {cfg.surface === "court" ? <ReplayCourt progress={position} /> : null}
      {cfg.surface === "rink" ? <ReplayRink progress={position} /> : null}
      {cfg.surface === "diamond" ? <ReplayDiamond progress={position} /> : null}
      {cfg.surface === "pitch" ? <ReplayPitch progress={position} /> : null}

      {!isDriveSport ? (
        <Text style={styles.caption}>
          Illustrative {cfg.segments.length ? "period" : "score"} progression from one simulated final
        </Text>
      ) : null}

      <View style={styles.status}>
        <View style={styles.statusSeg}>
          <Feather name="clock" size={13} color="#9ec3df" />
          <Text style={styles.statusText}>
            {complete && isDriveSport ? "Final" : cfg.clockFor(cursor, stepCount)}
          </Text>
        </View>
        {isDriveSport ? (
          <>
            <View style={styles.statusRule} />
            <View style={styles.statusSeg}>
              <Feather name="activity" size={13} color="#9ec3df" />
              <Text style={styles.statusText}>
                Drive {Math.min(cursor, stepCount)}/{stepCount}
              </Text>
            </View>
          </>
        ) : null}
        {driveText ? (
          <>
            <View style={styles.statusRule} />
            <Text style={styles.driveText} numberOfLines={1}>
              {driveText}
            </Text>
          </>
        ) : null}
      </View>

      <View style={styles.actions}>
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            setCursor(0);
            setPlaying(true);
          }}
          style={[styles.action, styles.primaryAction]}
        >
          <Feather name="rotate-ccw" size={14} color="#e6f4ff" />
          <Text style={styles.actionText}>Replay</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: complete }}
          disabled={complete}
          onPress={() => seek(cursor + 1)}
          style={[styles.action, complete && { opacity: 0.4 }]}
        >
          <Text style={styles.actionText}>{cfg.nextLabel}</Text>
          <Feather name="skip-forward" size={14} color="#c4edff" />
        </Pressable>
        {replay.footer ? <View style={styles.footerSlot}>{replay.footer}</View> : null}
      </View>
    </Card>
  );
}

function ReplayTeam({
  name,
  logo,
  score,
  side,
  glow,
}: {
  name: string;
  logo?: string | null;
  score: number;
  side: "away" | "home";
  glow?: boolean;
}) {
  return (
    <LinearGradient
      colors={side === "away" ? ["#1a5c45", "#0c272e"] : ["#15407a", "#0d1f3a"]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={[styles.team, side === "home" && { flexDirection: "row-reverse" }]}
    >
      {logo ? (
        <Image source={logo} contentFit="contain" style={styles.logo} />
      ) : name.length > 4 ? (
        <View style={[styles.logo, styles.logoFallback]}>
          <Text style={styles.logoFallbackText}>{name.slice(0, 2)}</Text>
        </View>
      ) : null}
      <Text numberOfLines={1} style={styles.teamLabel}>
        {name}
      </Text>
      <Text style={[styles.score, glow && styles.scoreGlow]}>{score}</Text>
    </LinearGradient>
  );
}

const YARD_STRIPES = Array.from({ length: 11 }, (_, index) => index);
const HASH_MARKS = Array.from({ length: 49 }, (_, index) => index + 1);

function ReplayField({
  away,
  home,
  activeSide,
  progress,
}: {
  away: string;
  home: string;
  activeSide?: "away" | "home";
  progress: number;
}) {
  const fieldX = (yard: number, y: number) => 43 - y * 0.105 + yard * (2.74 + y * 0.0021);
  const hashPath = [29, 69]
    .flatMap((y) =>
      HASH_MARKS.map(
        (mark) => `M${fieldX(mark * 2, y)},${y} L${fieldX(mark * 2, y + 4)},${y + 4}`,
      ),
    )
    .join(" ");
  // Marker walks left→right across the field with progress; flip when away has the ball.
  const yard = activeSide === "away" ? 100 - progress * 100 : progress * 100;
  const markerX = fieldX(Math.max(5, Math.min(95, yard)), 52);
  const facingHome = activeSide !== "away";

  return (
    <View accessible accessibilityLabel="Football field illustration" style={styles.field}>
      <Svg width="100%" height="100%" viewBox="0 0 360 104">
        <Defs>
          <FieldGradient id="replayTurf" x1="0%" y1="0%" x2="0%" y2="100%">
            <Stop offset="0%" stopColor="#268a52" />
            <Stop offset="100%" stopColor="#0f3d28" />
          </FieldGradient>
        </Defs>
        <Polygon points="18,5 342,5 356,99 4,99" fill="url(#replayTurf)" />
        <Polygon
          points="18,5 42.5,5 32.6,99 4,99"
          fill={activeSide === "away" ? "#1a9a66" : "#134636"}
        />
        <Polygon
          points="317.5,5 342,5 356,99 327.4,99"
          fill={activeSide === "home" ? "#2a6ad4" : "#143a72"}
        />
        {YARD_STRIPES.map((index) => {
          const stripeYard = index * 10;
          return (
            <Line
              key={stripeYard}
              x1={fieldX(stripeYard, 5)}
              y1={5}
              x2={fieldX(stripeYard, 99)}
              y2={99}
              stroke="#deffec"
              strokeOpacity={index === 5 ? 0.95 : 0.5}
            />
          );
        })}
        <Path d={hashPath} stroke="#ceffe0" strokeOpacity={0.7} strokeWidth={0.65} />
        {[23, 89].flatMap((y) =>
          YARD_STRIPES.slice(1, -1).map((index) => (
            <FieldText
              key={`${y}:${index}`}
              x={fieldX(index * 10, y)}
              y={y}
              fill="#f1fdf6"
              fontSize={9}
              fontWeight="bold"
              textAnchor="middle"
            >
              {Math.min(index, 10 - index) * 10}
            </FieldText>
          )),
        )}
        <FieldText
          x={25}
          y={56}
          rotation={-90}
          originX={25}
          originY={52}
          fill="#fff"
          fontSize={13}
          fontWeight="bold"
          textAnchor="middle"
        >
          {away}
        </FieldText>
        <FieldText
          x={335}
          y={56}
          rotation={90}
          originX={335}
          originY={52}
          fill="#fff"
          fontSize={13}
          fontWeight="bold"
          textAnchor="middle"
        >
          {home}
        </FieldText>
        {/* Drive marker with glow trail — matches NFL mockup chevron */}
        <Rect
          x={facingHome ? markerX - 28 : markerX - 4}
          y={44}
          width={32}
          height={16}
          rx={4}
          fill="#3dd6ff"
          opacity={0.22}
        />
        <Polygon
          points={
            facingHome
              ? `${markerX - 6},${52} ${markerX - 18},${46} ${markerX - 18},${58}`
              : `${markerX + 6},${52} ${markerX + 18},${46} ${markerX + 18},${58}`
          }
          fill="#7eecff"
        />
        <Polygon
          points={
            facingHome
              ? `${markerX + 6},${52} ${markerX - 6},${46} ${markerX - 6},${58}`
              : `${markerX - 6},${52} ${markerX + 6},${46} ${markerX + 6},${58}`
          }
          fill="#b8f6ff"
        />
        <Polygon
          points="18,5 342,5 356,99 4,99"
          fill="none"
          stroke="#defcf1"
          strokeWidth={1.8}
          strokeLinejoin="round"
        />
      </Svg>
    </View>
  );
}

function ReplayCourt({ progress }: { progress: number }) {
  const line = "#fff2d3";
  const ballX = 30 + progress * 300;
  return (
    <View accessible accessibilityLabel="Basketball court illustration" style={styles.field}>
      <Svg width="100%" height="100%" viewBox="0 0 360 104">
        <Defs>
          <FieldGradient id="courtWood" x1="0%" y1="0%" x2="0%" y2="100%">
            <Stop offset="0%" stopColor="#c8884a" />
            <Stop offset="100%" stopColor="#8a5228" />
          </FieldGradient>
        </Defs>
        <Rect x={4} y={4} width={352} height={96} rx={5} fill="url(#courtWood)" stroke={line} strokeWidth={2} />
        <Line x1={180} x2={180} y1={4} y2={100} stroke={line} />
        <Circle cx={180} cy={52} r={15} fill="#92522d" stroke={line} />
        <Rect x={4} y={34} width={56} height={36} fill="#92522d" stroke={line} />
        <Rect x={300} y={34} width={56} height={36} fill="#92522d" stroke={line} />
        <Circle cx={60} cy={52} r={12} fill="none" stroke={line} />
        <Circle cx={300} cy={52} r={12} fill="none" stroke={line} />
        <Path
          d="M4 12 H24 A48 40 0 0 1 24 92 H4 M356 12 H336 A48 40 0 0 0 336 92 H356"
          fill="none"
          stroke={line}
        />
        <Circle cx={18} cy={52} r={4} fill="none" stroke={line} />
        <Circle cx={342} cy={52} r={4} fill="none" stroke={line} />
        <Circle cx={ballX} cy={52} r={5} fill="#ff8a3d" stroke="#ffe0c2" strokeWidth={1.5} />
      </Svg>
    </View>
  );
}

function ReplayRink({ progress }: { progress: number }) {
  const puckX = 40 + progress * 280;
  return (
    <View accessible accessibilityLabel="Hockey rink illustration" style={[styles.field, { backgroundColor: "#0b1f33" }]}>
      <Svg width="100%" height="100%" viewBox="0 0 360 104">
        <Rect x={4} y={4} width={352} height={96} rx={28} fill="#e8f4ff" />
        <Rect x={4} y={4} width={352} height={96} rx={28} fill="none" stroke="#3b82f6" strokeWidth={3} />
        <Line x1={180} x2={180} y1={4} y2={100} stroke="#ef4444" strokeWidth={2} />
        <Circle cx={180} cy={52} r={18} fill="none" stroke="#3b82f6" strokeWidth={2} />
        <Circle cx={90} cy={52} r={14} fill="none" stroke="#ef4444" strokeWidth={1.5} />
        <Circle cx={270} cy={52} r={14} fill="none" stroke="#ef4444" strokeWidth={1.5} />
        <Rect x={4} y={36} width={10} height={32} fill="#94a3b8" />
        <Rect x={346} y={36} width={10} height={32} fill="#94a3b8" />
        <Circle cx={puckX} cy={52} r={4} fill="#0f172a" />
      </Svg>
    </View>
  );
}

function ReplayDiamond({ progress }: { progress: number }) {
  const runner = 20 + progress * 60;
  return (
    <View accessible accessibilityLabel="Baseball diamond illustration" style={[styles.field, { backgroundColor: "#163528" }]}>
      <Svg width="100%" height="100%" viewBox="0 0 360 104">
        <Rect x={0} y={0} width={360} height={104} fill="#1f6b3a" />
        <Ellipse cx={180} cy={70} rx={110} ry={48} fill="#c4a574" />
        <Polygon points="180,88 230,55 180,28 130,55" fill="#d7b889" stroke="#fff" strokeWidth={1.5} />
        <Circle cx={180} cy={88} r={4} fill="#fff" />
        <Circle cx={230} cy={55} r={3.5} fill="#fff" />
        <Circle cx={180} cy={28} r={3.5} fill="#fff" />
        <Circle cx={130} cy={55} r={3.5} fill="#fff" />
        <Circle cx={180} cy={70 - runner * 0.35} r={5} fill="#60a5fa" stroke="#dbeafe" />
      </Svg>
    </View>
  );
}

function ReplayPitch({ progress }: { progress: number }) {
  const ballX = 40 + progress * 280;
  return (
    <View accessible accessibilityLabel="Soccer pitch illustration" style={[styles.field, { backgroundColor: "#0d2f1c" }]}>
      <Svg width="100%" height="100%" viewBox="0 0 360 104">
        <Rect x={4} y={4} width={352} height={96} fill="#1f7a3d" stroke="#e2ffe8" strokeWidth={2} />
        <Line x1={180} x2={180} y1={4} y2={100} stroke="#e2ffe8" strokeWidth={1.5} />
        <Circle cx={180} cy={52} r={18} fill="none" stroke="#e2ffe8" strokeWidth={1.5} />
        <Rect x={4} y={28} width={40} height={48} fill="none" stroke="#e2ffe8" strokeWidth={1.5} />
        <Rect x={316} y={28} width={40} height={48} fill="none" stroke="#e2ffe8" strokeWidth={1.5} />
        <Rect x={4} y={38} width={16} height={28} fill="none" stroke="#e2ffe8" strokeWidth={1.5} />
        <Rect x={340} y={38} width={16} height={28} fill="none" stroke="#e2ffe8" strokeWidth={1.5} />
        <Circle cx={ballX} cy={52} r={4} fill="#f8fafc" stroke="#94a3b8" />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginBottom: 12,
    gap: 12,
    backgroundColor: "#071525",
    borderColor: "#1e3a55",
    borderRadius: 18,
    padding: 14,
  },
  heading: { flexDirection: "row", alignItems: "center", gap: 10 },
  filmBadge: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(59,130,246,0.18)",
    borderWidth: 1,
    borderColor: "rgba(112,217,255,0.35)",
  },
  title: { color: "#f4f8ff", fontFamily: FONT.bold, fontSize: 20 },
  subtitle: { color: "#9db4cc", fontSize: 12, fontFamily: FONT.body },
  caption: { color: "#8aa3bc", fontSize: 11, fontFamily: FONT.body },
  scoreboard: {
    flexDirection: "row",
    borderRadius: 14,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "#2a4d6e",
  },
  scoreDivider: {
    position: "absolute",
    left: "50%",
    top: 0,
    bottom: 0,
    width: 28,
    marginLeft: -14,
    alignItems: "center",
    justifyContent: "center",
  },
  scoreChevron: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: "rgba(15, 40, 70, 0.92)",
    borderWidth: 1,
    borderColor: "#4fc3f7",
    alignItems: "center",
    justifyContent: "center",
  },
  team: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 12,
    paddingHorizontal: 6,
    gap: 6,
  },
  logo: { width: 28, height: 28, backgroundColor: "#e8f4fb", borderRadius: 7 },
  logoFallback: { alignItems: "center", justifyContent: "center", backgroundColor: "#1e293b" },
  logoFallbackText: { color: "#e2e8f0", fontFamily: FONT.bold, fontSize: 10 },
  teamLabel: { color: "#f4f8ff", fontFamily: FONT.bold, fontSize: 13, flexShrink: 1 },
  score: {
    color: "#fff",
    fontFamily: FONT.bold,
    fontSize: 26,
    fontVariant: ["tabular-nums"],
  },
  scoreGlow: {
    textShadowColor: "rgba(96, 215, 255, 0.85)",
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 10,
  },
  timeline: { flexDirection: "row", alignItems: "center", gap: 10 },
  playBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#1d6fd4",
    borderWidth: 1,
    borderColor: "#7ec8ff",
  },
  scrubber: { flex: 1, height: 44, justifyContent: "center" },
  scrubTrack: {
    height: 8,
    backgroundColor: "#1a334d",
    borderRadius: 4,
    overflow: "visible",
    justifyContent: "center",
  },
  scrubThumb: {
    position: "absolute",
    top: -6,
    marginLeft: -10,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: "#fff",
    borderWidth: 2,
    borderColor: "#7dd3fc",
  },
  quarterStops: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  quarterStop: {
    flexGrow: 1,
    minHeight: 40,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#2f4f6f",
    backgroundColor: "#0f2136",
    paddingHorizontal: 6,
  },
  quarterStopActive: {
    backgroundColor: "#1d6fd4",
    borderColor: "#7ec8ff",
  },
  field: {
    aspectRatio: 360 / 104,
    backgroundColor: "#0a241c",
    borderRadius: 14,
    padding: 3,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "#1e3d48",
  },
  status: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: "#0e1f33",
    borderWidth: 1,
    borderColor: "#243b55",
  },
  statusSeg: { flexDirection: "row", alignItems: "center", gap: 6 },
  statusRule: { width: 1, height: 14, backgroundColor: "#2d4663" },
  statusText: { color: "#e8f1fa", fontFamily: FONT.semibold, fontSize: 12 },
  driveText: { color: "#6ee7ff", fontFamily: FONT.semibold, fontSize: 12, flexShrink: 1 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8, alignItems: "center" },
  action: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#2f5478",
    backgroundColor: "#102338",
  },
  primaryAction: {
    backgroundColor: "#1559a8",
    borderColor: "#5eb0f5",
    shadowColor: "#3b82f6",
    shadowOpacity: 0.45,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 0 },
  },
  actionText: { color: "#dcebff", fontFamily: FONT.semibold, fontSize: 12 },
  actionTextOn: { color: "#fff" },
  footerSlot: { flexGrow: 1, minWidth: 140 },
});

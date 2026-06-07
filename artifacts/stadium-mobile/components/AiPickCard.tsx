import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useState } from "react";
import {
  Image,
  LayoutAnimation,
  Platform,
  Pressable,
  Text,
  UIManager,
  View,
} from "react-native";

import { useBetSlip } from "@/context/BetSlipContext";
import { useColors } from "@/hooks/useColors";
import { formatAmerican } from "@/lib/format";
import { EdgeReadout, type ParsedPick } from "@/components/PickCard";
import { FONT } from "@/components/ui";

if (
  Platform.OS === "android" &&
  UIManager.setLayoutAnimationEnabledExperimental
) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

// Circular avatar mirroring the Home "Featured Players" look: a real ESPN player
// headshot for prop legs, the picked team's logo for game legs, else initials.
function AiPickAvatar({ pick }: { pick: ParsedPick }) {
  const colors = useColors();
  // Player props lead with the athlete's name ("Max Meyer Over 5.5 Strikeouts");
  // game picks lead with the team ("Lakers -3.5"). Either way the leading words
  // give us the initials, same as the Featured Players avatar.
  const lead = pick.pick.split(/\s+over\s+|\s+under\s+/i)[0] ?? pick.pick;
  const initials = lead
    .split(/\s+/)
    .filter((w) => /[a-z]/i.test(w))
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
  // Real ESPN imagery: a player headshot for props, the picked team's logo for
  // game-level legs, OR both teams' logos for a game total (which names no single
  // team). Falls back to initials when the feed has none OR an image URL fails.
  const [imgFailed, setImgFailed] = useState(false);
  const [awayFailed, setAwayFailed] = useState(false);
  const [homeFailed, setHomeFailed] = useState(false);
  const photo = imgFailed ? null : pick.headshot || pick.teamLogo || null;
  const isLogo = !pick.headshot && !!pick.teamLogo;
  const matchup =
    !photo && (pick.awayLogo || pick.homeLogo)
      ? { away: awayFailed ? null : pick.awayLogo, home: homeFailed ? null : pick.homeLogo }
      : null;

  const wrap = {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    overflow: "hidden" as const,
  };

  // Game total: render both team logos as a small matchup pair.
  if (matchup && (matchup.away || matchup.home)) {
    return (
      <View style={{ ...wrap, flexDirection: "row", gap: 2 }}>
        {matchup.away ? (
          <Image
            source={{ uri: matchup.away }}
            style={{ width: 24, height: 24 }}
            resizeMode="contain"
            onError={() => setAwayFailed(true)}
          />
        ) : null}
        {matchup.home ? (
          <Image
            source={{ uri: matchup.home }}
            style={{ width: 24, height: 24 }}
            resizeMode="contain"
            onError={() => setHomeFailed(true)}
          />
        ) : null}
      </View>
    );
  }

  return (
    <View style={wrap}>
      {photo ? (
        <Image
          source={{ uri: photo }}
          style={isLogo ? { width: 38, height: 38 } : { width: 56, height: 56 }}
          resizeMode="contain"
          onError={() => setImgFailed(true)}
        />
      ) : (
        <Text style={{ color: colors.mutedForeground, fontFamily: FONT.bold, fontSize: 16 }}>
          {initials || "?"}
        </Text>
      )}
    </View>
  );
}

// Compact AI-recommended pick card (avatar + selection + market + odds + the AI's
// reasoning note behind a collapsible pill). Shared by the Bet Slip's "AI
// RECOMMENDED" row and a game's detail page. Tapping the body toggles the leg
// in/out of the slip; tapping the "AI Edge" pill expands the reasoning.
export function AiPickCard({ pick }: { pick: ParsedPick }) {
  const colors = useColors();
  const { addLeg, removeLeg, hasLeg } = useBetSlip();
  const added = hasLeg(pick.game, pick.market, pick.pick);
  const [edgeOpen, setEdgeOpen] = useState(false);

  const onToggle = () => {
    if (added) {
      removeLeg(`${pick.game}|${pick.market}|${pick.pick}`.toLowerCase());
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } else {
      const ok = addLeg(pick);
      Haptics.impactAsync(
        ok ? Haptics.ImpactFeedbackStyle.Medium : Haptics.ImpactFeedbackStyle.Light,
      );
    }
  };

  const toggleEdge = () => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setEdgeOpen((v) => !v);
  };

  return (
    <Pressable
      onPress={onToggle}
      style={({ pressed }) => ({
        width: 168,
        backgroundColor: colors.card,
        borderWidth: 1,
        borderColor: added ? colors.primary : colors.border,
        borderRadius: colors.radius,
        paddingVertical: 16,
        paddingHorizontal: 12,
        alignItems: "center",
        gap: 6,
        opacity: pressed ? 0.85 : 1,
      })}
    >
      <AiPickAvatar pick={pick} />
      <Text
        style={{ color: colors.foreground, fontFamily: FONT.semibold, fontSize: 14, textAlign: "center" }}
        numberOfLines={1}
      >
        {pick.pick}
      </Text>
      <Text
        style={{
          color: colors.mutedForeground,
          fontFamily: FONT.medium,
          fontSize: 11,
          letterSpacing: 0.5,
          textTransform: "uppercase",
        }}
        numberOfLines={1}
      >
        {pick.teamAbbr
          ? `${pick.teamAbbr} · ${pick.market}`
          : pick.awayAbbr && pick.homeAbbr
          ? `${pick.awayAbbr} @ ${pick.homeAbbr} · ${pick.market}`
          : pick.market}
      </Text>
      <Text
        style={{ color: colors.primary, fontFamily: FONT.bold, fontSize: 12, textAlign: "center" }}
        numberOfLines={1}
      >
        {formatAmerican(pick.odds)}
      </Text>

      <View style={{ alignItems: "center", alignSelf: "stretch" }}>
        <EdgeReadout edge={pick.edge} odds={pick.odds} isProp={pick.isProp} />
      </View>

      {/* AI reasoning note — collapsed behind a pill so the card stays compact. */}
      {pick.edge ? (
        <View style={{ alignItems: "center", alignSelf: "stretch" }}>
          <Pressable
            onPress={toggleEdge}
            hitSlop={6}
            style={({ pressed }) => ({
              flexDirection: "row",
              alignItems: "center",
              gap: 4,
              paddingVertical: 4,
              paddingHorizontal: 9,
              borderRadius: 999,
              backgroundColor: colors.surface,
              borderWidth: 1,
              borderColor: edgeOpen ? colors.primary : colors.border,
              opacity: pressed ? 0.85 : 1,
            })}
          >
            <Feather name="zap" size={11} color={colors.accent} />
            <Text
              style={{
                color: edgeOpen ? colors.foreground : colors.mutedForeground,
                fontFamily: FONT.bold,
                fontSize: 10,
              }}
            >
              AI Edge
            </Text>
            <Feather name={edgeOpen ? "chevron-up" : "chevron-down"} size={12} color={colors.mutedForeground} />
          </Pressable>
          {edgeOpen ? (
            <Text
              style={{
                color: colors.mutedForeground,
                fontFamily: FONT.body,
                fontSize: 11,
                lineHeight: 16,
                marginTop: 6,
              }}
            >
              {pick.edge}
            </Text>
          ) : null}
        </View>
      ) : null}

      <View style={{ flexDirection: "row", alignItems: "center", gap: 4, marginTop: 2 }}>
        <Feather
          name={added ? "check" : "plus"}
          size={12}
          color={added ? colors.primary : colors.mutedForeground}
        />
        <Text
          style={{
            color: added ? colors.primary : colors.mutedForeground,
            fontFamily: FONT.semibold,
            fontSize: 11,
          }}
        >
          {added ? "Added" : "Add"}
        </Text>
      </View>
    </Pressable>
  );
}

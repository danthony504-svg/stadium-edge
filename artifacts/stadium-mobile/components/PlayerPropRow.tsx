import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useState } from "react";
import { Image, Pressable, Text, View } from "react-native";

import { FONT } from "@/components/ui";
import { useBetSlip } from "@/context/BetSlipContext";
import { useColors } from "@/hooks/useColors";
import { propMarketLabel, type PlayerProp } from "@/lib/api";
import { formatAmerican } from "@/lib/format";

// Shared presentational pieces for player-prop rows. Kept in one place so the
// pick-string format below stays a SINGLE SOURCE OF TRUTH — it must byte-match
// buildPicksFromOdds/the Coach so the same leg dedupes across the slip.

export function Avatar({ headshot, name }: { headshot: string | null; name: string }) {
  const colors = useColors();
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
  return (
    <View
      style={{
        width: 38,
        height: 38,
        borderRadius: 19,
        backgroundColor: colors.surface,
        borderWidth: 1,
        borderColor: colors.border,
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
      }}
    >
      {headshot ? (
        <Image source={{ uri: headshot }} style={{ width: 38, height: 38 }} resizeMode="cover" />
      ) : (
        <Text style={{ color: colors.mutedForeground, fontFamily: FONT.bold, fontSize: 13 }}>
          {initials || "?"}
        </Text>
      )}
    </View>
  );
}

function PropChip({
  side,
  line,
  price,
  added,
  onPress,
}: {
  side: "Over" | "Under";
  line: number | null;
  price: number | null;
  added: boolean;
  onPress: () => void;
}) {
  const colors = useColors();
  if (price == null) {
    return (
      <View
        style={{
          flex: 1,
          borderRadius: 10,
          borderWidth: 1,
          borderColor: colors.border,
          backgroundColor: colors.surface,
          paddingVertical: 10,
          alignItems: "center",
          opacity: 0.4,
        }}
      >
        <Text style={{ color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 11 }}>—</Text>
      </View>
    );
  }
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        flex: 1,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: added ? colors.primary : colors.border,
        backgroundColor: added ? "rgba(59,130,246,0.14)" : colors.surface,
        paddingVertical: 8,
        paddingHorizontal: 8,
        alignItems: "center",
        gap: 1,
        opacity: pressed ? 0.85 : 1,
      })}
    >
      <Text
        style={{
          color: added ? colors.primary : colors.mutedForeground,
          fontFamily: FONT.bold,
          fontSize: 10,
          letterSpacing: 0.5,
          textTransform: "uppercase",
        }}
      >
        {side}
        {line != null ? ` ${line}` : ""}
      </Text>
      <Text
        style={{
          color: added ? colors.primary : colors.foreground,
          fontFamily: FONT.bold,
          fontSize: 14,
        }}
      >
        {formatAmerican(price)}
      </Text>
    </Pressable>
  );
}

export function PropRow({
  prop,
  alts,
  gameLabel,
  sport,
  onOpen,
}: {
  prop: PlayerProp;
  alts: PlayerProp[];
  gameLabel: string;
  sport: string;
  onOpen: () => void;
}) {
  const colors = useColors();
  const { addLeg, hasLeg } = useBetSlip();
  const [showAlts, setShowAlts] = useState(false);
  const label = propMarketLabel(prop.market);
  const lineTxt = prop.line != null ? ` ${prop.line}` : "";

  // Always include the side token (matches the web app's pick format), even for
  // yes/no markets with no line (e.g. Anytime TD) — lineTxt is "" in that case.
  const overPick = `${prop.player} Over${lineTxt} ${label}`;
  const underPick = `${prop.player} Under${lineTxt} ${label}`;
  const overAdded = hasLeg(gameLabel, "Player Prop", overPick);
  const underAdded = hasLeg(gameLabel, "Player Prop", underPick);

  const add = (pick: string, price: number) => {
    const ok = addLeg({ game: gameLabel, market: "Player Prop", pick, odds: price, sport });
    Haptics.impactAsync(ok ? Haptics.ImpactFeedbackStyle.Medium : Haptics.ImpactFeedbackStyle.Light);
  };

  return (
    <View
      style={{
        backgroundColor: colors.card,
        borderColor: colors.border,
        borderWidth: 1,
        borderRadius: colors.radius,
        padding: 12,
        gap: 10,
      }}
    >
      <Pressable
        onPress={onOpen}
        style={({ pressed }) => ({
          flexDirection: "row",
          alignItems: "center",
          gap: 10,
          opacity: pressed ? 0.7 : 1,
        })}
      >
        <Avatar headshot={prop.headshot} name={prop.player} />
        <View style={{ flex: 1 }}>
          <Text style={{ color: colors.foreground, fontFamily: FONT.semibold, fontSize: 14 }} numberOfLines={1}>
            {prop.player}
          </Text>
          <Text style={{ color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 12, marginTop: 1 }}>
            {label}
            {prop.line != null ? ` · ${prop.line}` : ""}
          </Text>
        </View>
        <Feather name="bar-chart-2" size={16} color={colors.primary} />
      </Pressable>
      <View style={{ flexDirection: "row", gap: 8 }}>
        <PropChip
          side="Over"
          line={prop.line}
          price={prop.overPrice}
          added={overAdded}
          onPress={() => prop.overPrice != null && add(overPick, prop.overPrice)}
        />
        <PropChip
          side="Under"
          line={prop.line}
          price={prop.underPrice}
          added={underAdded}
          onPress={() => prop.underPrice != null && add(underPick, prop.underPrice)}
        />
      </View>

      {/* Alternate ladder — real rungs the book posts at other lines. Collapsed
          by default so the list stays compact. Every price is live; no estimates. */}
      {alts.length > 0 ? (
        <View style={{ gap: 8 }}>
          <Pressable
            onPress={() => setShowAlts((s) => !s)}
            hitSlop={6}
            style={{ flexDirection: "row", alignItems: "center", gap: 6 }}
          >
            <Feather name={showAlts ? "chevron-up" : "chevron-down"} size={14} color={colors.primary} />
            <Text style={{ color: colors.primary, fontFamily: FONT.semibold, fontSize: 12 }}>
              {showAlts ? "Hide" : "Show"} alt lines ({alts.length})
            </Text>
          </Pressable>
          {showAlts
            ? alts.map((a, i) => {
                const altLineTxt = a.line != null ? ` ${a.line}` : "";
                const aOver = `${prop.player} Over${altLineTxt} ${label}`;
                const aUnder = `${prop.player} Under${altLineTxt} ${label}`;
                return (
                  <View key={`${a.line}-${i}`} style={{ flexDirection: "row", gap: 8 }}>
                    <PropChip
                      side="Over"
                      line={a.line}
                      price={a.overPrice}
                      added={hasLeg(gameLabel, "Player Prop", aOver)}
                      onPress={() => a.overPrice != null && add(aOver, a.overPrice)}
                    />
                    <PropChip
                      side="Under"
                      line={a.line}
                      price={a.underPrice}
                      added={hasLeg(gameLabel, "Player Prop", aUnder)}
                      onPress={() => a.underPrice != null && add(aUnder, a.underPrice)}
                    />
                  </View>
                );
              })
            : null}
        </View>
      ) : null}
    </View>
  );
}

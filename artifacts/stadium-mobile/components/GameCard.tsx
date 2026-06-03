import { Feather } from "@expo/vector-icons";
import { Image } from "expo-image";
import * as Haptics from "expo-haptics";
import { Pressable, Text, View } from "react-native";

import { useColors } from "@/hooks/useColors";
import { useBetSlip } from "@/context/BetSlipContext";
import type { OddsGame } from "@/lib/api";
import { formatAmerican } from "@/lib/format";
import { Badge, FONT } from "@/components/ui";

export type GameMeta = {
  homeLogo?: string | null;
  awayLogo?: string | null;
  live?: boolean;
  awayScore?: number | null;
  homeScore?: number | null;
  periodLabel?: string | null;
};

const nickname = (full: string) => (full || "").split(/\s+/).filter(Boolean).pop() || full;
const initials = (full: string) =>
  (full || "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(-2)
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 3);

function startLabel(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const d = new Date(t);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (sameDay) return `Today ${time}`;
  const tmr = new Date(now);
  tmr.setDate(now.getDate() + 1);
  if (d.toDateString() === tmr.toDateString()) return `Tmrw ${time}`;
  return `${d.toLocaleDateString([], { weekday: "short" })} ${time}`;
}

function TeamLogo({ uri, name }: { uri?: string | null; name: string }) {
  const colors = useColors();
  if (uri) {
    return (
      <Image
        source={{ uri }}
        style={{ width: 30, height: 30 }}
        contentFit="contain"
        transition={150}
      />
    );
  }
  return (
    <View
      style={{
        width: 30,
        height: 30,
        borderRadius: 8,
        backgroundColor: colors.surface,
        borderWidth: 1,
        borderColor: colors.border,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Text style={{ color: colors.mutedForeground, fontFamily: FONT.bold, fontSize: 11 }}>
        {initials(name)}
      </Text>
    </View>
  );
}

function OddsChip({
  top,
  bottom,
  onPress,
  added,
  disabled,
}: {
  top: string;
  bottom: string;
  onPress: () => void;
  added: boolean;
  disabled?: boolean;
}) {
  const colors = useColors();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => ({
        flex: 1,
        alignItems: "center",
        paddingVertical: 9,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: added ? colors.primary : colors.border,
        backgroundColor: added ? "rgba(34,211,238,0.14)" : colors.surface,
        opacity: disabled ? 0.4 : pressed ? 0.8 : 1,
      })}
    >
      <Text
        style={{
          color: colors.mutedForeground,
          fontFamily: FONT.medium,
          fontSize: 10,
          textTransform: "uppercase",
          letterSpacing: 0.6,
        }}
        numberOfLines={1}
      >
        {top}
      </Text>
      <Text
        style={{
          color: added ? colors.primary : colors.foreground,
          fontFamily: FONT.bold,
          fontSize: 14,
          marginTop: 2,
        }}
      >
        {bottom}
      </Text>
    </Pressable>
  );
}

export function GameCard({
  game,
  meta,
  onPress,
}: {
  game: OddsGame;
  meta?: GameMeta;
  onPress: () => void;
}) {
  const colors = useColors();
  const { addLeg, hasLeg } = useBetSlip();

  const label = `${game.awayTeam} @ ${game.homeTeam}`;
  const h2h = game.markets.find((m) => m.key === "h2h");
  const totals = game.markets.find((m) => m.key === "totals");
  const away = h2h?.outcomes.find((o) => o.name === game.awayTeam);
  const home = h2h?.outcomes.find((o) => o.name === game.homeTeam);
  const over = totals?.outcomes.find((o) => /over/i.test(o.name));

  const add = (market: string, pick: string, odds?: number | null) => {
    if (odds == null) return;
    const ok = addLeg({ game: label, market, pick, odds, sport: game.sport });
    Haptics.impactAsync(
      ok ? Haptics.ImpactFeedbackStyle.Medium : Haptics.ImpactFeedbackStyle.Light,
    );
  };

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        backgroundColor: colors.card,
        borderColor: colors.border,
        borderWidth: 1,
        borderRadius: colors.radius,
        padding: 14,
        opacity: pressed ? 0.92 : 1,
      })}
    >
      <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 12 }}>
        {meta?.live ? (
          <Badge label={meta.periodLabel ? `LIVE · ${meta.periodLabel}` : "LIVE"} tone="live" />
        ) : (
          <Text style={{ color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 12 }}>
            {startLabel(game.commenceTime)}
          </Text>
        )}
        <Feather name="chevron-right" size={16} color={colors.mutedForeground} />
      </View>

      <View style={{ gap: 8, marginBottom: 12 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <TeamLogo uri={meta?.awayLogo} name={game.awayTeam} />
          <Text
            style={{ color: colors.foreground, fontFamily: FONT.semibold, fontSize: 15, flex: 1 }}
            numberOfLines={1}
          >
            {game.awayTeam}
          </Text>
          {meta?.live && meta.awayScore != null ? (
            <Text style={{ color: colors.foreground, fontFamily: FONT.bold, fontSize: 16 }}>
              {meta.awayScore}
            </Text>
          ) : null}
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <TeamLogo uri={meta?.homeLogo} name={game.homeTeam} />
          <Text
            style={{ color: colors.foreground, fontFamily: FONT.semibold, fontSize: 15, flex: 1 }}
            numberOfLines={1}
          >
            {game.homeTeam}
          </Text>
          {meta?.live && meta.homeScore != null ? (
            <Text style={{ color: colors.foreground, fontFamily: FONT.bold, fontSize: 16 }}>
              {meta.homeScore}
            </Text>
          ) : null}
        </View>
      </View>

      {h2h || over ? (
        <View style={{ flexDirection: "row", gap: 8 }}>
          {away ? (
            <OddsChip
              top={nickname(game.awayTeam)}
              bottom={formatAmerican(away.price)}
              added={hasLeg(label, "Moneyline", `${nickname(game.awayTeam)} ML`)}
              onPress={() => add("Moneyline", `${nickname(game.awayTeam)} ML`, away.price)}
            />
          ) : null}
          {home ? (
            <OddsChip
              top={nickname(game.homeTeam)}
              bottom={formatAmerican(home.price)}
              added={hasLeg(label, "Moneyline", `${nickname(game.homeTeam)} ML`)}
              onPress={() => add("Moneyline", `${nickname(game.homeTeam)} ML`, home.price)}
            />
          ) : null}
          {over && over.point != null ? (
            <OddsChip
              top={`O ${over.point}`}
              bottom={formatAmerican(over.price)}
              added={hasLeg(label, "Total", `Over ${over.point}`)}
              onPress={() => add("Total", `Over ${over.point}`, over.price)}
            />
          ) : null}
        </View>
      ) : (
        <Text style={{ color: colors.mutedForeground, fontFamily: FONT.body, fontSize: 12 }}>
          Tap for full markets
        </Text>
      )}
    </Pressable>
  );
}

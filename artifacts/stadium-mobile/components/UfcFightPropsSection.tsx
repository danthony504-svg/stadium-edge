import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import * as Haptics from "expo-haptics";

import { useBetSlip } from "@/context/BetSlipContext";
import { useColors } from "@/hooks/useColors";
import { FONT } from "@/components/ui";
import { formatAmerican } from "@/lib/format";
import {
  getUfcFightProps,
  type OddsGame,
  type UfcFightPropMarket,
  type UfcFightPropsBundle,
} from "@/lib/api";

function PropMarketBlock({
  game,
  market,
}: {
  game: OddsGame;
  market: UfcFightPropMarket;
}) {
  const colors = useColors();
  const { addLeg, removeLeg, hasLeg } = useBetSlip();
  const gameLabel = `${game.awayTeam} @ ${game.homeTeam}`;

  return (
    <View
      style={{
        backgroundColor: colors.card,
        borderColor: colors.border,
        borderWidth: 1,
        borderRadius: colors.radius,
        padding: 14,
        gap: 10,
      }}
    >
      <Text style={{ color: colors.primary, fontFamily: FONT.display, fontSize: 13, letterSpacing: 0.4 }}>
        {market.label.toUpperCase()}
      </Text>
      <Text style={{ color: colors.mutedForeground, fontFamily: FONT.body, fontSize: 10 }}>
        REAL SPORTSBOOK ODDS · CITO
      </Text>
      {(market.outcomes ?? []).map((o, idx) => {
        const pick = o.name;
        const mk = market.label;
        const added = hasLeg(gameLabel, mk, pick);
        const legId = `${gameLabel}|${mk}|${pick}`.toLowerCase();
        return (
          <Pressable
            key={`${market.key}-${idx}`}
            onPress={() => {
              if (added) {
                removeLeg(legId);
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                return;
              }
              const ok = addLeg({
                game: gameLabel,
                market: mk,
                pick,
                odds: o.price,
                sport: game.sport,
              });
              Haptics.impactAsync(
                ok ? Haptics.ImpactFeedbackStyle.Medium : Haptics.ImpactFeedbackStyle.Light,
              );
            }}
            style={({ pressed }) => ({
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              paddingVertical: 8,
              paddingHorizontal: 10,
              borderRadius: colors.radius,
              backgroundColor: added ? colors.primary + "22" : colors.surface,
              borderWidth: 1,
              borderColor: added ? colors.primary : colors.border,
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={{ color: colors.foreground, fontFamily: FONT.medium, fontSize: 13 }} numberOfLines={2}>
                {o.name}
              </Text>
              {o.book ? (
                <Text style={{ color: colors.mutedForeground, fontFamily: FONT.body, fontSize: 10 }}>
                  {o.book}
                </Text>
              ) : null}
            </View>
            <Text style={{ color: colors.foreground, fontFamily: FONT.semibold, fontSize: 14 }}>
              {formatAmerican(o.price)}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

// UFC fight props from Cito — only renders markets with real posted odds.
export function UfcFightPropsSection({ game }: { game: OddsGame }) {
  const colors = useColors();
  const [data, setData] = useState<UfcFightPropsBundle | null>(null);
  const [loading, setLoading] = useState(true);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    getUfcFightProps(game.awayTeam, game.homeTeam, controller.signal)
      .then((d) => {
        if (!controller.signal.aborted) setData(d);
      })
      .catch(() => {
        if (!controller.signal.aborted) setData(null);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [game.awayTeam, game.homeTeam]);

  if (loading) {
    return (
      <View
        style={{
          backgroundColor: colors.card,
          borderColor: colors.border,
          borderWidth: 1,
          borderRadius: colors.radius,
          padding: 14,
          flexDirection: "row",
          alignItems: "center",
          gap: 10,
        }}
      >
        <ActivityIndicator color={colors.primary} />
        <Text style={{ color: colors.mutedForeground, fontFamily: FONT.body, fontSize: 13 }}>
          Loading fight props…
        </Text>
      </View>
    );
  }

  const markets = data?.markets ?? [];
  if (!markets.length) return null;

  return (
    <View style={{ gap: 10 }}>
      <Text style={{ color: colors.mutedForeground, fontFamily: FONT.display, fontSize: 12, letterSpacing: 0.5 }}>
        FIGHT PROPS
      </Text>
      {markets.map((m) => (
        <PropMarketBlock key={m.key} game={game} market={m} />
      ))}
    </View>
  );
}

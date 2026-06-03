import { Feather } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Badge, ErrorState, FONT, Loading, PrimaryButton } from "@/components/ui";
import { useBetSlip } from "@/context/BetSlipContext";
import { useColors } from "@/hooks/useColors";
import { getOdds, type OddsGame, type OddsMarket } from "@/lib/api";
import { formatAmerican } from "@/lib/format";

const nickname = (full: string) => (full || "").split(/\s+/).filter(Boolean).pop() || full;

const MARKET_LABEL: Record<string, string> = {
  h2h: "Moneyline",
  spreads: "Spread",
  totals: "Total",
};

function pickLabel(marketKey: string, game: OddsGame, name: string, point?: number | null): { market: string; pick: string } {
  if (marketKey === "h2h") return { market: "Moneyline", pick: `${nickname(name)} ML` };
  if (marketKey === "spreads") {
    const pt = point == null ? "" : ` ${point > 0 ? "+" : ""}${point}`;
    return { market: "Spread", pick: `${nickname(name)}${pt}` };
  }
  if (marketKey === "totals") {
    const pt = point == null ? "" : ` ${point}`;
    return { market: "Total", pick: `${name}${pt}`.trim() };
  }
  return { market: marketKey, pick: name };
}

function MarketBlock({ game, market }: { game: OddsGame; market: OddsMarket }) {
  const colors = useColors();
  const { addLeg, hasLeg } = useBetSlip();
  const gameLabel = `${game.awayTeam} @ ${game.homeTeam}`;
  const title = MARKET_LABEL[market.key] ?? market.key;

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
      <Text style={{ color: colors.foreground, fontFamily: FONT.displaySemi, fontSize: 15 }}>{title}</Text>
      {market.outcomes.map((o, idx) => {
        const { market: mk, pick } = pickLabel(market.key, game, o.name, o.point);
        const added = hasLeg(gameLabel, mk, pick);
        const best =
          o.books && o.books.length > 0
            ? o.books.reduce((a, b) => (b.price > a.price ? b : a))
            : null;
        return (
          <Pressable
            key={`${market.key}-${idx}`}
            onPress={() => {
              const ok = addLeg({ game: gameLabel, market: mk, pick, odds: o.price, sport: game.sport });
              Haptics.impactAsync(
                ok ? Haptics.ImpactFeedbackStyle.Medium : Haptics.ImpactFeedbackStyle.Light,
              );
            }}
            style={({ pressed }) => ({
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              backgroundColor: added ? "rgba(34,211,238,0.14)" : colors.surface,
              borderWidth: 1,
              borderColor: added ? colors.primary : colors.border,
              borderRadius: 10,
              paddingHorizontal: 14,
              paddingVertical: 12,
              opacity: pressed ? 0.85 : 1,
            })}
          >
            <View style={{ flex: 1 }}>
              <Text style={{ color: colors.foreground, fontFamily: FONT.semibold, fontSize: 14 }}>
                {pick}
              </Text>
              {best ? (
                <Text style={{ color: colors.mutedForeground, fontFamily: FONT.body, fontSize: 11, marginTop: 2 }}>
                  Best: {best.book} {formatAmerican(best.price)}
                </Text>
              ) : null}
            </View>
            <Text style={{ color: added ? colors.primary : colors.foreground, fontFamily: FONT.bold, fontSize: 15 }}>
              {formatAmerican(o.price)}
            </Text>
            <Feather
              name={added ? "check" : "plus"}
              size={16}
              color={added ? colors.success : colors.mutedForeground}
              style={{ marginLeft: 10 }}
            />
          </Pressable>
        );
      })}
    </View>
  );
}

export default function GameDetailScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id, sport } = useLocalSearchParams<{ id: string; sport: string }>();

  const oddsQ = useQuery({
    queryKey: ["odds", sport],
    queryFn: ({ signal }) => getOdds(String(sport), signal),
    staleTime: 60_000,
    enabled: !!sport,
  });

  const game = (oddsQ.data ?? []).find((g) => g.id === id);

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      {/* Custom header */}
      <View
        style={{
          paddingTop: insets.top + 6,
          paddingBottom: 10,
          paddingHorizontal: 12,
          flexDirection: "row",
          alignItems: "center",
          gap: 6,
          borderBottomWidth: 1,
          borderBottomColor: colors.border,
        }}
      >
        <Pressable onPress={() => router.back()} hitSlop={10} style={{ padding: 6 }}>
          <Feather name="chevron-left" size={24} color={colors.foreground} />
        </Pressable>
        <Text style={{ color: colors.foreground, fontFamily: FONT.semibold, fontSize: 16, flex: 1 }} numberOfLines={1}>
          {game ? `${nickname(game.awayTeam)} @ ${nickname(game.homeTeam)}` : "Game"}
        </Text>
      </View>

      {oddsQ.isLoading ? (
        <Loading label="Loading markets…" />
      ) : oddsQ.isError ? (
        <ErrorState onRetry={() => oddsQ.refetch()} />
      ) : !game ? (
        <View style={{ padding: 16 }}>
          <Text style={{ color: colors.mutedForeground, fontFamily: FONT.body, fontSize: 14 }}>
            This game is no longer available.
          </Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 40, gap: 14 }}>
          <View style={{ gap: 6 }}>
            <Text style={{ color: colors.foreground, fontFamily: FONT.display, fontSize: 22 }}>
              {game.awayTeam}
            </Text>
            <Text style={{ color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 13 }}>at</Text>
            <Text style={{ color: colors.foreground, fontFamily: FONT.display, fontSize: 22 }}>
              {game.homeTeam}
            </Text>
            <Badge label={new Date(game.commenceTime).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" })} tone="muted" />
          </View>

          {game.markets.map((m) => (
            <MarketBlock key={m.key} game={game} market={m} />
          ))}

          <PrimaryButton
            label="Ask the Coach about this game"
            icon="zap"
            onPress={() =>
              router.push({
                pathname: "/coach",
                params: { prefill: `Give me your best bet for ${game.awayTeam} @ ${game.homeTeam} tonight` },
              })
            }
          />
        </ScrollView>
      )}
    </View>
  );
}

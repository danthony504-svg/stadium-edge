import { Feather } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AiPickCard } from "@/components/AiPickCard";
import { parsePicks, sameGame, type ParsedPick } from "@/components/PickCard";
import { Badge, ErrorState, FONT, Loading, PrimaryButton } from "@/components/ui";
import { useBetSlip } from "@/context/BetSlipContext";
import { useColors } from "@/hooks/useColors";
import { buildChatContext, getOdds, streamChat, type OddsGame, type OddsMarket } from "@/lib/api";
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

// AI-recommended picks scoped to THIS game. On demand (not on every open — each
// run is a real streaming AI call), it builds the same real-data context the
// Coach uses, asks for this one game's best bets (which game-locks the model to
// this matchup), then resolves the reply back to REAL odds via parsePicks. Cards
// carry the AI's reasoning note. Nothing is fabricated: an empty resolve just
// shows an honest "no defensible edges" message.
function AiGamePicks({ game }: { game: OddsGame }) {
  const colors = useColors();
  const router = useRouter();
  const gameLabel = `${game.awayTeam} @ ${game.homeTeam}`;
  const [loading, setLoading] = useState(false);
  const [tried, setTried] = useState(false);
  const [error, setError] = useState(false);
  const [picks, setPicks] = useState<ParsedPick[]>([]);
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setError(false);
    setTried(true);
    try {
      const { context, propPool, gameMeta } = await buildChatContext(
        [game.sport],
        [],
        controller.signal,
      );
      // Naming exactly one game game-locks the model to this matchup only.
      const full = await streamChat({
        messages: [
          {
            role: "user",
            content: `What are your best bets for ${gameLabel}? Give me a short reason for each.`,
          },
        ],
        context,
        onToken: () => {},
        signal: controller.signal,
      });
      const parsed = parsePicks(full, context.realOdds, propPool, gameMeta).filter((p) =>
        sameGame(p.game, gameLabel),
      );
      // Only commit if this is still the latest in-flight request (a refresh or
      // unmount aborts the previous controller and swaps abortRef).
      if (abortRef.current === controller) setPicks(parsed);
    } catch {
      if (abortRef.current === controller && !controller.signal.aborted) setError(true);
    } finally {
      if (abortRef.current === controller && !controller.signal.aborted) setLoading(false);
    }
  }, [game.sport, gameLabel]);

  // Abort any in-flight AI request when leaving the screen so it can't update
  // state after unmount.
  useEffect(() => () => abortRef.current?.abort(), []);

  return (
    <View
      style={{
        backgroundColor: colors.card,
        borderColor: colors.border,
        borderWidth: 1,
        borderRadius: colors.radius,
        padding: 14,
        gap: 12,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <Text style={{ color: colors.primary, fontFamily: FONT.display, fontSize: 13, letterSpacing: 0.5 }}>
          ★ AI RECOMMENDED
        </Text>
        {tried && !loading ? (
          <Pressable onPress={load} hitSlop={8} style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
            <Feather name="refresh-cw" size={13} color={colors.mutedForeground} />
            <Text style={{ color: colors.mutedForeground, fontFamily: FONT.semibold, fontSize: 12 }}>
              Refresh
            </Text>
          </Pressable>
        ) : null}
      </View>

      {loading ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 6 }}>
          <ActivityIndicator color={colors.primary} />
          <Text style={{ color: colors.mutedForeground, fontFamily: FONT.body, fontSize: 13 }}>
            Analyzing this matchup…
          </Text>
        </View>
      ) : !tried ? (
        <PrimaryButton label="Get AI picks for this game" icon="zap" onPress={load} />
      ) : error ? (
        <View style={{ gap: 10 }}>
          <Text style={{ color: colors.mutedForeground, fontFamily: FONT.body, fontSize: 13 }}>
            Couldn’t reach the AI Coach. Try again.
          </Text>
          <PrimaryButton label="Retry" icon="refresh-cw" onPress={load} />
        </View>
      ) : picks.length === 0 ? (
        <Text style={{ color: colors.mutedForeground, fontFamily: FONT.body, fontSize: 13, lineHeight: 18 }}>
          No defensible edges in this game’s posted lines right now. Try the full Coach for a broader slate.
        </Text>
      ) : (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 12, paddingRight: 4 }}
        >
          {picks.map((p, i) => (
            <AiPickCard key={`${p.game}|${p.pick}|${i}`} pick={p} />
          ))}
        </ScrollView>
      )}

      <Pressable
        onPress={() =>
          router.push({
            pathname: "/coach",
            params: { prefill: `Give me your best bet for ${gameLabel} tonight` },
          })
        }
        hitSlop={6}
        style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 }}
      >
        <Feather name="message-circle" size={13} color={colors.mutedForeground} />
        <Text style={{ color: colors.mutedForeground, fontFamily: FONT.semibold, fontSize: 12 }}>
          Ask the Coach about this game
        </Text>
      </Pressable>
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

          <AiGamePicks game={game} />

          {game.markets.map((m) => (
            <MarketBlock key={m.key} game={game} market={m} />
          ))}
        </ScrollView>
      )}
    </View>
  );
}

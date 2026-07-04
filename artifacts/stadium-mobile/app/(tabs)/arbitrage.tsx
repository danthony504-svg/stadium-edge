import { Feather, MaterialCommunityIcons } from "@expo/vector-icons";
import { useAuth } from "@clerk/expo";
import { useQueries } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import React, { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { FONT } from "@/components/ui";
import { useColors } from "@/hooks/useColors";
import { getOdds, getProps, propMarketLabel, PROPS_SPORTS } from "@/lib/api";
import {
  americanToDecimal,
  computeStakes,
  findGameLineArbs,
  findGameLineValueBets,
  findPropArbs,
  findPropValueBets,
  guaranteedReturn,
  impliedProb,
  type ArbOpportunity,
  type ArbPropGame,
  type ValueBet,
} from "@/lib/arbitrage";
import { SPORTS, sportLabel } from "@/lib/sports";

// Scan every sport for game-line arbs (cheap, one cached odds call per sport) and
// the soonest games for player-prop arbs. Kept modest because the prop fan-out is
// the expensive part; server caches each request for 5 min.
const ARB_MAX_GAMES = 6;
type Mode = "all" | "arbs" | "values";

const GAME_MARKET_LABEL: Record<string, string> = {
  h2h: "Moneyline",
  spreads: "Spread",
  totals: "Total",
};

function marketLabelFor(opp: ArbOpportunity): string {
  if (opp.kind === "prop") return propMarketLabel(opp.marketKey);
  return GAME_MARKET_LABEL[opp.marketKey] ?? opp.marketKey;
}

function formatOdds(american: number): string {
  return american > 0 ? `+${american}` : `${american}`;
}

function formatStart(iso?: string | null): string {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const d = new Date(t);
  return d.toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

type ScanResult = { arbs: ArbOpportunity[]; values: ValueBet[] };

// One sport's worth of edges: guaranteed arbs AND +EV value bets, for game lines
// (all sports) and player props (only the sports the props endpoint serves).
async function scanArb(sport: string, signal?: AbortSignal): Promise<ScanResult> {
  const odds = await getOdds(sport, signal);
  const now = Date.now();
  // Only scan near-term games (the app's standard "pickable" window). Books post
  // some slates months early (e.g. NFL Week 1) and edges days out are stale and
  // unactionable, so we cap to imminent games — matching the rest of the app and
  // keeping the board to what a bettor can actually place now.
  const NEAR_TERM_H = 48;
  const isNearTerm = (iso: string) => {
    const t = Date.parse(iso);
    return !Number.isNaN(t) && t > now - 4 * 3600_000 && t < now + NEAR_TERM_H * 3600_000;
  };
  const nearTerm = odds.filter((g) => isNearTerm(g.commenceTime));
  const gameArbs = findGameLineArbs(nearTerm);
  const gameValues = findGameLineValueBets(nearTerm);

  let propArbs: ArbOpportunity[] = [];
  let propValues: ValueBet[] = [];
  if (PROPS_SPORTS.includes(sport)) {
    const pickable = nearTerm
      .slice()
      .sort((a, b) => Date.parse(a.commenceTime) - Date.parse(b.commenceTime))
      .slice(0, ARB_MAX_GAMES);

    const propGames = await Promise.all(
      pickable.map(async (g): Promise<ArbPropGame> => {
        try {
          const r = await getProps(
            { sport, eventId: g.id, home: g.homeTeam, away: g.awayTeam },
            signal,
          );
          return {
            game: `${g.awayTeam} @ ${g.homeTeam}`,
            sport,
            startsAt: g.commenceTime,
            props: (r.props ?? []).filter((p) => !p.alt),
          };
        } catch {
          return { game: `${g.awayTeam} @ ${g.homeTeam}`, sport, startsAt: g.commenceTime, props: [] };
        }
      }),
    );
    propArbs = findPropArbs(propGames);
    propValues = findPropValueBets(propGames);
  }

  return { arbs: [...gameArbs, ...propArbs], values: [...gameValues, ...propValues] };
}

function StakeLeg({
  label,
  book,
  price,
  stake,
}: {
  label: string;
  book: string;
  price: number;
  stake: number;
}) {
  const colors = useColors();
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        paddingVertical: 10,
        paddingHorizontal: 12,
        borderRadius: 12,
        backgroundColor: colors.background,
        borderWidth: 1,
        borderColor: colors.border,
        gap: 10,
      }}
    >
      <View style={{ flex: 1 }}>
        <Text style={{ color: colors.foreground, fontFamily: FONT.semibold, fontSize: 14 }}>
          {label}
        </Text>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 3 }}>
          <Feather name="map-pin" size={11} color={colors.primary} />
          <Text style={{ color: colors.primary, fontFamily: FONT.semibold, fontSize: 12 }}>
            {book}
          </Text>
          <Text style={{ color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 12 }}>
            · {formatOdds(price)}
          </Text>
        </View>
      </View>
      <View style={{ alignItems: "flex-end" }}>
        <Text style={{ color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 10 }}>
          BET
        </Text>
        <Text style={{ color: colors.foreground, fontFamily: FONT.bold, fontSize: 15 }}>
          ${stake.toFixed(2)}
        </Text>
      </View>
    </View>
  );
}

function ArbCard({ opp, total }: { opp: ArbOpportunity; total: number }) {
  const colors = useColors();
  const impl = opp.legs.map((l) => l.impliedProb);
  const stakes = computeStakes(impl, total);
  const ret = guaranteedReturn(impl, total);
  const profit = Math.round((ret - total) * 100) / 100;
  const start = formatStart(opp.startsAt);

  return (
    <View
      style={{
        backgroundColor: colors.card,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: colors.border,
        padding: 14,
        gap: 10,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 10 }}>
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <View
              style={{
                paddingHorizontal: 7,
                paddingVertical: 2,
                borderRadius: 6,
                backgroundColor: colors.surface,
                borderWidth: 1,
                borderColor: colors.border,
              }}
            >
              <Text style={{ color: colors.mutedForeground, fontFamily: FONT.bold, fontSize: 10 }}>
                {sportLabel(opp.sport).toUpperCase()}
              </Text>
            </View>
            <Text style={{ color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 11 }}>
              {marketLabelFor(opp)}
            </Text>
          </View>
          {opp.player ? (
            <Text
              style={{ color: colors.foreground, fontFamily: FONT.bold, fontSize: 16, marginTop: 6 }}
            >
              {opp.player}
            </Text>
          ) : null}
          <Text
            style={{
              color: opp.player ? colors.mutedForeground : colors.foreground,
              fontFamily: opp.player ? FONT.medium : FONT.semibold,
              fontSize: opp.player ? 12 : 15,
              marginTop: opp.player ? 2 : 6,
            }}
          >
            {opp.game}
          </Text>
          {start ? (
            <Text style={{ color: colors.mutedForeground, fontFamily: FONT.body, fontSize: 11, marginTop: 2 }}>
              {start}
            </Text>
          ) : null}
        </View>
        <View
          style={{
            paddingHorizontal: 10,
            paddingVertical: 6,
            borderRadius: 10,
            backgroundColor: "rgba(34,197,94,0.15)",
            borderWidth: 1,
            borderColor: "rgba(34,197,94,0.4)",
            alignItems: "center",
          }}
        >
          <Text style={{ color: "#22c55e", fontFamily: FONT.bold, fontSize: 17 }}>
            +{opp.profitPct}%
          </Text>
          <Text style={{ color: "#22c55e", fontFamily: FONT.semibold, fontSize: 8, letterSpacing: 0.5 }}>
            GUARANTEED
          </Text>
        </View>
      </View>

      <View style={{ gap: 8 }}>
        {opp.legs.map((leg, i) => (
          <StakeLeg
            key={`${leg.label}-${leg.book}-${i}`}
            label={leg.label}
            book={leg.book}
            price={leg.price}
            stake={stakes[i]}
          />
        ))}
      </View>

      <Text style={{ color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 12 }}>
        Stake ${total.toFixed(0)} →{" "}
        <Text style={{ color: colors.foreground, fontFamily: FONT.semibold }}>
          ${ret.toFixed(2)} back
        </Text>{" "}
        whatever happens (profit{" "}
        <Text style={{ color: "#22c55e", fontFamily: FONT.semibold }}>${profit.toFixed(2)}</Text>).
      </Text>
    </View>
  );
}

const VALUE_ACCENT = "#f59e0b"; // amber — distinct from the green "guaranteed" arb badge

function ValueCard({ vb, total }: { vb: ValueBet; total: number }) {
  const colors = useColors();
  const ret = Math.round(total * americanToDecimal(vb.price) * 100) / 100;
  const profit = Math.round((ret - total) * 100) / 100;
  const start = formatStart(vb.startsAt);
  const fairPct = Math.round(vb.fairProb * 100);
  const pricePct = Math.round(impliedProb(vb.price) * 100);

  return (
    <View
      style={{
        backgroundColor: colors.card,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: colors.border,
        padding: 14,
        gap: 10,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 10 }}>
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <View
              style={{
                paddingHorizontal: 7,
                paddingVertical: 2,
                borderRadius: 6,
                backgroundColor: colors.surface,
                borderWidth: 1,
                borderColor: colors.border,
              }}
            >
              <Text style={{ color: colors.mutedForeground, fontFamily: FONT.bold, fontSize: 10 }}>
                {sportLabel(vb.sport).toUpperCase()}
              </Text>
            </View>
            <Text style={{ color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 11 }}>
              {vb.kind === "prop" ? propMarketLabel(vb.marketKey) : GAME_MARKET_LABEL[vb.marketKey] ?? vb.marketKey}
            </Text>
          </View>
          {vb.player ? (
            <Text style={{ color: colors.foreground, fontFamily: FONT.bold, fontSize: 16, marginTop: 6 }}>
              {vb.player}
            </Text>
          ) : null}
          <Text
            style={{
              color: vb.player ? colors.mutedForeground : colors.foreground,
              fontFamily: vb.player ? FONT.medium : FONT.semibold,
              fontSize: vb.player ? 12 : 15,
              marginTop: vb.player ? 2 : 6,
            }}
          >
            {vb.game}
          </Text>
          {start ? (
            <Text style={{ color: colors.mutedForeground, fontFamily: FONT.body, fontSize: 11, marginTop: 2 }}>
              {start}
            </Text>
          ) : null}
        </View>
        <View
          style={{
            paddingHorizontal: 10,
            paddingVertical: 6,
            borderRadius: 10,
            backgroundColor: "rgba(245,158,11,0.15)",
            borderWidth: 1,
            borderColor: "rgba(245,158,11,0.4)",
            alignItems: "center",
          }}
        >
          <Text style={{ color: VALUE_ACCENT, fontFamily: FONT.bold, fontSize: 17 }}>+{vb.edgePct}%</Text>
          <Text style={{ color: VALUE_ACCENT, fontFamily: FONT.semibold, fontSize: 8, letterSpacing: 0.5 }}>
            EV EDGE
          </Text>
        </View>
      </View>

      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          paddingVertical: 10,
          paddingHorizontal: 12,
          borderRadius: 12,
          backgroundColor: colors.background,
          borderWidth: 1,
          borderColor: colors.border,
          gap: 10,
        }}
      >
        <View style={{ flex: 1 }}>
          <Text style={{ color: colors.foreground, fontFamily: FONT.semibold, fontSize: 14 }}>{vb.label}</Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 3 }}>
            <Feather name="map-pin" size={11} color={colors.primary} />
            <Text style={{ color: colors.primary, fontFamily: FONT.semibold, fontSize: 12 }}>{vb.book}</Text>
            <Text style={{ color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 12 }}>
              · {formatOdds(vb.price)}
            </Text>
          </View>
        </View>
        <View style={{ alignItems: "flex-end" }}>
          <Text style={{ color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 10 }}>BET</Text>
          <Text style={{ color: colors.foreground, fontFamily: FONT.bold, fontSize: 15 }}>${total.toFixed(2)}</Text>
        </View>
      </View>

      <Text style={{ color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 12, lineHeight: 18 }}>
        Fair win chance{" "}
        <Text style={{ color: colors.foreground, fontFamily: FONT.semibold }}>{fairPct}%</Text> vs this price's{" "}
        <Text style={{ color: colors.foreground, fontFamily: FONT.semibold }}>{pricePct}%</Text> — a real edge across{" "}
        {vb.books} books. Wins{" "}
        <Text style={{ color: colors.foreground, fontFamily: FONT.semibold }}>${ret.toFixed(2)}</Text> (profit{" "}
        <Text style={{ color: VALUE_ACCENT, fontFamily: FONT.semibold }}>${profit.toFixed(2)}</Text>) if it hits.
      </Text>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <Feather name="alert-triangle" size={11} color={VALUE_ACCENT} />
        <Text style={{ color: VALUE_ACCENT, fontFamily: FONT.semibold, fontSize: 11 }}>
          Positive expected value — NOT a guaranteed win.
        </Text>
      </View>
    </View>
  );
}

export default function ArbitrageScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { isSignedIn } = useAuth();
  const [stakeText, setStakeText] = useState("100");
  const [mode, setMode] = useState<Mode>("all");
  const [sportFilter, setSportFilter] = useState<string | null>(null);

  const total = useMemo(() => {
    const n = parseFloat(stakeText);
    return Number.isFinite(n) && n > 0 ? n : 100;
  }, [stakeText]);

  const queries = useQueries({
    queries: SPORTS.map((s) => ({
      queryKey: ["arbitrage", s.id],
      queryFn: ({ signal }: { signal?: AbortSignal }) => scanArb(s.id, signal),
      staleTime: 3 * 60 * 1000,
    })),
  });

  const isLoading = queries.some((q) => q.isLoading);
  const isFetching = queries.some((q) => q.isFetching);
  const allErrored = queries.length > 0 && queries.every((q) => q.isError);

  const dataStamp = queries.map((q) => q.dataUpdatedAt).join(",");
  const { arbs, values } = useMemo(() => {
    const allArbs: ArbOpportunity[] = [];
    const allValues: ValueBet[] = [];
    for (const q of queries) {
      if (!q.data) continue;
      allArbs.push(...q.data.arbs);
      allValues.push(...q.data.values);
    }
    // Guaranteed arbs: de-dupe by id, biggest locked-in edge first.
    const seenA = new Set<string>();
    const arbs = allArbs
      .filter((o) => (seenA.has(o.id) ? false : (seenA.add(o.id), true)))
      .sort((a, b) => b.profitPct - a.profitPct);
    // Value bets: drop any on a market that already has a guaranteed arb (don't
    // show the same matchup twice), de-dupe, biggest +EV first, then cap.
    const arbMarkets = new Set(arbs.map((o) => `${o.game}|${o.marketKey}|${o.player ?? ""}`));
    const seenV = new Set<string>();
    const values = allValues
      .filter((v) => !arbMarkets.has(`${v.game}|${v.marketKey}|${v.player ?? ""}`))
      .filter((v) => (seenV.has(v.id) ? false : (seenV.add(v.id), true)))
      .sort((a, b) => b.edgePct - a.edgePct)
      .slice(0, 40);
    return { arbs, values };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataStamp]);

  const shownArbs = useMemo(
    () => (mode === "values" ? [] : arbs.filter((a) => !sportFilter || a.sport === sportFilter)),
    [arbs, mode, sportFilter],
  );
  const shownValues = useMemo(
    () => (mode === "arbs" ? [] : values.filter((v) => !sportFilter || v.sport === sportFilter)),
    [values, mode, sportFilter],
  );
  const hasAny = shownArbs.length > 0 || shownValues.length > 0;

  const refetchAll = () => {
    for (const q of queries) q.refetch();
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: 16,
          paddingBottom: insets.bottom + 120,
          gap: 14,
        }}
        refreshControl={
          <RefreshControl refreshing={isFetching && !isLoading} onRefresh={refetchAll} tintColor={colors.primary} />
        }
      >
        <View style={{ paddingTop: insets.top + 6, marginHorizontal: -16, paddingHorizontal: 16, backgroundColor: colors.background }}>
          <View style={{ paddingLeft: 78, paddingRight: 58, marginBottom: 14, alignItems: "flex-start" }}>
            <Image
              source={require("@/assets/images/logo-wordmark.png")}
              style={{ width: "78%", height: 44 }}
              resizeMode="contain"
              fadeDuration={0}
              accessibilityLabel="Stadium Edge"
            />
            <Pressable
              onPress={() => router.push(isSignedIn ? "/notifications" : "/sign-in")}
              hitSlop={8}
              style={({ pressed }) => ({
                position: "absolute",
                right: 0,
                top: 3,
                width: 38,
                height: 38,
                borderRadius: 12,
                borderWidth: 1,
                borderColor: colors.border,
                backgroundColor: colors.card,
                alignItems: "center",
                justifyContent: "center",
                opacity: pressed ? 0.7 : 1,
              })}
            >
              <Feather name="bell" size={17} color={colors.foreground} />
            </Pressable>
          </View>

          <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 14 }}>
            <View
              style={{
                width: 42,
                height: 42,
                borderRadius: 21,
                backgroundColor: "rgba(59,130,246,0.18)",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Feather name="lock" size={19} color={colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ color: colors.foreground, fontFamily: FONT.display, fontSize: 20 }}>
                Edge Lock
              </Text>
              <Text style={{ color: colors.mutedForeground, fontFamily: FONT.body, fontSize: 12, marginTop: 2 }}>
                Guaranteed arbitrage plus higher-upside value bets — all from real sportsbook prices.
              </Text>
            </View>
            <Pressable
              onPress={() => {}}
              style={({ pressed }) => ({
                flexDirection: "row",
                alignItems: "center",
                gap: 6,
                paddingHorizontal: 12,
                paddingVertical: 7,
                borderRadius: 999,
                borderWidth: 1,
                borderColor: colors.primary,
                opacity: pressed ? 0.75 : 1,
              })}
            >
              <Text style={{ color: colors.primary, fontFamily: FONT.medium, fontSize: 12 }}>
                How it works
              </Text>
              <Feather name="info" size={13} color={colors.primary} />
            </Pressable>
          </View>
        </View>

        {/* Explainer + stake input */}
        <View
          style={{
            backgroundColor: colors.card,
            borderRadius: colors.radius,
            borderWidth: 1,
            borderColor: colors.primary,
            padding: 14,
            gap: 12,
          }}
        >
          <View style={{ flexDirection: "row", gap: 10 }}>
            <Feather name="info" size={16} color={colors.primary} style={{ marginTop: 2 }} />
            <Text style={{ flex: 1, color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 12, lineHeight: 18 }}>
              We scan real prices across US sportsbooks. <Text style={{ color: "#22c55e", fontFamily: FONT.semibold }}>Arbitrage</Text> bets
              both sides at different books for a locked-in profit. <Text style={{ color: VALUE_ACCENT, fontFamily: FONT.semibold }}>Value bets</Text> are
              single prices that beat the market's fair value — positive expected value, but
              not guaranteed.
            </Text>
          </View>
          <View style={{ height: 1, backgroundColor: colors.border }} />
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            <Text style={{ color: colors.foreground, fontFamily: FONT.semibold, fontSize: 13 }}>
              Total stake
            </Text>
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                backgroundColor: colors.background,
                borderRadius: 10,
                borderWidth: 1,
                borderColor: colors.border,
                paddingHorizontal: 10,
              }}
            >
              <Text style={{ color: colors.mutedForeground, fontFamily: FONT.semibold, fontSize: 15 }}>$</Text>
              <TextInput
                value={stakeText}
                onChangeText={setStakeText}
                keyboardType="numeric"
                selectTextOnFocus
                style={{
                  color: colors.foreground,
                  fontFamily: FONT.bold,
                  fontSize: 15,
                  paddingVertical: 8,
                  minWidth: 70,
                }}
                placeholder="100"
                placeholderTextColor={colors.mutedForeground}
              />
            </View>
          </View>
        </View>

        <View style={{ flexDirection: "row", borderRadius: 8, borderWidth: 1, borderColor: colors.border, overflow: "hidden" }}>
          {[
            { id: "all" as Mode, label: "All", icon: null, color: colors.primary },
            { id: "arbs" as Mode, label: "Arbitrage", icon: "trending-up" as const, color: "#22c55e" },
            { id: "values" as Mode, label: "Value Bets", icon: "trending-up" as const, color: VALUE_ACCENT },
          ].map((tab, i) => {
            const active = mode === tab.id;
            return (
              <Pressable
                key={tab.id}
                onPress={() => setMode(tab.id)}
                style={{
                  flex: 1,
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 6,
                  paddingVertical: 9,
                  backgroundColor: active ? colors.primary : "transparent",
                  borderLeftWidth: i === 0 ? 0 : 1,
                  borderLeftColor: colors.border,
                }}
              >
                {tab.icon ? <Feather name={tab.icon} size={13} color={active ? "#fff" : tab.color} /> : null}
                <Text style={{ color: active ? "#fff" : tab.color, fontFamily: FONT.bold, fontSize: 12 }}>
                  {tab.label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
          {SPORTS.filter((s) => ["mlb", "wnba", "nba", "nhl", "soccer", "tennis", "nfl"].includes(s.id)).map((s) => {
            const active = sportFilter === s.id;
            return (
              <Pressable
                key={s.id}
                onPress={() => setSportFilter((cur) => (cur === s.id ? null : s.id))}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 6,
                  paddingHorizontal: 10,
                  paddingVertical: 7,
                  borderRadius: 999,
                  borderWidth: 1,
                  borderColor: active ? colors.primary : colors.border,
                  backgroundColor: active ? colors.primary : colors.card,
                }}
              >
                <MaterialCommunityIcons name={s.icon} size={14} color={active ? "#fff" : colors.foreground} />
                <Text style={{ color: active ? "#fff" : colors.foreground, fontFamily: FONT.semibold, fontSize: 12 }}>
                  {s.label}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>

        {isLoading ? (
          <View style={{ paddingVertical: 60, alignItems: "center", gap: 12 }}>
            <ActivityIndicator color={colors.primary} />
            <Text style={{ color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 13 }}>
              Scanning the board…
            </Text>
          </View>
        ) : allErrored ? (
          <View style={{ paddingVertical: 50, alignItems: "center", gap: 12 }}>
            <Feather name="wifi-off" size={28} color={colors.mutedForeground} />
            <Text style={{ color: colors.foreground, fontFamily: FONT.semibold, fontSize: 15 }}>
              Couldn't reach the odds feed
            </Text>
            <Pressable
              onPress={refetchAll}
              style={{
                paddingHorizontal: 18,
                paddingVertical: 10,
                borderRadius: 10,
                backgroundColor: colors.primary,
              }}
            >
              <Text style={{ color: "#020617", fontFamily: FONT.bold, fontSize: 14 }}>Retry</Text>
            </Pressable>
          </View>
        ) : !hasAny ? (
          <View style={{ paddingVertical: 50, alignItems: "center", gap: 12, paddingHorizontal: 20 }}>
            <Feather name="search" size={28} color={colors.mutedForeground} />
            <Text style={{ color: colors.foreground, fontFamily: FONT.semibold, fontSize: 15, textAlign: "center" }}>
              No edges on the board right now
            </Text>
            <Text style={{ color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 13, textAlign: "center", lineHeight: 19 }}>
              Books are priced efficiently at the moment. Edges appear and disappear quickly —
              pull to refresh to scan again.
            </Text>
          </View>
        ) : (
          <>
            {shownArbs.length > 0 ? (
              <>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <Feather name="lock" size={13} color="#22c55e" />
                  <Text style={{ color: "#22c55e", fontFamily: FONT.bold, fontSize: 12, letterSpacing: 0.5 }}>
                    GUARANTEED ARBITRAGE · {shownArbs.length}
                  </Text>
                </View>
                {shownArbs.map((opp) => (
                  <ArbCard key={opp.id} opp={opp} total={total} />
                ))}
              </>
            ) : null}

            {shownValues.length > 0 ? (
              <>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: shownArbs.length > 0 ? 6 : 0 }}>
                  <Feather name="trending-up" size={13} color={VALUE_ACCENT} />
                  <Text style={{ color: VALUE_ACCENT, fontFamily: FONT.bold, fontSize: 12, letterSpacing: 0.5 }}>
                    VALUE BETS · {shownValues.length}
                  </Text>
                  <View style={{ flex: 1 }} />
                  <Pressable
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 6,
                      borderWidth: 1,
                      borderColor: colors.border,
                      borderRadius: 10,
                      paddingHorizontal: 10,
                      paddingVertical: 7,
                    }}
                  >
                    <Text style={{ color: colors.foreground, fontFamily: FONT.medium, fontSize: 11 }}>
                      Sort: EV Edge
                    </Text>
                    <Feather name="chevron-down" size={13} color={colors.mutedForeground} />
                  </Pressable>
                </View>
                <Text style={{ color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 12, lineHeight: 18, marginTop: -4 }}>
                  Higher upside. Real prices that beat the market's fair value — positive
                  expected value, not guaranteed wins.
                </Text>
                {shownValues.map((vb) => (
                  <ValueCard key={vb.id} vb={vb} total={total} />
                ))}
              </>
            ) : null}
          </>
        )}
      </ScrollView>
    </View>
  );
}

import { Feather } from "@expo/vector-icons";
import { useQueries } from "@tanstack/react-query";
import React, { useMemo, useState } from "react";
import {
  ActivityIndicator,
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
  computeStakes,
  findGameLineArbs,
  findPropArbs,
  guaranteedReturn,
  type ArbOpportunity,
  type ArbPropGame,
} from "@/lib/arbitrage";
import { SPORTS, sportLabel } from "@/lib/sports";

// Scan every sport for game-line arbs (cheap, one cached odds call per sport) and
// the soonest games for player-prop arbs. Kept modest because the prop fan-out is
// the expensive part; server caches each request for 5 min.
const ARB_MAX_GAMES = 6;

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
    hour: "numeric",
    minute: "2-digit",
  });
}

// One sport's worth of opportunities: game lines for all sports, props only for
// the sports the props endpoint actually serves.
async function scanArb(sport: string, signal?: AbortSignal): Promise<ArbOpportunity[]> {
  const odds = await getOdds(sport, signal);
  const gameArbs = findGameLineArbs(odds);

  let propArbs: ArbOpportunity[] = [];
  if (PROPS_SPORTS.includes(sport)) {
    const now = Date.now();
    const HORIZON_H = sport === "soccer" ? 14 * 24 : 48;
    const pickable = odds
      .filter((g) => {
        const t = Date.parse(g.commenceTime);
        return !Number.isNaN(t) && t > now - 4 * 3600_000 && t < now + HORIZON_H * 3600_000;
      })
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
  }

  return [...gameArbs, ...propArbs];
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

export default function ArbitrageScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [stakeText, setStakeText] = useState("100");

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
  const opportunities = useMemo(() => {
    const all: ArbOpportunity[] = [];
    for (const q of queries) if (q.data) all.push(...q.data);
    // De-dupe by id (a game can surface via two sport scans only if mis-tagged)
    // and sort biggest guaranteed edge first.
    const seen = new Set<string>();
    const unique = all.filter((o) => (seen.has(o.id) ? false : (seen.add(o.id), true)));
    return unique.sort((a, b) => b.profitPct - a.profitPct);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataStamp]);

  const refetchAll = () => {
    for (const q of queries) q.refetch();
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView
        contentContainerStyle={{
          paddingTop: insets.top + 56,
          paddingHorizontal: 16,
          paddingBottom: insets.bottom + 120,
          gap: 14,
        }}
        refreshControl={
          <RefreshControl refreshing={isFetching && !isLoading} onRefresh={refetchAll} tintColor={colors.primary} />
        }
      >
        <View>
          <Text style={{ color: colors.foreground, fontFamily: FONT.bold, fontSize: 26 }}>
            Arbitrage
          </Text>
          <Text style={{ color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 13, marginTop: 4 }}>
            Bet both sides at different books for a guaranteed profit no matter the result.
          </Text>
        </View>

        {/* Explainer + stake input */}
        <View
          style={{
            backgroundColor: colors.card,
            borderRadius: 16,
            borderWidth: 1,
            borderColor: colors.border,
            padding: 14,
            gap: 12,
          }}
        >
          <View style={{ flexDirection: "row", gap: 10 }}>
            <Feather name="info" size={16} color={colors.primary} style={{ marginTop: 2 }} />
            <Text style={{ flex: 1, color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 12, lineHeight: 18 }}>
              We scan real prices across US sportsbooks for game lines and player props.
              When one book's Over plus another book's Under add up to under 100% implied
              probability, that's a locked-in edge. True arbs are rare and vanish fast.
            </Text>
          </View>
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
        ) : opportunities.length === 0 ? (
          <View style={{ paddingVertical: 50, alignItems: "center", gap: 12, paddingHorizontal: 20 }}>
            <Feather name="search" size={28} color={colors.mutedForeground} />
            <Text style={{ color: colors.foreground, fontFamily: FONT.semibold, fontSize: 15, textAlign: "center" }}>
              No arbitrage on the board right now
            </Text>
            <Text style={{ color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 13, textAlign: "center", lineHeight: 19 }}>
              Books are priced efficiently at the moment. Arbs appear and disappear quickly —
              pull to refresh to scan again.
            </Text>
          </View>
        ) : (
          <>
            <Text style={{ color: colors.mutedForeground, fontFamily: FONT.semibold, fontSize: 12 }}>
              {opportunities.length} OPPORTUNIT{opportunities.length === 1 ? "Y" : "IES"} FOUND
            </Text>
            {opportunities.map((opp) => (
              <ArbCard key={opp.id} opp={opp} total={total} />
            ))}
          </>
        )}
      </ScrollView>
    </View>
  );
}

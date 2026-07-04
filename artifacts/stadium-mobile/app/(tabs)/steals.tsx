import { Feather, MaterialCommunityIcons } from "@expo/vector-icons";
import { useAuth } from "@clerk/expo";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import React from "react";
import {
  ActivityIndicator,
  Image,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  View,
} from "react-native";
import Svg, { Circle, Line } from "react-native-svg";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { FONT } from "@/components/ui";
import { useColors } from "@/hooks/useColors";
import { getLiveSteals, propMarketLabel, type LiveSteal, type StealRecord } from "@/lib/api";
import { SPORTS, sportLabel } from "@/lib/sports";
import {
  americanToDecimal,
  formatOdds,
  formatPct,
  recordLabel,
  recordWinPct,
} from "@/lib/steals";

const STEAL_ACCENT = "#a855f7"; // violet — longshot upside, distinct from the app's cyan/green/amber
const STEAL_SPORTS = ["nba", "mlb", "nhl", "soccer"];

const GAME_MARKET_LABEL: Record<string, string> = {
  h2h: "Moneyline",
  Moneyline: "Moneyline",
  spreads: "Spread",
  Spread: "Spread",
  totals: "Total",
  Total: "Total",
};

function marketLabelFor(s: LiveSteal): string {
  if (s.player) return propMarketLabel(s.market);
  return GAME_MARKET_LABEL[s.market] ?? s.market;
}

function formatStart(iso?: string | null): string {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  return new Date(t).toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function RecordCard({ record }: { record: StealRecord }) {
  const colors = useColors();
  const pct = recordWinPct(record);
  const decided = record.wins + record.losses;

  return (
    <View
      style={{
        backgroundColor: colors.card,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: STEAL_ACCENT,
        padding: 16,
        gap: 14,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Feather name="award" size={15} color={STEAL_ACCENT} />
        <Text style={{ color: colors.foreground, fontFamily: FONT.bold, fontSize: 15 }}>
          Steal track record
        </Text>
      </View>

      {record.graded > 0 || record.pending > 0 || record.ungraded > 0 ? (
        <>
          <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 16 }}>
            <View>
              <Text style={{ color: STEAL_ACCENT, fontFamily: FONT.bold, fontSize: 34, lineHeight: 38 }}>
                {recordLabel(record)}
              </Text>
              <Text style={{ color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 11, marginTop: 2 }}>
                W–L{record.pushes > 0 ? "–Push" : ""}
              </Text>
            </View>
            {pct != null ? (
              <View style={{ alignItems: "flex-end", flex: 1 }}>
                <Text style={{ color: colors.foreground, fontFamily: FONT.bold, fontSize: 22 }}>
                  {pct}%
                </Text>
                <Text style={{ color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 11 }}>
                  hit rate · {decided} settled
                </Text>
              </View>
            ) : null}
          </View>
          {record.pending > 0 || record.ungraded > 0 ? (
            <Text style={{ color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 11 }}>
              {record.pending > 0 ? `${record.pending} awaiting result` : ""}
              {record.pending > 0 && record.ungraded > 0 ? " · " : ""}
              {record.ungraded > 0 ? `${record.ungraded} couldn't be graded` : ""}
            </Text>
          ) : null}
        </>
      ) : (
        <Text style={{ color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 12, lineHeight: 18 }}>
          No steals have settled yet. Every pick below is logged and auto-graded against the
          real result — the record fills in as games finish.
        </Text>
      )}

      <View style={{ height: 1, backgroundColor: colors.border }} />
      <View style={{ flexDirection: "row", gap: 10 }}>
        <Feather name="shield" size={17} color={STEAL_ACCENT} />
        <View style={{ flex: 1 }}>
          <Text style={{ color: colors.foreground, fontFamily: FONT.bold, fontSize: 13 }}>
            100% transparent
          </Text>
          <Text style={{ color: colors.mutedForeground, fontFamily: FONT.body, fontSize: 12, lineHeight: 17, marginTop: 4 }}>
            These are the app&apos;s own flagged longshots, graded against real game results — not your personal bets.
          </Text>
        </View>
      </View>
    </View>
  );
}

function RadarScan() {
  const colors = useColors();
  const size = 170;
  const c = size / 2;
  return (
    <View style={{ alignItems: "center", paddingVertical: 32, gap: 14 }}>
      <Svg width={size} height={size}>
        {[24, 44, 66, 84].map((r) => (
          <Circle key={r} cx={c} cy={c} r={r} fill="none" stroke="rgba(168,85,247,0.35)" strokeWidth="1" />
        ))}
        <Line x1={c} y1={c} x2={c + 62} y2={c - 43} stroke={STEAL_ACCENT} strokeWidth="3" />
        <Circle cx={c + 62} cy={c - 43} r="4" fill={STEAL_ACCENT} />
        <Circle cx={c - 28} cy={c + 40} r="3" fill={STEAL_ACCENT} />
        <Circle cx={c + 52} cy={c + 18} r="3" fill={STEAL_ACCENT} />
        <Circle cx={c - 36} cy={c - 10} r="3" fill={colors.foreground} />
      </Svg>
      <Text style={{ color: colors.foreground, fontFamily: FONT.display, fontSize: 19 }}>
        Hunting for steals...
      </Text>
      <Text style={{ color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 13, lineHeight: 19, textAlign: "center" }}>
        Scanning 20+ sportsbooks for longshots with real edge.{"\n"}
        This may take a few seconds.
      </Text>
    </View>
  );
}

function StealCard({ steal }: { steal: LiveSteal }) {
  const colors = useColors();
  const start = formatStart(steal.startsAt);
  const toWin = Math.round(100 * (americanToDecimal(steal.price) - 1));
  const fairPct = steal.fairProb != null ? Math.round(steal.fairProb * 100) : null;

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
                {sportLabel(steal.sport).toUpperCase()}
              </Text>
            </View>
            <Text style={{ color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 11 }}>
              {marketLabelFor(steal)}
            </Text>
          </View>
          {steal.player ? (
            <Text style={{ color: colors.foreground, fontFamily: FONT.bold, fontSize: 16, marginTop: 6 }}>
              {steal.player}
            </Text>
          ) : null}
          <Text
            style={{
              color: colors.foreground,
              fontFamily: FONT.semibold,
              fontSize: steal.player ? 13 : 15,
              marginTop: steal.player ? 2 : 6,
            }}
          >
            {steal.pick}
          </Text>
          <Text style={{ color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 12, marginTop: 2 }}>
            {steal.game}
          </Text>
          {start ? (
            <Text style={{ color: colors.mutedForeground, fontFamily: FONT.body, fontSize: 11, marginTop: 2 }}>
              {start}
            </Text>
          ) : null}
        </View>
        <View
          style={{
            paddingHorizontal: 12,
            paddingVertical: 6,
            borderRadius: 10,
            backgroundColor: "rgba(168,85,247,0.15)",
            borderWidth: 1,
            borderColor: "rgba(168,85,247,0.4)",
            alignItems: "center",
          }}
        >
          <Text style={{ color: STEAL_ACCENT, fontFamily: FONT.bold, fontSize: 18 }}>
            {formatOdds(steal.price)}
          </Text>
          <Text style={{ color: STEAL_ACCENT, fontFamily: FONT.semibold, fontSize: 8, letterSpacing: 0.5 }}>
            LONGSHOT
          </Text>
        </View>
      </View>

      {/* Real edge/EV readout — only fields the server priced honestly are shown. */}
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
          gap: 14,
        }}
      >
        {steal.ev != null ? (
          <View>
            <Text style={{ color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 10 }}>+EV</Text>
            <Text style={{ color: "#22c55e", fontFamily: FONT.bold, fontSize: 15 }}>{formatPct(steal.ev)}</Text>
          </View>
        ) : null}
        {steal.edge != null ? (
          <View>
            <Text style={{ color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 10 }}>EDGE</Text>
            <Text style={{ color: colors.foreground, fontFamily: FONT.bold, fontSize: 15 }}>
              {formatPct(steal.edge)}
            </Text>
          </View>
        ) : null}
        {fairPct != null ? (
          <View>
            <Text style={{ color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 10 }}>FAIR</Text>
            <Text style={{ color: colors.foreground, fontFamily: FONT.bold, fontSize: 15 }}>{fairPct}%</Text>
          </View>
        ) : null}
        <View style={{ flex: 1, alignItems: "flex-end" }}>
          <Text style={{ color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 10 }}>$100 WINS</Text>
          <Text style={{ color: colors.foreground, fontFamily: FONT.bold, fontSize: 15 }}>${toWin}</Text>
        </View>
      </View>

      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <Feather name="alert-triangle" size={11} color={STEAL_ACCENT} />
        <Text style={{ color: STEAL_ACCENT, fontFamily: FONT.semibold, fontSize: 11 }}>
          High-variance longshot — positive value, NOT a likely win.
        </Text>
      </View>
    </View>
  );
}

export default function StealsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { isSignedIn } = useAuth();
  const [sportFilter, setSportFilter] = React.useState<string | null>(null);

  const query = useQuery({
    queryKey: ["live-steals"],
    queryFn: ({ signal }) => getLiveSteals(signal),
    staleTime: 3 * 60 * 1000,
  });

  const steals = query.data?.steals ?? [];
  const filteredSteals = React.useMemo(
    () => steals.filter((s) => !sportFilter || s.sport === sportFilter),
    [steals, sportFilter],
  );
  const record: StealRecord =
    query.data?.record ?? { wins: 0, losses: 0, pushes: 0, pending: 0, ungraded: 0, graded: 0 };

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: 16,
          paddingBottom: insets.bottom + 120,
          gap: 14,
        }}
        refreshControl={
          <RefreshControl
            refreshing={query.isFetching && !query.isLoading}
            onRefresh={() => query.refetch()}
            tintColor={colors.primary}
          />
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
          <View style={{ flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 14 }}>
            <View
              style={{
                width: 50,
                height: 50,
                borderRadius: 12,
                borderWidth: 1,
                borderColor: STEAL_ACCENT,
                backgroundColor: "rgba(168,85,247,0.18)",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Text style={{ color: STEAL_ACCENT, fontFamily: FONT.display, fontSize: 14 }}>+500</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ color: colors.foreground, fontFamily: FONT.display, fontSize: 24 }}>
                +500 Steals
              </Text>
              <Text style={{ color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 13, marginTop: 4, lineHeight: 18 }}>
                Longshots (+500 and up) that carry a real cross-book edge — high risk, high upside.
              </Text>
            </View>
          </View>
        </View>

        <RecordCard record={record} />

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
          <Pressable
            onPress={() => setSportFilter(null)}
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 6,
              paddingVertical: 9,
              paddingHorizontal: 12,
              borderRadius: 10,
              backgroundColor: sportFilter == null ? STEAL_ACCENT : colors.card,
              borderWidth: 1,
              borderColor: sportFilter == null ? STEAL_ACCENT : colors.border,
            }}
          >
            <MaterialCommunityIcons name="trophy-outline" size={14} color={sportFilter == null ? "#fff" : colors.foreground} />
            <Text style={{ color: sportFilter == null ? "#fff" : colors.foreground, fontFamily: FONT.bold, fontSize: 12 }}>
              All
            </Text>
          </Pressable>
          {SPORTS.filter((s) => STEAL_SPORTS.includes(s.id)).map((sport) => {
            const active = sportFilter === sport.id;
            return (
              <Pressable
                key={sport.id}
                onPress={() => setSportFilter((cur) => (cur === sport.id ? null : sport.id))}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 6,
                  paddingVertical: 9,
                  paddingHorizontal: 12,
                  borderRadius: 10,
                  backgroundColor: active ? STEAL_ACCENT : colors.card,
                  borderWidth: 1,
                  borderColor: active ? STEAL_ACCENT : colors.border,
                }}
              >
                <MaterialCommunityIcons name={sport.icon} size={14} color={active ? "#fff" : colors.foreground} />
                <Text style={{ color: active ? "#fff" : colors.foreground, fontFamily: FONT.semibold, fontSize: 12 }}>
                  {sport.label}
                </Text>
              </Pressable>
            );
          })}
          <Pressable
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 7,
              paddingVertical: 9,
              paddingHorizontal: 12,
              borderRadius: 10,
              backgroundColor: colors.card,
              borderWidth: 1,
              borderColor: colors.border,
            }}
          >
            <Feather name="filter" size={14} color={colors.foreground} />
            <Text style={{ color: colors.foreground, fontFamily: FONT.semibold, fontSize: 12 }}>Filters</Text>
            <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: STEAL_ACCENT }} />
          </Pressable>
        </ScrollView>

        <View style={{ flexDirection: "row", borderBottomWidth: 1, borderBottomColor: colors.border, paddingBottom: 10 }}>
          {["GAME / MARKET", "EV EDGE ↓", "BOOKS", "TIME"].map((h, i) => (
            <Text
              key={h}
              style={{
                flex: i === 0 ? 1.7 : 1,
                color: i === 1 ? STEAL_ACCENT : colors.mutedForeground,
                fontFamily: FONT.bold,
                fontSize: 10,
                textAlign: i === 0 ? "left" : "right",
              }}
            >
              {h}
            </Text>
          ))}
        </View>

        {query.isLoading ? (
          <RadarScan />
        ) : query.isError ? (
          <View style={{ paddingVertical: 50, alignItems: "center", gap: 12 }}>
            <Feather name="wifi-off" size={28} color={colors.mutedForeground} />
            <Text style={{ color: colors.foreground, fontFamily: FONT.semibold, fontSize: 15 }}>
              Couldn't reach the odds feed
            </Text>
            <Pressable
              onPress={() => query.refetch()}
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
        ) : filteredSteals.length === 0 ? (
          <RadarScan />
        ) : (
          <>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Feather name="zap" size={13} color={STEAL_ACCENT} />
              <Text style={{ color: STEAL_ACCENT, fontFamily: FONT.bold, fontSize: 12, letterSpacing: 0.5 }}>
                LIVE STEALS · {steals.length}
              </Text>
            </View>
            {filteredSteals.map((s) => (
              <StealCard key={s.id} steal={s} />
            ))}
          </>
        )}
        <View
          style={{
            flexDirection: "row",
            gap: 12,
            alignItems: "center",
            borderRadius: 12,
            borderWidth: 1,
            borderColor: STEAL_ACCENT,
            backgroundColor: "rgba(168,85,247,0.08)",
            padding: 14,
          }}
        >
          <Feather name="zap" size={22} color={STEAL_ACCENT} />
          <Text style={{ flex: 1, color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 13, lineHeight: 18 }}>
            We&apos;re scanning thousands of markets in real time to surface the best longshot opportunities.
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

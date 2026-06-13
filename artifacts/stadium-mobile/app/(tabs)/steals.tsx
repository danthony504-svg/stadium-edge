import { Feather } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import React from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { FONT } from "@/components/ui";
import { useColors } from "@/hooks/useColors";
import { getLiveSteals, propMarketLabel, type LiveSteal, type StealRecord } from "@/lib/api";
import { sportLabel } from "@/lib/sports";
import {
  americanToDecimal,
  formatOdds,
  formatPct,
  recordLabel,
  recordWinPct,
} from "@/lib/steals";

const STEAL_ACCENT = "#a855f7"; // violet — longshot upside, distinct from the app's cyan/green/amber

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
        borderColor: colors.border,
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

      <Text style={{ color: colors.mutedForeground, fontFamily: FONT.body, fontSize: 11, lineHeight: 16 }}>
        These are the app's own flagged longshots, graded against real game results — not your
        personal bets.
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

  const query = useQuery({
    queryKey: ["live-steals"],
    queryFn: ({ signal }) => getLiveSteals(signal),
    staleTime: 3 * 60 * 1000,
  });

  const steals = query.data?.steals ?? [];
  const record: StealRecord =
    query.data?.record ?? { wins: 0, losses: 0, pushes: 0, pending: 0, ungraded: 0, graded: 0 };

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
          <RefreshControl
            refreshing={query.isFetching && !query.isLoading}
            onRefresh={() => query.refetch()}
            tintColor={colors.primary}
          />
        }
      >
        <View>
          <Text style={{ color: colors.foreground, fontFamily: FONT.bold, fontSize: 26 }}>
            +500 Steals
          </Text>
          <Text style={{ color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 13, marginTop: 4 }}>
            Longshots (+500 and up) that carry a real cross-book edge — high risk, high upside.
          </Text>
        </View>

        <RecordCard record={record} />

        {query.isLoading ? (
          <View style={{ paddingVertical: 60, alignItems: "center", gap: 12 }}>
            <ActivityIndicator color={colors.primary} />
            <Text style={{ color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 13 }}>
              Hunting for steals…
            </Text>
          </View>
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
        ) : steals.length === 0 ? (
          <View style={{ paddingVertical: 50, alignItems: "center", gap: 12, paddingHorizontal: 20 }}>
            <Feather name="search" size={28} color={colors.mutedForeground} />
            <Text style={{ color: colors.foreground, fontFamily: FONT.semibold, fontSize: 15, textAlign: "center" }}>
              No steals on the board right now
            </Text>
            <Text style={{ color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 13, textAlign: "center", lineHeight: 19 }}>
              A steal needs a real edge at long odds — those are rare and vanish fast. Pull to
              refresh to scan the live board again.
            </Text>
          </View>
        ) : (
          <>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Feather name="zap" size={13} color={STEAL_ACCENT} />
              <Text style={{ color: STEAL_ACCENT, fontFamily: FONT.bold, fontSize: 12, letterSpacing: 0.5 }}>
                LIVE STEALS · {steals.length}
              </Text>
            </View>
            {steals.map((s) => (
              <StealCard key={s.id} steal={s} />
            ))}
          </>
        )}
      </ScrollView>
    </View>
  );
}

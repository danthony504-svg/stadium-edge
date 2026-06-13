import { Feather } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import React from "react";
import { Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Badge, Card, FONT, Loading, ErrorState, EmptyState } from "@/components/ui";
import { useSlipClearance } from "@/components/SlipBar";
import { SportPills } from "@/components/SportPills";
import { useBetSlip } from "@/context/BetSlipContext";
import { useColors } from "@/hooks/useColors";
import { getGolf, type GolfPlayer, type GolfTournament } from "@/lib/api";

// Golf outright-winner board. Every golfer's price is REAL bookmaker data from
// the api-server /sports/golf endpoint (best line-shopped price + no-vig
// consensus). Adding a golfer creates a slip leg in the exact same shape the
// grader settles ("<Golfer> to win" / "Tournament Winner" / sport "golf").

const SLIP_MARKET = "Tournament Winner";

function formatOdds(american: number): string {
  return american > 0 ? `+${american}` : `${american}`;
}

function formatTeeOff(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  return new Date(t).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function pickString(name: string): string {
  return `${name} to win`;
}

function PlayerRow({
  player,
  rank,
  tournamentTitle,
}: {
  player: GolfPlayer;
  rank: number;
  tournamentTitle: string;
}) {
  const colors = useColors();
  const { addLeg, removeLeg, hasLeg } = useBetSlip();
  const pick = pickString(player.name);
  const inSlip = hasLeg(tournamentTitle, SLIP_MARKET, pick);

  const toggle = () => {
    if (inSlip) {
      // legKey is game|market|pick lowercased (BetSlipContext).
      removeLeg(`${tournamentTitle}|${SLIP_MARKET}|${pick}`.toLowerCase());
    } else {
      addLeg({
        game: tournamentTitle,
        market: SLIP_MARKET,
        pick,
        odds: player.price,
        sport: "golf",
        edge: player.edgePct != null ? `${player.edgePct > 0 ? "+" : ""}${player.edgePct}% edge` : undefined,
      });
    }
  };

  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        paddingVertical: 10,
        borderTopWidth: rank === 0 ? 0 : 1,
        borderTopColor: colors.border,
      }}
    >
      <Text
        style={{
          width: 22,
          textAlign: "center",
          color: colors.mutedForeground,
          fontFamily: FONT.bold,
          fontSize: 13,
        }}
      >
        {rank + 1}
      </Text>

      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <Text style={{ color: colors.foreground, fontFamily: FONT.semibold, fontSize: 15 }}>
            {player.name}
          </Text>
          {player.value ? <Badge label="VALUE" tone="success" /> : null}
        </View>
        <Text style={{ color: colors.mutedForeground, fontFamily: FONT.body, fontSize: 12, marginTop: 2 }}>
          {(player.fairProb * 100).toFixed(1)}% model win
          {player.edgePct != null ? `  ·  ${player.edgePct > 0 ? "+" : ""}${player.edgePct}% edge` : ""}
        </Text>
        {player.books.length > 0 ? (
          // Line shopping — the price at every book, best first (highlighted).
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 6 }}>
            {player.books.map((b, bi) => (
              <View
                key={b.book}
                style={{
                  paddingHorizontal: 6,
                  paddingVertical: 2,
                  borderRadius: 6,
                  borderWidth: 1,
                  borderColor: bi === 0 ? colors.primary : colors.border,
                  backgroundColor: bi === 0 ? colors.surface : "transparent",
                }}
              >
                <Text
                  style={{
                    color: bi === 0 ? colors.primary : colors.mutedForeground,
                    fontFamily: bi === 0 ? FONT.semibold : FONT.body,
                    fontSize: 10,
                  }}
                >
                  {b.book} {formatOdds(b.price)}
                </Text>
              </View>
            ))}
          </View>
        ) : null}
      </View>

      <Text style={{ color: colors.foreground, fontFamily: FONT.bold, fontSize: 15, minWidth: 64, textAlign: "right" }}>
        {formatOdds(player.price)}
      </Text>

      <Pressable
        onPress={toggle}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={inSlip ? `Remove ${player.name} from slip` : `Add ${player.name} to slip`}
        style={({ pressed }) => ({
          width: 36,
          height: 36,
          borderRadius: 10,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: inSlip ? colors.primary : colors.surface,
          borderWidth: 1,
          borderColor: inSlip ? colors.primary : colors.border,
          opacity: pressed ? 0.8 : 1,
        })}
      >
        <Feather
          name={inSlip ? "check" : "plus"}
          size={18}
          color={inSlip ? colors.primaryForeground : colors.foreground}
        />
      </Pressable>
    </View>
  );
}

function TournamentCard({ tournament }: { tournament: GolfTournament }) {
  const colors = useColors();
  const [expanded, setExpanded] = React.useState(false);
  const valueCount = tournament.field.filter((p) => p.value).length;
  const shown = expanded ? tournament.field : tournament.field.slice(0, 12);

  return (
    <Card style={{ marginBottom: 14 }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <View style={{ flex: 1 }}>
          <Text style={{ color: colors.foreground, fontFamily: FONT.display, fontSize: 18 }}>
            {tournament.title}
          </Text>
          <Text style={{ color: colors.mutedForeground, fontFamily: FONT.body, fontSize: 12, marginTop: 2 }}>
            Tees off {formatTeeOff(tournament.commenceTime)}  ·  {tournament.field.length} in field  ·  {tournament.bookCount} books
          </Text>
        </View>
        {valueCount > 0 ? <Badge label={`${valueCount} VALUE`} tone="success" /> : null}
      </View>

      <View style={{ marginTop: 6 }}>
        {shown.map((p, i) => (
          <PlayerRow key={p.name} player={p} rank={i} tournamentTitle={tournament.title} />
        ))}
      </View>

      {tournament.field.length > 12 ? (
        <Pressable
          onPress={() => setExpanded((v) => !v)}
          style={({ pressed }) => ({
            marginTop: 10,
            paddingVertical: 10,
            borderRadius: 12,
            alignItems: "center",
            backgroundColor: colors.surface,
            borderWidth: 1,
            borderColor: colors.border,
            opacity: pressed ? 0.85 : 1,
          })}
        >
          <Text style={{ color: colors.primary, fontFamily: FONT.semibold, fontSize: 13 }}>
            {expanded ? "Show fewer" : `Show all ${tournament.field.length}`}
          </Text>
        </Pressable>
      ) : null}
    </Card>
  );
}

export default function GolfScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const slipClearance = useSlipClearance();
  const { data, isLoading, isError, refetch, isRefetching } = useQuery({
    queryKey: ["golf"],
    queryFn: ({ signal }) => getGolf(signal),
    staleTime: 60_000,
  });

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView
        contentContainerStyle={{
          paddingTop: insets.top + 56,
          paddingBottom: insets.bottom + 24 + slipClearance,
        }}
        refreshControl={
          <RefreshControl refreshing={isRefetching} onRefresh={() => refetch()} tintColor={colors.primary} />
        }
      >
        {/* Same league pill row as the Props tab — Golf is active here, and the
            other pills navigate back to the Props board (Golf isn't a SPORTS
            member, so it lives on this dedicated screen rather than in-page). */}
        <SportPills
          activeId="golf"
          onSelectSport={(id) => router.navigate({ pathname: "/props", params: { sp: id } })}
          onSelectGolf={() => {}}
        />

        <View style={{ paddingHorizontal: 16 }}>
        <Text style={{ color: colors.foreground, fontFamily: FONT.display, fontSize: 26 }}>Golf</Text>
        <Text style={{ color: colors.mutedForeground, fontFamily: FONT.body, fontSize: 13, marginTop: 4, marginBottom: 16 }}>
          Outright winner odds for the majors — best price across books, ranked by a no-vig market model.
        </Text>

        {isLoading ? (
          <Loading label="Loading golf odds…" />
        ) : isError ? (
          <ErrorState onRetry={() => refetch()} />
        ) : !data || data.length === 0 ? (
          <EmptyState
            icon="flag"
            title="No tournaments on the board"
            subtitle="Outright markets open in the weeks before each major. Check back soon."
          />
        ) : (
          data.map((t) => <TournamentCard key={t.key} tournament={t} />)
        )}
        </View>
      </ScrollView>
    </View>
  );
}

import { Feather } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useMemo } from "react";
import { Image, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { type ParsedPick } from "@/components/PickCard";
import { SlipBar, useSlipClearance } from "@/components/SlipBar";
import { ErrorState, FONT, Loading } from "@/components/ui";
import { useBetSlip } from "@/context/BetSlipContext";
import { useColors } from "@/hooks/useColors";
import { getPlayerHistory } from "@/lib/api";
import { formatAmerican, formatGameTime } from "@/lib/format";
import { computeAmbiguous, gameValueForMarket } from "@/lib/propStats";
import { SPORTS } from "@/lib/sports";

// How many of the most-recent real games we read for the projection / hit-rate.
const WINDOW = 10;

function MatchupLine({ game }: { game: string }) {
  const colors = useColors();
  const parts = game.split(/\s+@\s+/);
  if (parts.length !== 2) {
    return (
      <Text style={{ color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 14 }}>
        {game}
      </Text>
    );
  }
  return (
    <Text style={{ fontFamily: FONT.semibold, fontSize: 14 }}>
      <Text style={{ color: colors.primary }}>{parts[0]}</Text>
      <Text style={{ color: colors.mutedForeground }}> @ </Text>
      <Text style={{ color: colors.destructive }}>{parts[1]}</Text>
    </Text>
  );
}

export default function PropDetailScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const slipClearance = useSlipClearance();
  const router = useRouter();
  const { addLeg, removeLeg, hasLeg } = useBetSlip();

  const p = useLocalSearchParams<{
    player?: string;
    marketKey?: string;
    marketLabel?: string;
    line?: string;
    side?: string;
    odds?: string;
    game?: string;
    sport?: string;
    athleteId?: string;
    headshot?: string;
    startsAt?: string;
    pick?: string;
  }>();

  const player = String(p.player ?? "");
  const marketKey = String(p.marketKey ?? "");
  const marketLabel = String(p.marketLabel ?? "Prop");
  const sport = String(p.sport ?? "");
  const athleteId = p.athleteId ? String(p.athleteId) : "";
  const headshot = p.headshot ? String(p.headshot) : "";
  const game = String(p.game ?? "");
  const startsAt = p.startsAt ? String(p.startsAt) : "";
  const odds = Number(p.odds);
  const line = p.line != null && p.line !== "" ? Number(p.line) : null;
  const side = String(p.side ?? "Over");
  const pickStr = String(p.pick ?? "");
  const isUnder = side.toLowerCase() === "under";
  // The threshold a game "hits" against. Yes/no markets (no line) clear at 1.
  const threshold = line != null ? line : 0.5;

  const sportLabel = SPORTS.find((s) => s.id === sport)?.label ?? sport.toUpperCase();
  const isSoccer = sport === "soccer";
  const enabled = !!sport && (!!athleteId || (isSoccer && !!player));

  const historyQ = useQuery({
    queryKey: ["player-history", sport, athleteId, isSoccer ? player : null],
    enabled,
    staleTime: 10 * 60_000,
    queryFn: ({ signal }) =>
      getPlayerHistory(
        { sport, athleteId: athleteId || null, name: isSoccer ? player : null },
        signal,
      ),
  });

  const ambiguous = useMemo(
    () => computeAmbiguous(historyQ.data?.labels),
    [historyQ.data],
  );

  // Real per-game values for THIS market, newest first, capped at WINDOW. Every
  // value is read from the player's actual recorded stat line; games where the
  // feed can't supply the stat are dropped, never guessed.
  const games = useMemo(() => {
    const rows = historyQ.data?.recent ?? [];
    return rows
      .map((g) => ({
        value: gameValueForMarket(marketKey, g.stats, ambiguous),
        date: g.date,
        opp: g.opponentName,
        isHome: g.isHome,
      }))
      .filter((r): r is { value: number; date: string | null; opp: string | null; isHome: boolean | null } =>
        r.value != null,
      )
      .slice(0, WINDOW);
  }, [historyQ.data, marketKey, ambiguous]);

  const n = games.length;
  const projection = useMemo(() => {
    if (n === 0) return null;
    const s = games.reduce((a, b) => a + b.value, 0);
    return Math.round((s / n) * 10) / 10;
  }, [games, n]);

  const hitGame = (v: number) => (isUnder ? v < threshold : v >= threshold);
  const hits = useMemo(() => games.filter((g) => hitGame(g.value)).length, [games, isUnder, threshold]);
  const hitPct = n > 0 ? Math.round((hits / n) * 100) : null;

  const chartMax = useMemo(() => {
    const vals = games.map((g) => g.value);
    const m = Math.max(threshold, ...(vals.length ? vals : [0]));
    return m > 0 ? m * 1.1 : 1;
  }, [games, threshold]);

  const lineLabel =
    line != null ? `${side} ${line}` : side === "Over" ? "Yes" : side;

  const added = hasLeg(game, marketLabel, pickStr);
  const onToggle = () => {
    if (added) {
      removeLeg(`${game}|${marketLabel}|${pickStr}`.toLowerCase());
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      return;
    }
    const leg: ParsedPick = {
      game,
      market: marketLabel,
      pick: pickStr,
      odds,
      sport,
      isProp: true,
      startsAt: startsAt || null,
      headshot: headshot || null,
    };
    const ok = addLeg(leg);
    Haptics.impactAsync(
      ok ? Haptics.ImpactFeedbackStyle.Medium : Haptics.ImpactFeedbackStyle.Light,
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      {/* Header */}
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
        <Text
          style={{ color: colors.foreground, fontFamily: FONT.semibold, fontSize: 16, flex: 1 }}
          numberOfLines={1}
        >
          {player || "Prop"}
        </Text>
      </View>

      <ScrollView
        contentContainerStyle={{
          padding: 16,
          paddingBottom: insets.bottom + 40 + slipClearance,
          gap: 14,
        }}
      >
        {/* Title block */}
        <View
          style={{
            backgroundColor: colors.surface,
            borderColor: colors.border,
            borderWidth: 1,
            borderRadius: colors.radius,
            padding: 16,
            gap: 10,
          }}
        >
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <View
              style={{
                paddingVertical: 4,
                paddingHorizontal: 10,
                borderRadius: 999,
                borderWidth: 1,
                borderColor: colors.border,
                backgroundColor: colors.card,
              }}
            >
              <Text
                style={{
                  color: colors.mutedForeground,
                  fontFamily: FONT.bold,
                  fontSize: 10,
                  letterSpacing: 0.6,
                }}
              >
                SINGLE PROP
              </Text>
            </View>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
              <Feather name="check-circle" size={12} color={colors.success} />
              <Text style={{ color: colors.success, fontFamily: FONT.bold, fontSize: 10, letterSpacing: 0.6 }}>
                REAL STATS
              </Text>
            </View>
          </View>

          <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
            {headshot ? (
              <Image
                source={{ uri: headshot }}
                style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: colors.card }}
              />
            ) : null}
            <View style={{ flex: 1, gap: 3 }}>
              <Text style={{ color: colors.foreground, fontFamily: FONT.display, fontSize: 22, lineHeight: 26 }}>
                {player}
              </Text>
              <Text style={{ color: colors.foreground, fontFamily: FONT.bold, fontSize: 16 }}>
                {lineLabel} {marketLabel}
              </Text>
            </View>
            <Text style={{ color: colors.accent, fontFamily: FONT.bold, fontSize: 24 }}>
              {formatAmerican(odds)}
            </Text>
          </View>

          <MatchupLine game={game} />
          {formatGameTime(startsAt) ? (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
              <Feather name="clock" size={12} color={colors.mutedForeground} />
              <Text style={{ color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 12 }}>
                {formatGameTime(startsAt)} · {sportLabel}
              </Text>
            </View>
          ) : null}
        </View>

        {!enabled ? (
          <EmptyNote
            text={`No game log feed is available for ${player || "this player"} in ${sportLabel}, so we can't show real numbers here. The line and price above are live.`}
          />
        ) : historyQ.isLoading ? (
          <Loading label="Loading real game log…" />
        ) : historyQ.isError ? (
          <ErrorState onRetry={() => historyQ.refetch()} />
        ) : n === 0 ? (
          <EmptyNote
            text={`We pulled ${player}'s game log but it doesn't carry a real ${marketLabel.toLowerCase()} column, so we're not estimating one. The posted line and price above are live.`}
          />
        ) : (
          <>
            {/* Real metric tiles */}
            <View style={{ flexDirection: "row", gap: 10 }}>
              <MetricTile
                icon="trending-up"
                label="PROJECTION"
                value={projection != null ? projection.toFixed(1) : "—"}
                caption={`Last ${n} avg`}
                tint={colors.foreground}
              />
              <MetricTile
                icon="target"
                label="HIT RATE"
                value={hitPct != null ? `${hitPct}%` : "—"}
                caption={lineLabel}
                tint={hitPct != null && hitPct >= 60 ? colors.success : colors.primary}
              />
              <MetricTile
                icon="layers"
                label="SAMPLE"
                value={String(n)}
                caption="real games"
                tint={colors.foreground}
              />
            </View>

            {/* The numbers — real columns only */}
            <Section title="THE NUMBERS">
              <View style={{ gap: 0 }}>
                <BreakdownRow
                  icon="bar-chart-2"
                  label="Recent-Avg Projection"
                  sub={`Mean ${marketLabel.toLowerCase()}, last ${n} games`}
                  value={projection != null ? projection.toFixed(1) : "—"}
                />
                <BreakdownRow
                  icon="book-open"
                  label="Sportsbook Line"
                  sub={lineLabel}
                  value={line != null ? String(line) : "—"}
                />
                <BreakdownRow
                  icon="activity"
                  label="Recent Form"
                  sub={`${lineLabel} · last ${n} games`}
                  value={`${hits}/${n}`}
                  last
                />
              </View>
            </Section>

            {/* Recent games — real per-game values against the line */}
            <Section title={`RECENT GAMES · ${hitPct ?? 0}% HIT ${lineLabel.toUpperCase()}`}>
              <View style={{ gap: 8 }}>
                {games.map((g, i) => {
                  const hit = hitGame(g.value);
                  const w = `${Math.max(6, Math.round((g.value / chartMax) * 100))}%`;
                  return (
                    <View key={i} style={{ gap: 3 }}>
                      <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                        <Text style={{ color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 11 }}>
                          {(g.isHome === false ? "@ " : g.isHome === true ? "vs " : "") + (g.opp ?? "—")}
                          {g.date ? ` · ${g.date}` : ""}
                        </Text>
                        <Text
                          style={{
                            color: hit ? colors.success : colors.mutedForeground,
                            fontFamily: FONT.bold,
                            fontSize: 12,
                          }}
                        >
                          {g.value}
                        </Text>
                      </View>
                      <View
                        style={{
                          height: 7,
                          borderRadius: 4,
                          backgroundColor: colors.card,
                          overflow: "hidden",
                        }}
                      >
                        <View
                          style={{
                            width: w as `${number}%`,
                            height: "100%",
                            borderRadius: 4,
                            backgroundColor: hit ? colors.success : colors.border,
                          }}
                        />
                      </View>
                    </View>
                  );
                })}
                {line != null ? (
                  <Text style={{ color: colors.mutedForeground, fontFamily: FONT.body, fontSize: 11, marginTop: 2 }}>
                    Bars are real per-game {marketLabel.toLowerCase()}. Green = the game cleared {lineLabel}.
                  </Text>
                ) : null}
              </View>
            </Section>
          </>
        )}

        {/* Add to slip */}
        <Pressable
          onPress={onToggle}
          style={({ pressed }) => ({
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "center",
            gap: 7,
            paddingVertical: 14,
            borderRadius: 12,
            backgroundColor: added ? colors.card : colors.primary,
            borderWidth: added ? 1 : 0,
            borderColor: colors.border,
            opacity: pressed ? 0.9 : 1,
          })}
        >
          <Feather
            name={added ? "x" : "plus"}
            size={17}
            color={added ? colors.mutedForeground : colors.primaryForeground}
          />
          <Text
            style={{
              color: added ? colors.mutedForeground : colors.primaryForeground,
              fontFamily: FONT.bold,
              fontSize: 14,
            }}
          >
            {added ? "Added — tap to remove" : "Add to slip"}
          </Text>
        </Pressable>
      </ScrollView>

      <SlipBar />
    </View>
  );
}

function MetricTile({
  icon,
  label,
  value,
  caption,
  tint,
}: {
  icon: keyof typeof Feather.glyphMap;
  label: string;
  value: string;
  caption: string;
  tint: string;
}) {
  const colors = useColors();
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: colors.surface,
        borderColor: colors.border,
        borderWidth: 1,
        borderRadius: colors.radius,
        padding: 12,
        gap: 5,
        alignItems: "center",
      }}
    >
      <Feather name={icon} size={14} color={colors.mutedForeground} />
      <Text style={{ color: colors.mutedForeground, fontFamily: FONT.bold, fontSize: 9, letterSpacing: 0.5 }}>
        {label}
      </Text>
      <Text style={{ color: tint, fontFamily: FONT.display, fontSize: 22 }}>{value}</Text>
      <Text style={{ color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 10 }} numberOfLines={1}>
        {caption}
      </Text>
    </View>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const colors = useColors();
  return (
    <View
      style={{
        backgroundColor: colors.surface,
        borderColor: colors.border,
        borderWidth: 1,
        borderRadius: colors.radius,
        padding: 14,
        gap: 10,
      }}
    >
      <Text
        style={{
          color: colors.mutedForeground,
          fontFamily: FONT.bold,
          fontSize: 11,
          letterSpacing: 0.8,
        }}
      >
        {title}
      </Text>
      {children}
    </View>
  );
}

function BreakdownRow({
  icon,
  label,
  sub,
  value,
  last,
}: {
  icon: keyof typeof Feather.glyphMap;
  label: string;
  sub: string;
  value: string;
  last?: boolean;
}) {
  const colors = useColors();
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        paddingVertical: 10,
        borderBottomWidth: last ? 0 : 1,
        borderBottomColor: colors.border,
      }}
    >
      <Feather name={icon} size={16} color={colors.primary} />
      <View style={{ flex: 1 }}>
        <Text style={{ color: colors.foreground, fontFamily: FONT.bold, fontSize: 13 }}>{label}</Text>
        <Text style={{ color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 11 }}>{sub}</Text>
      </View>
      <Text style={{ color: colors.foreground, fontFamily: FONT.display, fontSize: 18 }}>{value}</Text>
    </View>
  );
}

function EmptyNote({ text }: { text: string }) {
  const colors = useColors();
  return (
    <View
      style={{
        backgroundColor: colors.surface,
        borderColor: colors.border,
        borderWidth: 1,
        borderRadius: colors.radius,
        padding: 16,
        flexDirection: "row",
        gap: 10,
        alignItems: "flex-start",
      }}
    >
      <Feather name="info" size={16} color={colors.mutedForeground} />
      <Text style={{ color: colors.mutedForeground, fontFamily: FONT.body, fontSize: 13, lineHeight: 19, flex: 1 }}>
        {text}
      </Text>
    </View>
  );
}

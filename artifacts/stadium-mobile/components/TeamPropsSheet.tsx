import { Feather } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import { useMemo } from "react";
import { Image, Modal, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { SlipBar, useSlipClearance } from "@/components/SlipBar";
import { FONT } from "@/components/ui";
import { useBetSlip } from "@/context/BetSlipContext";
import { useColors } from "@/hooks/useColors";
import {
  buildRealOdds,
  getOdds,
  getTeamDefense,
  getTeamHistory,
  searchTeam,
  type RealOddsEntry,
  type TeamForm,
} from "@/lib/api";
import { teamNameMatches } from "@/lib/injuries";
import { formatAmerican, formatGameTime } from "@/lib/format";
import { SPORTS } from "@/lib/sports";

// One tappable team, opened from the Props-tab search. We carry only the team
// names + game context; everything shown is fetched fresh from REAL feeds.
export type TeamSheetData = {
  team: string;
  opp: string;
  isHome: boolean;
  sport: string;
  gameLabel: string;
  startsAt: string;
};

const nickname = (full: string) => (full || "").split(/\s+/).filter(Boolean).pop() || full;
const fmt1 = (v: number | null | undefined) =>
  v == null ? "—" : `${v > 0 ? "+" : ""}${Number(v).toFixed(1)}`;
const rec = (f: TeamForm | null | undefined) =>
  f && f.games ? `${f.wins}-${f.losses}` : "—";

export function TeamPropsSheet({
  data,
  onClose,
}: {
  data: TeamSheetData | null;
  onClose: () => void;
}) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const slipClearance = useSlipClearance();
  const { addLeg, removeLeg, hasLeg } = useBetSlip();

  const sport = data?.sport ?? "";
  const team = data?.team ?? "";
  const opp = data?.opp ?? "";
  const sportLabel = data ? SPORTS.find((s) => s.id === sport)?.label ?? sport.toUpperCase() : "";

  // Resolve the team to an ESPN id (the search gives us only a name), then pull
  // its real history. Two-step so the sheet works straight from the props feed.
  const resolveQ = useQuery({
    queryKey: ["team-resolve", sport, team],
    enabled: !!sport && !!team,
    staleTime: 30 * 60_000,
    queryFn: async ({ signal }) => {
      // Fail-closed: only accept a same-sport result whose name actually
      // matches. No fallback to "first hit" — a wrong team would surface real
      // stats for the wrong entity (a fabrication). Null → "unavailable".
      const r = await searchTeam(team, signal);
      const sportHits = r.results.filter((t) => (t.sport ?? "") === sport);
      return sportHits.find((t) => teamNameMatches(t.name, team)) ?? null;
    },
  });
  const resolved = resolveQ.data ?? null;

  const historyQ = useQuery({
    queryKey: ["team-history", sport, resolved?.teamId],
    enabled: !!sport && !!resolved?.teamId,
    staleTime: 10 * 60_000,
    queryFn: ({ signal }) => getTeamHistory(sport, resolved!.teamId, signal),
  });
  const history = historyQ.data ?? null;

  // Real recent margins (final scores only), newest first, capped at 10.
  const games = useMemo(() => {
    const rows = history?.recent ?? [];
    return rows
      .filter((g) => g.pts != null && g.oppPts != null)
      .slice(0, 10)
      .map((g) => ({
        margin: (g.pts as number) - (g.oppPts as number),
        date: g.date,
        opp: g.opp,
        home: g.home,
        won: g.won,
      }));
  }, [history]);
  const n = games.length;
  const chartScale = useMemo(
    () => Math.max(1, ...games.map((g) => Math.abs(g.margin))),
    [games],
  );

  const split = data?.isHome ? history?.homeSplit : history?.awaySplit;

  // Real posted markets for THIS team's game. We match the odds feed game by
  // BOTH nicknames (order-independent), then read the team's own moneyline +
  // spread and the game total straight from buildRealOdds so the pick strings
  // match the Coach/slip format exactly (clean dedupe). Never priced if absent.
  const oddsQ = useQuery({
    queryKey: ["odds", sport],
    enabled: !!sport && !!data,
    staleTime: 60_000,
    queryFn: ({ signal }) => getOdds(sport, signal),
  });
  const markets = useMemo(() => {
    if (!data || !oddsQ.data) return null;
    // Require BOTH full names to match (order-independent) — nickname-only sets
    // can misbind in leagues with duplicate nicknames. The paired match also
    // disambiguates which side is "our" team regardless of feed orientation.
    const g = oddsQ.data.find(
      (o) =>
        (teamNameMatches(o.homeTeam, team) && teamNameMatches(o.awayTeam, opp)) ||
        (teamNameMatches(o.homeTeam, opp) && teamNameMatches(o.awayTeam, team)),
    );
    if (!g) return null;
    const teamNick = teamNameMatches(g.homeTeam, team)
      ? nickname(g.homeTeam)
      : nickname(g.awayTeam);
    const real = buildRealOdds(g);
    const ml = real.find(
      (e) => e.market === "Moneyline" && e.pick.startsWith(`${teamNick} `),
    );
    const spread = real.find(
      (e) => e.market === "Spread" && e.pick.startsWith(`${teamNick} `),
    );
    const totals = real.filter((e) => e.market === "Total");
    const rows: RealOddsEntry[] = [];
    if (ml) rows.push(ml);
    if (spread) rows.push(spread);
    rows.push(...totals);
    return rows.length ? { game: g, rows } : null;
  }, [data, oddsQ.data, team, opp]);

  // Opponent's REAL season points-allowed (fail closed: same-sport name match).
  const oppDefenseQ = useQuery({
    queryKey: ["opp-defense", sport, opp],
    enabled: !!sport && !!opp,
    staleTime: 30 * 60_000,
    queryFn: async ({ signal }) => {
      const r = await searchTeam(opp, signal);
      const sportHits = r.results.filter((t) => (t.sport ?? "") === sport);
      const hit = sportHits.find((t) => teamNameMatches(t.name, opp)) ?? null;
      if (!hit) return null;
      return getTeamDefense(sport, hit.teamId, signal);
    },
  });
  const oppDefense = oppDefenseQ.data ?? null;

  const addMarket = (e: RealOddsEntry) => {
    const game = e.game;
    if (hasLeg(game, e.market, e.pick)) {
      removeLeg(`${game}|${e.market}|${e.pick}`.toLowerCase());
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      return;
    }
    const ok = addLeg({
      game,
      market: e.market,
      pick: e.pick,
      odds: e.odds,
      sport,
    });
    Haptics.impactAsync(ok ? Haptics.ImpactFeedbackStyle.Medium : Haptics.ImpactFeedbackStyle.Light);
  };

  if (!data) return null;

  const loading = resolveQ.isLoading || historyQ.isLoading;
  const errored = resolveQ.isError || historyQ.isError;
  const noData = !loading && !errored && (!resolved || n === 0);

  return (
    <Modal visible animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        {/* Header */}
        <View
          style={{
            paddingTop: insets.top + 8,
            paddingBottom: 12,
            paddingHorizontal: 16,
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            borderBottomWidth: 1,
            borderBottomColor: colors.border,
          }}
        >
          <Text style={{ color: colors.foreground, fontFamily: FONT.display, fontSize: 20 }}>
            Team Props
          </Text>
          <Pressable onPress={onClose} hitSlop={10}>
            <Text style={{ color: colors.primary, fontFamily: FONT.bold, fontSize: 15 }}>Close</Text>
          </Pressable>
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
                <Text style={{ color: colors.mutedForeground, fontFamily: FONT.bold, fontSize: 10, letterSpacing: 0.6 }}>
                  TEAM
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
              {resolved?.logo ? (
                <Image source={{ uri: resolved.logo }} style={{ width: 48, height: 48 }} resizeMode="contain" />
              ) : null}
              <View style={{ flex: 1, gap: 3 }}>
                <Text style={{ color: colors.foreground, fontFamily: FONT.display, fontSize: 22, lineHeight: 26 }}>
                  {resolved?.name ?? team}
                </Text>
                <Text style={{ color: colors.mutedForeground, fontFamily: FONT.bold, fontSize: 13 }}>
                  {data.isHome ? "Home" : "Away"} vs {nickname(opp)} · {sportLabel}
                </Text>
              </View>
            </View>

            {formatGameTime(data.startsAt) ? (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
                <Feather name="clock" size={12} color={colors.mutedForeground} />
                <Text style={{ color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 12 }}>
                  {formatGameTime(data.startsAt)}
                </Text>
              </View>
            ) : null}
          </View>

          {loading ? (
            <Loading />
          ) : errored ? (
            <EmptyNote text={`We couldn't reach the real results feed for ${team} right now. Posted markets below are still live.`} />
          ) : noData ? (
            <EmptyNote text={`We couldn't pull real recent results for ${team} in ${sportLabel} right now, so we're not estimating any numbers.`} />
          ) : (
            <>
              {/* Real metric tiles */}
              <View style={{ flexDirection: "row", gap: 10 }}>
                <MetricTile
                  icon="award"
                  label="RECORD"
                  value={history?.record.games ? `${history.record.wins}-${history.record.losses}` : "—"}
                  caption={history?.record.games ? `last ${history.record.games}` : "season"}
                  tint={colors.foreground}
                />
                <MetricTile
                  icon="trending-up"
                  label="LAST 10"
                  value={rec(history?.last10)}
                  caption="recent form"
                  tint={colors.foreground}
                />
                <MetricTile
                  icon="zap"
                  label="STREAK"
                  value={history?.streak ? `${history.streak.type}${history.streak.count}` : "—"}
                  caption="current"
                  tint={
                    history?.streak?.type === "W"
                      ? colors.success
                      : history?.streak?.type === "L"
                        ? colors.destructive
                        : colors.foreground
                  }
                />
              </View>

              {/* The numbers — real, derived from final scores only */}
              <Section title="THE NUMBERS · LAST 10">
                <View style={{ gap: 0 }}>
                  <BreakdownRow
                    icon="activity"
                    label="Scoring margin"
                    sub="Avg points minus opponent"
                    value={fmt1(history?.last10.avgMargin)}
                  />
                  <BreakdownRow
                    icon="arrow-up-circle"
                    label="Points per game"
                    sub="Scored · allowed"
                    value={`${history?.last10.ptsFor?.toFixed(1) ?? "—"} · ${history?.last10.ptsAgainst?.toFixed(1) ?? "—"}`}
                  />
                  <BreakdownRow
                    icon="home"
                    label={data.isHome ? "Home form" : "Away form"}
                    sub={data.isHome ? "Record at home" : "Record on the road"}
                    value={rec(split)}
                    last
                  />
                </View>
              </Section>

              {/* Recent games — real per-game margins */}
              <Section title="RECENT GAMES · MARGIN">
                <View style={{ gap: 8 }}>
                  {games.map((g, i) => {
                    const won = g.margin > 0;
                    const w = `${Math.max(6, Math.round((Math.abs(g.margin) / chartScale) * 100))}%`;
                    return (
                      <View key={i} style={{ gap: 3 }}>
                        <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                          <Text style={{ color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 11 }}>
                            {(g.home ? "vs " : "@ ") + (g.opp ?? "—")}
                            {g.date ? ` · ${g.date}` : ""}
                          </Text>
                          <Text
                            style={{
                              color: won ? colors.success : colors.mutedForeground,
                              fontFamily: FONT.bold,
                              fontSize: 12,
                            }}
                          >
                            {g.margin > 0 ? `+${g.margin}` : g.margin}
                          </Text>
                        </View>
                        <View style={{ height: 7, borderRadius: 4, backgroundColor: colors.card, overflow: "hidden" }}>
                          <View
                            style={{
                              width: w as `${number}%`,
                              height: "100%",
                              borderRadius: 4,
                              backgroundColor: won ? colors.success : colors.border,
                            }}
                          />
                        </View>
                      </View>
                    );
                  })}
                  <Text style={{ color: colors.mutedForeground, fontFamily: FONT.body, fontSize: 11, marginTop: 2 }}>
                    Bars are real scoring margins. Green = a win — vs varied opponents, not this game's line.
                  </Text>
                </View>
              </Section>
            </>
          )}

          {/* Posted markets — REAL prices straight from the odds feed */}
          {markets ? (
            <Section title="POSTED MARKETS">
              <View style={{ gap: 8 }}>
                {markets.rows.map((e, i) => {
                  const added = hasLeg(e.game, e.market, e.pick);
                  return (
                    <Pressable
                      key={`${e.market}-${e.pick}-${i}`}
                      onPress={() => addMarket(e)}
                      style={({ pressed }) => ({
                        flexDirection: "row",
                        alignItems: "center",
                        gap: 10,
                        backgroundColor: colors.card,
                        borderColor: added ? colors.primary : colors.border,
                        borderWidth: 1,
                        borderRadius: colors.radius,
                        padding: 12,
                        opacity: pressed ? 0.8 : 1,
                      })}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: colors.foreground, fontFamily: FONT.bold, fontSize: 14 }}>
                          {e.pick}
                        </Text>
                        <Text style={{ color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 11, marginTop: 1 }}>
                          {e.market}
                        </Text>
                      </View>
                      <View
                        style={{
                          flexDirection: "row",
                          alignItems: "center",
                          gap: 6,
                          borderRadius: 10,
                          paddingVertical: 8,
                          paddingHorizontal: 12,
                          backgroundColor: added ? colors.surface : colors.primary,
                          borderWidth: added ? 1 : 0,
                          borderColor: colors.primary,
                        }}
                      >
                        <Feather
                          name={added ? "check" : "plus"}
                          size={14}
                          color={added ? colors.primary : colors.primaryForeground}
                        />
                        <Text
                          style={{
                            color: added ? colors.primary : colors.primaryForeground,
                            fontFamily: FONT.bold,
                            fontSize: 14,
                          }}
                        >
                          {formatAmerican(e.odds)}
                        </Text>
                      </View>
                    </Pressable>
                  );
                })}
                <Text style={{ color: colors.mutedForeground, fontFamily: FONT.body, fontSize: 11 }}>
                  Live posted prices — moneyline & spread for {nickname(team)}, plus the game total.
                </Text>
              </View>
            </Section>
          ) : oddsQ.isLoading ? null : (
            <EmptyNote text={`No posted team markets are live for this ${sportLabel} game right now.`} />
          )}

          {/* Opponent defense — REAL season points-allowed */}
          {oppDefense && oppDefense.avgPointsAgainst != null ? (
            <Section title="OPPONENT DEFENSE">
              <View style={{ gap: 0 }}>
                <BreakdownRow
                  icon="shield"
                  label={oppDefense.teamName ?? opp}
                  sub="Points allowed per game (season)"
                  value={oppDefense.avgPointsAgainst.toFixed(1)}
                  last={oppDefense.avgPointsFor == null}
                />
                {oppDefense.avgPointsFor != null ? (
                  <BreakdownRow
                    icon="zap"
                    label="Opponent offense"
                    sub="Points scored per game (season)"
                    value={oppDefense.avgPointsFor.toFixed(1)}
                    last
                  />
                ) : null}
              </View>
              <Text style={{ color: colors.mutedForeground, fontFamily: FONT.body, fontSize: 11 }}>
                Team-wide season rates — not position-specific.
              </Text>
            </Section>
          ) : null}
        </ScrollView>

        <SlipBar />
      </View>
    </Modal>
  );
}

function Loading() {
  const colors = useColors();
  return (
    <View style={{ padding: 24, alignItems: "center" }}>
      <Text style={{ color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 13 }}>
        Loading real team results…
      </Text>
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
      <Text style={{ color: colors.mutedForeground, fontFamily: FONT.bold, fontSize: 11, letterSpacing: 0.8 }}>
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

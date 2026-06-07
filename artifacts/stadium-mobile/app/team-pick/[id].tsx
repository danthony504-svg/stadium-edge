import { Feather } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { Image, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { type ParsedPick } from "@/components/PickCard";
import { SlipBar, useSlipClearance } from "@/components/SlipBar";
import { ErrorState, FONT, Loading } from "@/components/ui";
import { useBetSlip } from "@/context/BetSlipContext";
import { useColors } from "@/hooks/useColors";
import {
  getInjuries,
  getTeamDefense,
  getTeamHistory,
  searchTeam,
  type TeamForm,
} from "@/lib/api";
import {
  injuriesForMatchup,
  teamNameMatches,
  friendlyInjury,
  injuryImpact,
  summarizeTeamInjuries,
  injuryEdge,
  type InjuryImpactTier,
} from "@/lib/injuries";
import { formatAmerican, formatGameTime } from "@/lib/format";
import { SPORTS } from "@/lib/sports";

const fmt1 = (v: number | null | undefined) =>
  v == null ? "—" : `${v > 0 ? "+" : ""}${Number(v).toFixed(1)}`;
const rec = (f: TeamForm | null | undefined) =>
  f && f.games ? `${f.wins}-${f.losses}` : "—";

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

export default function TeamPickDetailScreen() {
  const colors = useColors();
  // Impact tier → colour / label for the injury rows (high red, med orange,
  // low amber, none green). Closes over theme colours.
  const impactColor = (tier: InjuryImpactTier): string =>
    tier === "high"
      ? colors.destructive
      : tier === "med"
        ? "#f97316"
        : tier === "low"
          ? colors.warning
          : colors.success;
  const impactLabel = (tier: InjuryImpactTier): string =>
    tier === "high"
      ? "High impact"
      : tier === "med"
        ? "Med impact"
        : tier === "low"
          ? "Low impact"
          : "Minimal";
  const insets = useSafeAreaInsets();
  const slipClearance = useSlipClearance();
  const router = useRouter();
  const { addLeg, removeLeg, hasLeg } = useBetSlip();

  const p = useLocalSearchParams<{
    team?: string;
    opp?: string;
    isHome?: string;
    sport?: string;
    market?: string;
    line?: string;
    odds?: string;
    game?: string;
    startsAt?: string;
    pick?: string;
  }>();

  const team = String(p.team ?? "");
  const opp = String(p.opp ?? "");
  const isHome = String(p.isHome ?? "") === "1";
  const sport = String(p.sport ?? "");
  const market = String(p.market ?? "Pick");
  const game = String(p.game ?? "");
  const startsAt = p.startsAt ? String(p.startsAt) : "";
  const odds = Number(p.odds);
  const line = p.line != null && p.line !== "" ? Number(p.line) : null;
  const pickStr = String(p.pick ?? "");

  const sportLabel = SPORTS.find((s) => s.id === sport)?.label ?? sport.toUpperCase();

  // Resolve the team to an ESPN id, then pull its real history. Two-step so the
  // page works from the odds feed (which carries names, not ESPN ids).
  const resolveQ = useQuery({
    queryKey: ["team-resolve", sport, team],
    enabled: !!sport && !!team,
    staleTime: 30 * 60_000,
    queryFn: async ({ signal }) => {
      const r = await searchTeam(team, signal);
      const hit =
        r.results.find((t) => (t.sport ?? "") === sport) ?? r.results[0] ?? null;
      return hit;
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

  // The picked team "beats the number" when its real scoring margin clears the
  // spread. For a -4.5 favourite that's margin > 4.5; for +3.5 it's margin > -3.5;
  // for a moneyline (no line) it's simply a win (margin > 0). These recent games
  // are vs VARIED opponents — this is NOT an ATS record vs this game's line.
  const coverThreshold = line != null ? -line : 0;
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
  const beats = useMemo(() => games.filter((g) => g.margin > coverThreshold).length, [games, coverThreshold]);
  const beatPct = n > 0 ? Math.round((beats / n) * 100) : null;

  const chartScale = useMemo(() => {
    const maxAbs = Math.max(1, ...games.map((g) => Math.abs(g.margin)), Math.abs(coverThreshold));
    return maxAbs;
  }, [games, coverThreshold]);

  const split = isHome ? history?.homeSplit : history?.awaySplit;
  // Sign-aware copy: a favourite (-line) must WIN by the number; an underdog
  // (+line) only needs to lose by fewer than the number (or win); a moneyline /
  // pick'em just needs to win. Never phrase an underdog cover as "won by X+".
  const isFav = line != null && line < 0;
  const isDog = line != null && line > 0;
  // Header fragment, e.g. "WON BY 4.5+ ", "COVERED +3.5 ", "WON OUTRIGHT ".
  const numberLabel = isFav
    ? `WON BY ${Math.abs(line)}+ `
    : isDog
    ? `COVERED +${line} `
    : "WON OUTRIGHT ";
  // Chart-footer fragment describing what a green bar means.
  const beatCaption = isFav
    ? `won by ${Math.abs(line)}+`
    : isDog
    ? `lost by fewer than ${line} (or won)`
    : "won outright";

  const added = hasLeg(game, market, pickStr);
  const onToggle = () => {
    if (added) {
      removeLeg(`${game}|${market}|${pickStr}`.toLowerCase());
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      return;
    }
    const leg: ParsedPick = {
      game,
      market,
      pick: pickStr,
      odds,
      sport,
      isProp: false,
      startsAt: startsAt || null,
      teamLogo: resolved?.logo ?? null,
    };
    const ok = addLeg(leg);
    Haptics.impactAsync(
      ok ? Haptics.ImpactFeedbackStyle.Medium : Haptics.ImpactFeedbackStyle.Light,
    );
  };

  const loading = resolveQ.isLoading || historyQ.isLoading;
  const errored = resolveQ.isError || historyQ.isError;
  const noData = !loading && !errored && (!resolved || n === 0);

  // Back nav that never throws "GO_BACK was not handled": when opened cold
  // (deep link / fresh stack) there's nothing to pop, so fall back to home.
  const goBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace("/");
  };

  // --- Real injury report + opponent defense (free ESPN feeds) ---

  const injuriesQ = useQuery({
    queryKey: ["injuries", sport],
    enabled: !!sport,
    staleTime: 10 * 60_000,
    queryFn: ({ signal }) => getInjuries(sport, signal),
  });
  const matchupInjuries = useMemo(
    () => injuriesForMatchup(injuriesQ.data, [team, opp]),
    [injuriesQ.data, team, opp],
  );
  // Per-team impact rollups + the derived injury edge (real counts, no WAR).
  const injurySummaries = useMemo(
    () => matchupInjuries.map((t) => summarizeTeamInjuries(sport, t)),
    [matchupInjuries, sport],
  );
  const injEdge = useMemo(() => injuryEdge(injurySummaries), [injurySummaries]);
  // Which teams' full injury lists are expanded ("View all N injuries →").
  const [injuryOpen, setInjuryOpen] = useState<Record<string, boolean>>({});

  // Opponent's REAL season points-allowed. `opp` is an explicit param here, so
  // we can resolve it directly (unlike the prop page, which shows both sides).
  const oppDefenseQ = useQuery({
    queryKey: ["opp-defense", sport, opp],
    enabled: !!sport && !!opp,
    staleTime: 30 * 60_000,
    queryFn: async ({ signal }) => {
      const r = await searchTeam(opp, signal);
      // Fail closed: require a same-sport hit whose name actually matches the
      // opponent — never fall back to an unrelated team's defensive stats.
      const sportHits = r.results.filter((t) => (t.sport ?? "") === sport);
      const hit = sportHits.find((t) => teamNameMatches(t.name, opp)) ?? null;
      if (!hit) return null;
      return getTeamDefense(sport, hit.teamId, signal);
    },
  });
  const oppDefense = oppDefenseQ.data ?? null;

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
        <Pressable onPress={goBack} hitSlop={10} style={{ padding: 6 }}>
          <Feather name="chevron-left" size={24} color={colors.foreground} />
        </Pressable>
        <Text
          style={{ color: colors.foreground, fontFamily: FONT.semibold, fontSize: 16, flex: 1 }}
          numberOfLines={1}
        >
          {team || "Team pick"}
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
              <Text style={{ color: colors.mutedForeground, fontFamily: FONT.bold, fontSize: 10, letterSpacing: 0.6 }}>
                TEAM PICK
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
              <Image
                source={{ uri: resolved.logo }}
                style={{ width: 48, height: 48 }}
                resizeMode="contain"
              />
            ) : null}
            <View style={{ flex: 1, gap: 3 }}>
              <Text style={{ color: colors.foreground, fontFamily: FONT.display, fontSize: 22, lineHeight: 26 }}>
                {pickStr}
              </Text>
              <Text style={{ color: colors.mutedForeground, fontFamily: FONT.bold, fontSize: 13 }}>
                {market} · {isHome ? "Home" : "Away"} vs {opp}
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

        {loading ? (
          <Loading label="Loading real team results…" />
        ) : errored ? (
          <ErrorState onRetry={() => (resolved ? historyQ.refetch() : resolveQ.refetch())} />
        ) : noData ? (
          <EmptyNote
            text={`We couldn't pull real recent results for ${team} in ${sportLabel} right now, so we're not estimating any numbers. The line and price above are live.`}
          />
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
                  label={isHome ? "Home form" : "Away form"}
                  sub={isHome ? "Record at home" : "Record on the road"}
                  value={rec(split)}
                  last
                />
              </View>
            </Section>

            {/* Recent games — real per-game margins vs the picked number */}
            <Section title={`RECENT GAMES · ${numberLabel}IN ${beats}/${n}`}>
              <View style={{ gap: 8 }}>
                {games.map((g, i) => {
                  const beat = g.margin > coverThreshold;
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
                            color: beat ? colors.success : colors.mutedForeground,
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
                            backgroundColor: beat ? colors.success : colors.border,
                          }}
                        />
                      </View>
                    </View>
                  );
                })}
                <Text style={{ color: colors.mutedForeground, fontFamily: FONT.body, fontSize: 11, marginTop: 2 }}>
                  Bars are real scoring margins. Green = the team {beatCaption}
                  {line != null ? " that game" : ""} — vs varied opponents, not this game's line.
                </Text>
              </View>
            </Section>
          </>
        )}

        {/* Opponent defense — REAL season points-allowed for the opponent */}
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

        {/* Injury report — REAL ESPN designations for both sides */}
        <Section title="INJURY REPORT">
          {injuriesQ.isLoading ? (
            <Text style={{ color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 12 }}>
              Checking the ESPN injury report…
            </Text>
          ) : matchupInjuries.length === 0 ? (
            <Text style={{ color: colors.mutedForeground, fontFamily: FONT.body, fontSize: 12 }}>
              {injuriesQ.isError
                ? "Couldn't reach the ESPN injury report."
                : "No injuries reported for either side."}
            </Text>
          ) : (
            <View style={{ gap: 14 }}>
              {/* Injury edge summary — derived from real impact counts, no WAR */}
              <View
                style={{
                  borderRadius: 10,
                  borderWidth: 1,
                  borderColor: colors.border,
                  backgroundColor: colors.card,
                  padding: 12,
                  gap: 6,
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
                  INJURY EDGE
                </Text>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <View
                    style={{
                      width: 9,
                      height: 9,
                      borderRadius: 5,
                      backgroundColor:
                        injEdge.kind === "advantage" ? colors.success : colors.mutedForeground,
                    }}
                  />
                  <Text style={{ color: colors.foreground, fontFamily: FONT.bold, fontSize: 14 }}>
                    {injEdge.kind === "advantage"
                      ? `Advantage: ${injEdge.team}`
                      : "Even — minimal injury edge"}
                  </Text>
                </View>
                <Text
                  style={{ color: colors.mutedForeground, fontFamily: FONT.body, fontSize: 11, lineHeight: 16 }}
                >
                  {(() => {
                    if (injEdge.kind !== "advantage")
                      return "Both sides have comparable injury impact.";
                    const oppHigh =
                      injurySummaries.find((s) => s.team === injEdge.opp)?.highCount ?? 0;
                    const ownHigh =
                      injurySummaries.find((s) => s.team === injEdge.team)?.highCount ?? 0;
                    // Only cite high-impact counts when they actually differ — the
                    // edge is driven by total impact, so equal high-counts would
                    // make a "vs" line read wrong. Fall back to the honest total.
                    return oppHigh > ownHigh
                      ? `${injEdge.opp} is more banged up (${oppHigh} high-impact vs ${ownHigh}).`
                      : `${injEdge.opp} carries more total injury impact across the roster.`;
                  })()}
                </Text>
              </View>

              {matchupInjuries.map((t) => {
                const summary = injurySummaries.find((s) => s.team === t.team);
                const sorted = [...t.entries].sort(
                  (a, b) => injuryImpact(sport, b).score - injuryImpact(sport, a).score,
                );
                const open = !!injuryOpen[t.team];
                const shown = open ? sorted : sorted.slice(0, 6);
                return (
                  <View key={t.team} style={{ gap: 6 }}>
                    <Text
                      style={{ color: colors.foreground, fontFamily: FONT.bold, fontSize: 12, letterSpacing: 0.3 }}
                    >
                      {t.team} · {t.entries.length}
                    </Text>
                    {summary && summary.groups.length > 0 ? (
                      <Text
                        style={{ color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 11 }}
                      >
                        {summary.groups.map((g) => `${g.group} ${g.count}`).join("  ·  ")}
                      </Text>
                    ) : null}
                    {shown.map((e, i) => {
                      const { tier } = injuryImpact(sport, e);
                      const c = impactColor(tier);
                      const friendly = friendlyInjury(e.status);
                      return (
                        <View
                          key={`${e.player}-${i}`}
                          style={{ flexDirection: "row", alignItems: "center", gap: 8 }}
                        >
                          <View
                            style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: c }}
                          />
                          <Text
                            style={{ color: colors.foreground, fontFamily: FONT.medium, fontSize: 12, flex: 1 }}
                            numberOfLines={1}
                          >
                            {e.player}
                            {e.position ? ` (${e.position})` : ""}
                          </Text>
                          <View style={{ alignItems: "flex-end" }}>
                            <Text style={{ color: c, fontFamily: FONT.bold, fontSize: 11 }}>
                              {friendly.label}
                            </Text>
                            <Text
                              style={{ color: colors.mutedForeground, fontFamily: FONT.body, fontSize: 9 }}
                            >
                              {impactLabel(tier)}
                            </Text>
                          </View>
                        </View>
                      );
                    })}
                    {t.entries.length > 6 ? (
                      <Pressable
                        onPress={() =>
                          setInjuryOpen((prev) => ({ ...prev, [t.team]: !prev[t.team] }))
                        }
                        hitSlop={6}
                        style={{ flexDirection: "row", alignItems: "center", gap: 4, paddingTop: 2 }}
                      >
                        <Text style={{ color: colors.primary, fontFamily: FONT.bold, fontSize: 11 }}>
                          {open ? "Show less" : `View all ${t.entries.length} injuries`}
                        </Text>
                        <Feather
                          name={open ? "chevron-up" : "arrow-right"}
                          size={12}
                          color={colors.primary}
                        />
                      </Pressable>
                    ) : null}
                  </View>
                );
              })}

              <Text
                style={{ color: colors.mutedForeground, fontFamily: FONT.body, fontSize: 9, lineHeight: 13 }}
              >
                Impact = ESPN injury severity + position — a quick betting guide, not a player rating.
              </Text>
            </View>
          )}
        </Section>

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

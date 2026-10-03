import Feather from "@expo/vector-icons/Feather";
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
  getFightAnalysis,
  getInjuries,
  getTeamDefense,
  getTeamHistory,
  searchTeam,
  type FightAnalysis,
  type TeamForm,
} from "@/lib/api";
import {
  fightAnalysisHasStats,
  fightPickSide,
  fightTotalBadgeLabel,
  fightTotalMarketSubtitle,
  fightTotalRoundsExplain,
  isCombatFightSport,
  parseFightGameSides,
} from "@/lib/fightPickSheet";
import { runClientFightMonteCarlo } from "@/lib/ufcClientSim";
import {
  injuriesForMatchup,
  teamNameMatches,
  friendlyInjury,
  injuryImpact,
  summarizeTeamInjuries,
  injuryEdge,
  type InjuryImpactTier,
} from "@/lib/injuries";
import { SLIP_UI_ENABLED } from "@/lib/slipUi";
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

// The screen routes to one of two views: the default single-team pick sheet
// (moneyline/spread) or — for a game total, which names no single team — a
// matchup sheet showing BOTH teams' real combined-scoring. `kind` is fixed per
// navigation, so each mounted view runs a stable set of hooks.
export default function TeamPickDetailScreen() {
  const params = useLocalSearchParams<{ kind?: string }>() ?? {};
  if (String(params.kind ?? "") === "total") return <TotalMatchupView />;
  return <TeamPickView />;
}

function TeamPickView() {
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
  }>() ?? {};

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

  // UFC/MMA: fighters are not ESPN teams — team-search/history is always empty
  // (phone: Romero/Cong ML showed TEAM PICK + "couldn't pull real recent results").
  const isFight = isCombatFightSport(sport);
  const fightSides = isFight ? parseFightGameSides(game) : null;
  const fightSide = fightPickSide({
    team,
    away: fightSides?.away,
    home: fightSides?.home,
  });

  // Resolve the team to an ESPN id, then pull its real history. Two-step so the
  // page works from the odds feed (which carries names, not ESPN ids).
  // Combat sports skip this path entirely (use fight-analysis instead).
  const resolveQ = useQuery({
    queryKey: ["team-resolve", sport, team],
    enabled: !isFight && !!sport && !!team,
    staleTime: 30 * 60_000,
    queryFn: async ({ signal }) => {
      const r = await searchTeam(team, signal);
      // Fail closed: only resolve a same-sport team whose name actually matches.
      // Falling back to another sport's (or a non-matching) result would attribute
      // this leg's stats to the wrong team.
      const sportHits = r.results.filter((t) => (t.sport ?? "") === sport);
      const hit =
        sportHits.find((t) => teamNameMatches(t.name, team)) ??
        sportHits[0] ??
        null;
      return hit;
    },
  });
  const resolved = resolveQ.data ?? null;

  const historyQ = useQuery({
    queryKey: ["team-history", sport, resolved?.teamId],
    enabled: !isFight && !!sport && !!resolved?.teamId,
    staleTime: 10 * 60_000,
    queryFn: ({ signal }) => getTeamHistory(sport, resolved!.teamId, signal),
  });
  const history = historyQ.data ?? null;

  const fightQ = useQuery({
    queryKey: ["fight-analysis", fightSides?.away, fightSides?.home],
    enabled: isFight && !!fightSides?.away && !!fightSides?.home,
    staleTime: 10 * 60_000,
    queryFn: ({ signal }) =>
      getFightAnalysis(fightSides!.away, fightSides!.home, signal),
  });
  const fight = (fightQ.data ?? null) as FightAnalysis | null;
  const fightHasStats = fightAnalysisHasStats(fight);
  const pickedFighter =
    fightSide === "home" ? fight?.home : fightSide === "away" ? fight?.away : null;
  const oppFighter =
    fightSide === "home" ? fight?.away : fightSide === "away" ? fight?.home : null;

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

  const loading = isFight
    ? fightQ.isLoading
    : resolveQ.isLoading || historyQ.isLoading;
  const errored = isFight ? fightQ.isError : resolveQ.isError || historyQ.isError;
  const noData = isFight
    ? !loading && !errored && !fightHasStats
    : !loading && !errored && (!resolved || n === 0);

  // Back nav that never throws "GO_BACK was not handled": when opened cold
  // (deep link / fresh stack) there's nothing to pop, so fall back to home.
  const goBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace("/");
  };

  // --- Real injury report + opponent defense (free ESPN feeds) ---

  const injuriesQ = useQuery({
    queryKey: ["injuries", sport],
    enabled: !isFight && !!sport,
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
    enabled: !isFight && !!sport && !!opp,
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
                {isFight ? "FIGHT PICK" : "TEAM PICK"}
              </Text>
            </View>
            {(!isFight || fightHasStats) ? (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
              <Feather name="check-circle" size={12} color={colors.success} />
              <Text style={{ color: colors.success, fontFamily: FONT.bold, fontSize: 10, letterSpacing: 0.6 }}>
                REAL STATS
              </Text>
            </View>
            ) : null}
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
          <Loading label={isFight ? "Loading fighter data…" : "Loading real team results…"} />
        ) : errored ? (
          <ErrorState
            onRetry={() =>
              isFight
                ? fightQ.refetch()
                : resolved
                  ? historyQ.refetch()
                  : resolveQ.refetch()
            }
          />
        ) : noData ? (
          <EmptyNote
            text={
              isFight
                ? `We couldn't pull real fight data for ${team} right now. The line and price above are live.`
                : `We couldn't pull real recent results for ${team} in ${sportLabel} right now, so we're not estimating any numbers. The line and price above are live.`
            }
          />
        ) : isFight && fight ? (
          <FightPickBody
            fight={fight}
            picked={pickedFighter}
            opponent={oppFighter}
            pickedName={team}
            oppName={opp}
            lean={fight.lean}
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
        {!isFight && oppDefense && oppDefense.avgPointsAgainst != null ? (
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

        {/* Injury report — team sports only (UFC uses fight analysis above). */}
        {!isFight ? (
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
        ) : null}

        {/* Add to slip */}
        {SLIP_UI_ENABLED ? (
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
        ) : null}
      </ScrollView>

      {SLIP_UI_ENABLED ? <SlipBar pathname="/team-pick" /> : null}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Game-total matchup view: a total names no single team, so we show BOTH sides'
// REAL recent scoring (each team's combined per-game totals) plus the shared
// injury report. Nothing is predicted — every number comes from final scores.
// ---------------------------------------------------------------------------
function TotalMatchupView() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const slipClearance = useSlipClearance();
  const router = useRouter();
  const { addLeg, removeLeg, hasLeg } = useBetSlip();

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

  const p = useLocalSearchParams<{
    away?: string;
    home?: string;
    totalSide?: string;
    sport?: string;
    market?: string;
    line?: string;
    odds?: string;
    game?: string;
    startsAt?: string;
    pick?: string;
  }>() ?? {};

  const away = String(p.away ?? "");
  const home = String(p.home ?? "");
  const sport = String(p.sport ?? "");
  const market = String(p.market ?? "Total");
  const game = String(p.game ?? "");
  const startsAt = p.startsAt ? String(p.startsAt) : "";
  const odds = Number(p.odds);
  const line = p.line != null && p.line !== "" ? Number(p.line) : null;
  const pickStr = String(p.pick ?? "");
  const sportLabel = SPORTS.find((s) => s.id === sport)?.label ?? sport.toUpperCase();

  // UFC/MMA totals = total rounds — fighters are not ESPN teams (phone: empty
  // AWAY/HOME "No real recent results" + team combined-score copy on Under 2.5).
  const isFight = isCombatFightSport(sport);
  const fightSides = isFight
    ? parseFightGameSides(game) ?? (away && home ? { away, home } : null)
    : null;

  const fightQ = useQuery({
    queryKey: ["fight-analysis", fightSides?.away, fightSides?.home],
    enabled: isFight && !!fightSides?.away && !!fightSides?.home,
    staleTime: 10 * 60_000,
    queryFn: ({ signal }) =>
      getFightAnalysis(fightSides!.away, fightSides!.home, signal),
  });
  const fight = (fightQ.data ?? null) as FightAnalysis | null;
  const fightHasStats = fightAnalysisHasStats(fight);

  // Re-grade the posted O/U rounds line with client MC (same engine as Coach).
  const fightRoundsSim = useMemo(() => {
    if (!isFight || !fight?.away || !fight?.home || line == null || !Number.isFinite(line)) {
      return null;
    }
    const over = /\bover\b/i.test(pickStr);
    const under = /\bunder\b/i.test(pickStr);
    if (!over && !under) return null;
    const coverId = `${over ? "over" : "under"}-${line}`;
    return runClientFightMonteCarlo({
      away: fight.away,
      home: fight.home,
      lean: fight.lean,
      simulations: 4_000,
      coverQueries: [
        {
          id: coverId,
          kind: "total",
          line,
          totalSide: over ? "over" : "under",
        },
      ],
      retainOutcomes: false,
    });
  }, [isFight, fight, line, pickStr]);

  const goBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace("/");
  };

  // Injury report for team sports only — UFC has no ESPN team injuries.
  const injuriesQ = useQuery({
    queryKey: ["injuries", sport],
    enabled: !isFight && !!sport,
    staleTime: 10 * 60_000,
    queryFn: ({ signal }) => getInjuries(sport, signal),
  });
  const matchupInjuries = useMemo(
    () => injuriesForMatchup(injuriesQ.data, [home, away]),
    [injuriesQ.data, home, away],
  );
  const injurySummaries = useMemo(
    () => matchupInjuries.map((t) => summarizeTeamInjuries(sport, t)),
    [matchupInjuries, sport],
  );
  const injEdge = useMemo(() => injuryEdge(injurySummaries), [injurySummaries]);
  const [injuryOpen, setInjuryOpen] = useState<Record<string, boolean>>({});

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
    };
    const ok = addLeg(leg);
    Haptics.impactAsync(
      ok ? Haptics.ImpactFeedbackStyle.Medium : Haptics.ImpactFeedbackStyle.Light,
    );
  };

  const fightLoading = isFight && fightQ.isLoading;
  const fightErrored = isFight && fightQ.isError;
  const fightEmpty = isFight && !fightLoading && !fightErrored && !fightHasStats;

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
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
          {pickStr || "Total"}
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
                {isFight ? fightTotalBadgeLabel(market) : "GAME TOTAL"}
              </Text>
            </View>
            {(!isFight || fightHasStats) ? (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                <Feather name="check-circle" size={12} color={colors.success} />
                <Text style={{ color: colors.success, fontFamily: FONT.bold, fontSize: 10, letterSpacing: 0.6 }}>
                  REAL STATS
                </Text>
              </View>
            ) : null}
          </View>

          <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
            <View style={{ flex: 1, gap: 3 }}>
              <Text style={{ color: colors.foreground, fontFamily: FONT.display, fontSize: 22, lineHeight: 26 }}>
                {pickStr}
              </Text>
              <Text style={{ color: colors.mutedForeground, fontFamily: FONT.bold, fontSize: 13 }}>
                {isFight ? fightTotalMarketSubtitle(market) : `${market} · combined score`}
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

        {isFight ? (
          fightLoading ? (
            <Loading label="Loading fighter data…" />
          ) : fightErrored ? (
            <ErrorState onRetry={() => fightQ.refetch()} />
          ) : fightEmpty || !fight ? (
            <EmptyNote
              text={`We couldn't pull real fight data for this bout right now. The ${pickStr || "total rounds"} line and price above are live.`}
            />
          ) : (
            <FightTotalRoundsBody
              fight={fight}
              line={line}
              pickStr={pickStr}
              roundsSim={fightRoundsSim}
            />
          )
        ) : (
          <>
            {/* Each side's REAL combined-scoring form vs the line */}
            <TeamTotalBlock roleLabel="AWAY" name={away} sport={sport} line={line} />
            <TeamTotalBlock roleLabel="HOME" name={home} sport={sport} line={line} />

            {line != null ? (
              <Text style={{ color: colors.mutedForeground, fontFamily: FONT.body, fontSize: 11, lineHeight: 16 }}>
                "Over {line}" counts each team's own recent games whose combined final
                score cleared {line} — vs varied opponents, not a prediction of this
                matchup.
              </Text>
            ) : null}
          </>
        )}

        {isFight && line != null ? (
          <Text style={{ color: colors.mutedForeground, fontFamily: FONT.body, fontSize: 11, lineHeight: 16 }}>
            {fightTotalRoundsExplain(line, pickStr)}
          </Text>
        ) : null}

        {/* Injury report — team sports only (UFC uses fight analysis above). */}
        {!isFight ? (
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
                <Text style={{ color: colors.mutedForeground, fontFamily: FONT.bold, fontSize: 10, letterSpacing: 0.6 }}>
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
                <Text style={{ color: colors.mutedForeground, fontFamily: FONT.body, fontSize: 11, lineHeight: 16 }}>
                  {(() => {
                    if (injEdge.kind !== "advantage")
                      return "Both sides have comparable injury impact.";
                    const oppHigh =
                      injurySummaries.find((s) => s.team === injEdge.opp)?.highCount ?? 0;
                    const ownHigh =
                      injurySummaries.find((s) => s.team === injEdge.team)?.highCount ?? 0;
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
                    <Text style={{ color: colors.foreground, fontFamily: FONT.bold, fontSize: 12, letterSpacing: 0.3 }}>
                      {t.team} · {t.entries.length}
                    </Text>
                    {summary && summary.groups.length > 0 ? (
                      <Text style={{ color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 11 }}>
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
                          <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: c }} />
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
                            <Text style={{ color: colors.mutedForeground, fontFamily: FONT.body, fontSize: 9 }}>
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

              <Text style={{ color: colors.mutedForeground, fontFamily: FONT.body, fontSize: 9, lineHeight: 13 }}>
                Impact = ESPN injury severity + position — a quick betting guide, not a player rating.
              </Text>
            </View>
          )}
        </Section>
        ) : null}

        {/* Add to slip */}
        {SLIP_UI_ENABLED ? (
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
        ) : null}
      </ScrollView>

      {SLIP_UI_ENABLED ? <SlipBar pathname="/team-pick" /> : null}
    </View>
  );
}

// One team's REAL recent combined-scoring form (its own games' final totals) vs
// the line. Self-contained (own resolve + history queries) so the matchup view
// can render two of these. Fail-closed: no real games → an honest empty note.
function TeamTotalBlock({
  roleLabel,
  name,
  sport,
  line,
}: {
  roleLabel: string;
  name: string;
  sport: string;
  line: number | null;
}) {
  const colors = useColors();

  const resolveQ = useQuery({
    queryKey: ["team-resolve", sport, name],
    enabled: !!sport && !!name,
    staleTime: 30 * 60_000,
    queryFn: async ({ signal }) => {
      const r = await searchTeam(name, signal);
      const sportHits = r.results.filter((t) => (t.sport ?? "") === sport);
      return sportHits.find((t) => teamNameMatches(t.name, name)) ?? sportHits[0] ?? null;
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

  const games = useMemo(() => {
    return (history?.recent ?? [])
      .filter((g) => g.pts != null && g.oppPts != null)
      .slice(0, 10)
      .map((g) => ({
        total: (g.pts as number) + (g.oppPts as number),
        date: g.date,
        opp: g.opp,
        home: g.home,
      }));
  }, [history]);

  const n = games.length;
  const overs = useMemo(
    () => (line != null ? games.filter((g) => g.total > line).length : 0),
    [games, line],
  );
  const avgTotal = n > 0 ? games.reduce((a, g) => a + g.total, 0) / n : null;
  const scale = useMemo(
    () => Math.max(1, ...games.map((g) => g.total), line ?? 0),
    [games, line],
  );

  const loading = resolveQ.isLoading || historyQ.isLoading;
  const errored = resolveQ.isError || historyQ.isError;
  const noData = !loading && !errored && (!resolved || n === 0);

  return (
    <Section title={`${roleLabel} · ${resolved?.name ?? name}`}>
      {loading ? (
        <Text style={{ color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 12 }}>
          Loading real recent results…
        </Text>
      ) : errored ? (
        <Text style={{ color: colors.mutedForeground, fontFamily: FONT.body, fontSize: 12 }}>
          Couldn't reach recent results for {name}.
        </Text>
      ) : noData ? (
        <Text style={{ color: colors.mutedForeground, fontFamily: FONT.body, fontSize: 12 }}>
          No real recent results for {name} right now — nothing estimated.
        </Text>
      ) : (
        <View style={{ gap: 10 }}>
          <BreakdownRow
            icon="arrow-up-circle"
            label="Points per game"
            sub="Scored · allowed (last 10)"
            value={`${history?.last10.ptsFor?.toFixed(1) ?? "—"} · ${history?.last10.ptsAgainst?.toFixed(1) ?? "—"}`}
          />
          <BreakdownRow
            icon="activity"
            label="Avg combined total"
            sub="Both teams' points per game"
            value={avgTotal != null ? avgTotal.toFixed(1) : "—"}
            last={line == null}
          />
          {line != null ? (
            <BreakdownRow
              icon="bar-chart-2"
              label={`Over ${line}`}
              sub="Recent games clearing the line"
              value={`${overs}/${n}`}
              last
            />
          ) : null}

          <View style={{ gap: 8 }}>
            {games.map((g, i) => {
              const over = line != null && g.total > line;
              const w = `${Math.max(6, Math.round((g.total / scale) * 100))}%`;
              return (
                <View key={i} style={{ gap: 3 }}>
                  <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                    <Text style={{ color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 11 }}>
                      {(g.home ? "vs " : "@ ") + (g.opp ?? "—")}
                      {g.date ? ` · ${g.date}` : ""}
                    </Text>
                    <Text
                      style={{
                        color: over ? colors.success : colors.mutedForeground,
                        fontFamily: FONT.bold,
                        fontSize: 12,
                      }}
                    >
                      {g.total}
                    </Text>
                  </View>
                  <View style={{ height: 7, borderRadius: 4, backgroundColor: colors.card, overflow: "hidden" }}>
                    <View
                      style={{
                        width: w as `${number}%`,
                        height: "100%",
                        borderRadius: 4,
                        backgroundColor: over ? colors.success : colors.border,
                      }}
                    />
                  </View>
                </View>
              );
            })}
          </View>
        </View>
      )}
    </Section>
  );
}

function FightPickBody({
  fight,
  picked,
  opponent,
  pickedName,
  oppName,
  lean,
}: {
  fight: FightAnalysis;
  picked: FightAnalysis["away"] | null | undefined;
  opponent: FightAnalysis["away"] | null | undefined;
  pickedName: string;
  oppName: string;
  lean: FightAnalysis["lean"];
}) {
  const colors = useColors();
  const pName = picked?.resolvedName || picked?.name || pickedName;
  const oName = opponent?.resolvedName || opponent?.name || oppName;
  const recStr = (f: FightAnalysis["away"] | null | undefined) =>
    f?.record ? `${f.record.wins}-${f.record.losses}-${f.record.draws}` : "—";
  const form = (f: FightAnalysis["away"] | null | undefined) => {
    const rows = f?.recentForm ?? [];
    if (!rows.length) return "—";
    return rows
      .slice(0, 5)
      .map((r) => (r.result === "W" ? "W" : r.result === "L" ? "L" : r.result === "D" ? "D" : "—"))
      .join("");
  };
  const winPct = (f: FightAnalysis["away"] | null | undefined) =>
    f?.record ? `${f.record.winPct}%` : "—";
  const recent = picked?.recentForm?.slice(0, 5) ?? [];

  return (
    <View style={{ gap: 14 }}>
      <View style={{ flexDirection: "row", gap: 10 }}>
        <MetricTile
          icon="award"
          label="RECORD"
          value={recStr(picked)}
          caption={pName}
          tint={colors.foreground}
        />
        <MetricTile
          icon="trending-up"
          label="FORM"
          value={form(picked)}
          caption="recent"
          tint={colors.foreground}
        />
        <MetricTile
          icon="percent"
          label="WIN %"
          value={winPct(picked)}
          caption="career"
          tint={colors.foreground}
        />
      </View>

      <Section title="TALE OF THE TAPE">
        <View style={{ gap: 0 }}>
          <BreakdownRow icon="user" label={pName} sub="Picked fighter" value={recStr(picked)} />
          <BreakdownRow icon="user" label={oName} sub="Opponent" value={recStr(opponent)} last />
        </View>
        {picked?.weightClass || opponent?.weightClass ? (
          <Text style={{ color: colors.mutedForeground, fontFamily: FONT.body, fontSize: 11 }}>
            {(picked?.weightClass || opponent?.weightClass || "").toUpperCase()}
          </Text>
        ) : null}
      </Section>

      {recent.length > 0 ? (
        <Section title="RECENT FORM">
          <View style={{ gap: 6 }}>
            {recent.map((rf, i) => (
              <Text
                key={`${pName}-${i}`}
                style={{ color: colors.mutedForeground, fontFamily: FONT.body, fontSize: 12, lineHeight: 17 }}
              >
                {rf.result === "W" ? "W" : rf.result === "L" ? "L" : rf.result === "D" ? "D" : "—"}{" "}
                vs {rf.opponent ?? "—"}
                {rf.method ? ` · ${rf.method}` : ""}
                {rf.date ? ` · ${rf.date}` : ""}
              </Text>
            ))}
          </View>
        </Section>
      ) : null}

      {lean?.side ? (
        <Section title="DATA EDGE">
          <Text style={{ color: colors.foreground, fontFamily: FONT.display, fontSize: 16 }}>
            {lean.side}
          </Text>
          {(lean.reasons ?? []).slice(0, 4).map((rsn, i) => (
            <Text
              key={i}
              style={{ color: colors.mutedForeground, fontFamily: FONT.body, fontSize: 12, lineHeight: 17 }}
            >
              · {rsn}
            </Text>
          ))}
        </Section>
      ) : null}

      {fight.simulation && fight.simulation.simulations > 0 ? (
        <Section title="10K FIGHT SIM">
          <View style={{ gap: 0 }}>
            <BreakdownRow
              icon="activity"
              label={fightSidesLabel(fight, "away")}
              sub="Win probability"
              value={`${Math.round(fight.simulation.awayWinProbability * 100)}%`}
            />
            <BreakdownRow
              icon="activity"
              label={fightSidesLabel(fight, "home")}
              sub="Win probability"
              value={`${Math.round(fight.simulation.homeWinProbability * 100)}%`}
              last
            />
          </View>
        </Section>
      ) : null}
    </View>
  );
}

/** UFC total-rounds detail — both fighters' real stats + O/U rounds sim. */
function FightTotalRoundsBody({
  fight,
  line,
  pickStr,
  roundsSim,
}: {
  fight: FightAnalysis;
  line: number | null;
  pickStr: string;
  roundsSim: ReturnType<typeof runClientFightMonteCarlo> | null;
}) {
  const colors = useColors();
  const recStr = (f: FightAnalysis["away"] | null | undefined) =>
    f?.record ? `${f.record.wins}-${f.record.losses}-${f.record.draws}` : "—";
  const finishPct = (f: FightAnalysis["away"] | null | undefined) =>
    f?.stats?.finishPct != null ? `${Math.round(f.stats.finishPct)}%` : "—";
  const decisionPct = (f: FightAnalysis["away"] | null | undefined) =>
    f?.stats?.decisionPct != null ? `${Math.round(f.stats.decisionPct)}%` : "—";
  const formStr = (f: FightAnalysis["away"] | null | undefined) => {
    const rows = f?.recentForm ?? [];
    if (!rows.length) return "—";
    return rows
      .slice(0, 5)
      .map((r) => (r.result === "W" ? "W" : r.result === "L" ? "L" : r.result === "D" ? "D" : "—"))
      .join("");
  };
  const nameOf = (f: FightAnalysis["away"], fallback: string) =>
    f.resolvedName || f.name || fallback;

  const awayName = nameOf(fight.away, "Away");
  const homeName = nameOf(fight.home, "Home");
  const over = /\bover\b/i.test(pickStr);
  const coverId =
    line != null && Number.isFinite(line) ? `${over ? "over" : "under"}-${line}` : null;
  const hitPct =
    coverId && roundsSim?.coverHitRates?.[coverId] != null
      ? Math.round(roundsSim.coverHitRates[coverId]! * 100)
      : null;
  const meanRounds =
    roundsSim?.meanTotalRounds ?? fight.simulation?.meanTotalRounds ?? null;

  const FighterBlock = ({
    role,
    f,
  }: {
    role: string;
    f: FightAnalysis["away"];
  }) => {
    const recent = (f.recentForm ?? []).slice(0, 5);
    return (
      <Section title={`${role} · ${nameOf(f, role).toUpperCase()}`}>
        <View style={{ flexDirection: "row", gap: 10 }}>
          <MetricTile
            icon="award"
            label="RECORD"
            value={recStr(f)}
            caption="career"
            tint={colors.foreground}
          />
          <MetricTile
            icon="zap"
            label="FINISH %"
            value={finishPct(f)}
            caption="KO/TKO/sub"
            tint={colors.foreground}
          />
          <MetricTile
            icon="trending-up"
            label="FORM"
            value={formStr(f)}
            caption="recent"
            tint={colors.foreground}
          />
        </View>
        {f.stats?.decisionPct != null ? (
          <Text style={{ color: colors.mutedForeground, fontFamily: FONT.body, fontSize: 11 }}>
            Decision rate {decisionPct(f)} — higher tends to push total rounds Over.
          </Text>
        ) : null}
        {recent.length > 0 ? (
          <View style={{ gap: 6, marginTop: 6 }}>
            {recent.map((rf, i) => (
              <Text
                key={`${role}-${i}`}
                style={{ color: colors.mutedForeground, fontFamily: FONT.body, fontSize: 12, lineHeight: 17 }}
              >
                {rf.result === "W" ? "W" : rf.result === "L" ? "L" : rf.result === "D" ? "D" : "—"}{" "}
                vs {rf.opponent ?? "—"}
                {rf.method ? ` · ${rf.method}` : ""}
                {rf.date ? ` · ${rf.date}` : ""}
              </Text>
            ))}
          </View>
        ) : (
          <Text style={{ color: colors.mutedForeground, fontFamily: FONT.body, fontSize: 12 }}>
            No recent fight log on file for {nameOf(f, role)} — using career rates when present.
          </Text>
        )}
      </Section>
    );
  };

  return (
    <View style={{ gap: 14 }}>
      <FighterBlock role="AWAY" f={fight.away} />
      <FighterBlock role="HOME" f={fight.home} />

      {(meanRounds != null || hitPct != null || (fight.simulation?.simulations ?? 0) > 0) ? (
        <Section title="TOTAL ROUNDS SIM">
          <View style={{ gap: 0 }}>
            {meanRounds != null ? (
              <BreakdownRow
                icon="activity"
                label="Mean total rounds"
                sub="From fight Monte Carlo"
                value={Number(meanRounds).toFixed(2)}
                last={hitPct == null}
              />
            ) : null}
            {hitPct != null && line != null ? (
              <BreakdownRow
                icon="crosshair"
                label={`${pickStr || (over ? `Over ${line}` : `Under ${line}`)}`}
                sub="Sim hit rate vs posted line"
                value={`${hitPct}%`}
                last
              />
            ) : null}
            {hitPct == null && meanRounds == null && fight.simulation ? (
              <>
                <BreakdownRow
                  icon="activity"
                  label={awayName}
                  sub="Win probability"
                  value={`${Math.round(fight.simulation.awayWinProbability * 100)}%`}
                />
                <BreakdownRow
                  icon="activity"
                  label={homeName}
                  sub="Win probability"
                  value={`${Math.round(fight.simulation.homeWinProbability * 100)}%`}
                  last
                />
              </>
            ) : null}
          </View>
        </Section>
      ) : null}

      {fight.lean?.side ? (
        <Section title="DATA EDGE">
          <Text style={{ color: colors.foreground, fontFamily: FONT.display, fontSize: 16 }}>
            {fight.lean.side}
          </Text>
          {(fight.lean.reasons ?? []).slice(0, 4).map((rsn, i) => (
            <Text
              key={i}
              style={{ color: colors.mutedForeground, fontFamily: FONT.body, fontSize: 12, lineHeight: 17 }}
            >
              · {rsn}
            </Text>
          ))}
        </Section>
      ) : null}
    </View>
  );
}

function fightSidesLabel(fight: FightAnalysis, side: "away" | "home"): string {
  const f = side === "away" ? fight.away : fight.home;
  return f.resolvedName || f.name || (side === "away" ? "Away" : "Home");
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

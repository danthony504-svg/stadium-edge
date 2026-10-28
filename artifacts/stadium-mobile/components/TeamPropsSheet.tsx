import Feather from "@expo/vector-icons/Feather";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Image, Modal, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { FactorGrid } from "@/components/FactorCards";
import { InjuryReport } from "@/components/InjuryReport";
import { FONT } from "@/components/ui";
import { useColors } from "@/hooks/useColors";
import {
  fetchPropSimulations,
  getGames,
  getOdds,
  getProps,
  getTeamDefense,
  getTeamHistory,
  searchTeam,
  type EspnGame,
  type PlayerProp,
  type TeamForm,
  type TeamSearchResult,
} from "@/lib/api";
import { explainMatchup } from "@/lib/matchupEvidence";
import { formatGameTime } from "@/lib/format";
import { teamNameMatches } from "@/lib/injuries";
import { GRADE_MIN_SAMPLE, gradePropCands, type GradeResult } from "@/lib/propGrade";
import { oddsRowsFromQuery, espnRowsFromQuery } from "@/lib/sportFeed";
import { SPORTS } from "@/lib/sports";
import { factorsForTeam } from "@/lib/teamFactors";
import {
  buildConsiderCandidates,
  buildConsiderPick,
  candidatesToPropPool,
  candidatesToSimPicks,
  countPostedAlts,
  emptyConsiderMessage,
  filterConsiderPicks,
  MATCHUP_CONSIDER_MIN_SIMULATIONS,
  MATCHUP_TOP_PER_ROLE,
  matchupFilterChips,
  oppDefenseNoteForMarket,
  rankConsiderPicksByRole,
  summarizeTeamForm,
  teamDefenseRows,
  type ConsiderPick,
} from "@/lib/teamMatchupConsider";
import { findOddsGameForMatchup } from "@/lib/teamPostedProps";

// Matchup-scoped sheet opened from Team Props. Carries focus team + full
// matchup identity so BOTH sides can be analyzed without guessing.
export type TeamSheetData = {
  team: string;
  opp: string;
  isHome: boolean;
  sport: string;
  gameLabel: string;
  startsAt: string;
  /** Odds API event id when known (Team mode matchup list). */
  eventId?: string | null;
  homeTeam?: string;
  awayTeam?: string;
};

const nickname = (full: string) => (full || "").split(/\s+/).filter(Boolean).pop() || full;
const fmt1 = (v: number | null | undefined) =>
  v == null ? "—" : `${v > 0 ? "+" : ""}${Number(v).toFixed(1)}`;
const rec = (f: TeamForm | null | undefined) =>
  f && f.games ? `${f.wins}-${f.losses}` : "—";
const sampleCaption = (n: number | null | undefined, unit = "games") =>
  n != null && n > 0 ? `n=${n} ${unit}` : "sample unavailable";

async function resolveTeam(
  sport: string,
  name: string,
  signal?: AbortSignal,
): Promise<TeamSearchResult | null> {
  const r = await searchTeam(name, signal);
  const sportHits = r.results.filter((t) => (t.sport ?? "") === sport);
  return sportHits.find((t) => teamNameMatches(t.name, name)) ?? null;
}

export function TeamPropsSheet({
  data,
  onClose,
  onOpenConsiderPick,
}: {
  data: TeamSheetData | null;
  onClose: () => void;
  /** Optional — open player props / breakdown for a qualified consider pick. */
  onOpenConsiderPick?: (pick: ConsiderPick, allProps: PlayerProp[]) => void;
}) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [marketFilter, setMarketFilter] = useState<string>("all");
  /** Team totals start collapsed so player cards stay above the fold. */

  const sport = data?.sport ?? "";
  const team = data?.team ?? "";
  const opp = data?.opp ?? "";
  const sportLabel = data ? SPORTS.find((s) => s.id === sport)?.label ?? sport.toUpperCase() : "";
  const filterChips = useMemo(() => matchupFilterChips(sport), [sport]);

  const homeTeam = data?.homeTeam ?? (data?.isHome ? data.team : data?.opp) ?? "";
  const awayTeam = data?.awayTeam ?? (data?.isHome ? data?.opp : data?.team) ?? "";
  const gameLabel = data?.gameLabel || `${awayTeam} @ ${homeTeam}`;

  const focusResolveQ = useQuery({
    queryKey: ["team-resolve", sport, team],
    enabled: !!sport && !!team,
    staleTime: 30 * 60_000,
    queryFn: ({ signal }) => resolveTeam(sport, team, signal),
  });
  const homeResolveQ = useQuery({
    queryKey: ["team-resolve", sport, homeTeam],
    enabled: !!sport && !!homeTeam,
    staleTime: 30 * 60_000,
    queryFn: ({ signal }) => resolveTeam(sport, homeTeam, signal),
  });
  const awayResolveQ = useQuery({
    queryKey: ["team-resolve", sport, awayTeam],
    enabled: !!sport && !!awayTeam,
    staleTime: 30 * 60_000,
    queryFn: ({ signal }) => resolveTeam(sport, awayTeam, signal),
  });
  const resolved = focusResolveQ.data ?? null;
  const homeResolved = homeResolveQ.data ?? null;
  const awayResolved = awayResolveQ.data ?? null;

  const historyQ = useQuery({
    queryKey: ["team-history", sport, resolved?.teamId],
    enabled: !!sport && !!resolved?.teamId,
    staleTime: 10 * 60_000,
    queryFn: ({ signal }) => getTeamHistory(sport, resolved!.teamId, signal),
  });
  const homeHistoryQ = useQuery({
    queryKey: ["team-history", sport, homeResolved?.teamId],
    enabled: !!sport && !!homeResolved?.teamId,
    staleTime: 10 * 60_000,
    queryFn: ({ signal }) => getTeamHistory(sport, homeResolved!.teamId, signal),
  });
  const awayHistoryQ = useQuery({
    queryKey: ["team-history", sport, awayResolved?.teamId],
    enabled: !!sport && !!awayResolved?.teamId,
    staleTime: 10 * 60_000,
    queryFn: ({ signal }) => getTeamHistory(sport, awayResolved!.teamId, signal),
  });
  const history = historyQ.data ?? null;

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

  const oddsQ = useQuery({
    queryKey: ["odds", sport],
    enabled: !!sport && !!data,
    staleTime: 60_000,
    queryFn: ({ signal }) => getOdds(sport, signal),
  });
  const matchupGame = useMemo(() => {
    if (!data || !oddsQ.data) return null;
    const oddsRows = oddsRowsFromQuery(oddsQ.data, sport);
    const g =
      (data.eventId && oddsRows.find((o) => o.id === data.eventId)) ||
      findOddsGameForMatchup(oddsRows, team, opp);
    return g || null;
  }, [data, oddsQ.data, sport, team, opp]);

  const eventId = data?.eventId || matchupGame?.id || null;

  const homeDefenseQ = useQuery({
    queryKey: ["team-defense", sport, homeResolved?.teamId, "positions-v2"],
    enabled: !!sport && !!homeResolved?.teamId,
    staleTime: 30 * 60_000,
    queryFn: ({ signal }) => getTeamDefense(sport, homeResolved!.teamId, signal, true),
  });
  const awayDefenseQ = useQuery({
    queryKey: ["team-defense", sport, awayResolved?.teamId, "positions-v2"],
    enabled: !!sport && !!awayResolved?.teamId,
    staleTime: 30 * 60_000,
    queryFn: ({ signal }) => getTeamDefense(sport, awayResolved!.teamId, signal, true),
  });

  // ESPN games → home/away team ids (reuse cache with Props tab when possible).
  const espnGamesQ = useQuery({
    queryKey: ["games", sport],
    enabled: !!sport && !!data,
    staleTime: 5 * 60_000,
    queryFn: ({ signal }) => getGames(sport, signal).catch(() => [] as EspnGame[]),
  });
  const espnIds = useMemo(() => {
    const rows = espnRowsFromQuery(espnGamesQ.data, sport);
    const hit = rows.find(
      (g) =>
        (teamNameMatches(g.homeTeam ?? "", homeTeam) &&
          teamNameMatches(g.awayTeam ?? "", awayTeam)) ||
        (teamNameMatches(g.homeTeam ?? "", awayTeam) &&
          teamNameMatches(g.awayTeam ?? "", homeTeam)),
    );
    if (hit) {
      return {
        homeTeamId: hit.homeTeamId ?? homeResolved?.teamId ?? null,
        awayTeamId: hit.awayTeamId ?? awayResolved?.teamId ?? null,
      };
    }
    return {
      homeTeamId: homeResolved?.teamId ?? null,
      awayTeamId: awayResolved?.teamId ?? null,
    };
  }, [espnGamesQ.data, sport, homeTeam, awayTeam, homeResolved?.teamId, awayResolved?.teamId]);

  // Independent of Coach — event player props for this matchup only.
  const eventPropsQ = useQuery({
    queryKey: ["team-matchup-props", sport, eventId, espnIds.homeTeamId, espnIds.awayTeamId],
    enabled: !!sport && !!eventId && !!data,
    staleTime: 2 * 60_000,
    queryFn: ({ signal }) =>
      getProps(
        {
          sport,
          eventId: eventId!,
          home: homeTeam,
          away: awayTeam,
          homeTeamId: espnIds.homeTeamId,
          awayTeamId: espnIds.awayTeamId,
          startsAt: data?.startsAt,
        },
        signal,
      ),
  });
  const eventProps = eventPropsQ.data?.props ?? [];
  const identityIds = {
    homeTeamId:
      eventPropsQ.data?.identity?.homeTeamId != null
        ? String(eventPropsQ.data.identity.homeTeamId)
        : espnIds.homeTeamId,
    awayTeamId:
      eventPropsQ.data?.identity?.awayTeamId != null
        ? String(eventPropsQ.data.identity.awayTeamId)
        : espnIds.awayTeamId,
  };

  const considerBuilt = useMemo(
    () =>
      buildConsiderCandidates({
        props: eventProps,
        sport,
        homeTeam,
        awayTeam,
        ids: identityIds,
        eventId,
        filterKey: marketFilter,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [eventProps, sport, homeTeam, awayTeam, eventId, marketFilter, identityIds.homeTeamId, identityIds.awayTeamId],
  );

  const considerEvalQ = useQuery({
    queryKey: [
      "team-matchup-consider-quality-v2",
      sport,
      eventId,
      considerBuilt.candidates.map((c) => c.key).join("|"),
    ],
    enabled:
      !!sport &&
      !!eventId &&
      considerBuilt.candidates.length > 0 &&
      !eventPropsQ.isError,
    staleTime: 5 * 60_000,
    queryFn: async ({ signal }) => {
      const cands = considerBuilt.candidates;
      const pool = candidatesToPropPool(cands, sport, gameLabel, data!.startsAt);
      const picks = candidatesToSimPicks(cands, sport, gameLabel);
      const gradeCands = cands.map((c) => ({
        key: c.key,
        player: c.prop.player,
        athleteId: c.prop.athleteId,
        marketKey: c.prop.market,
        line: c.prop.line,
        side: c.side,
      }));
      const [grades, simPack] = await Promise.all([
        gradePropCands(gradeCands, sport, signal),
        fetchPropSimulations(picks, pool, {
          homeTeam,
          awayTeam,
          homeTeamId: identityIds.homeTeamId,
          awayTeamId: identityIds.awayTeamId,
          startsAt: data!.startsAt,
          tier: "deep",
          simulations: MATCHUP_CONSIDER_MIN_SIMULATIONS,
        }, signal),
      ]);
      return { grades, sims: simPack.hits, histories: simPack.playerHistories };
    },
  });

  const considerPicks = useMemo(() => {
    const out: ConsiderPick[] = [];
    const grades = considerEvalQ.data?.grades;
    const sims = considerEvalQ.data?.sims;
    if (!grades || !sims) return out;
    const homeDef = homeDefenseQ.data;
    const awayDef = awayDefenseQ.data;
    for (const cand of considerBuilt.candidates) {
      const simKey = `${cand.prop.player}|${cand.prop.market}|${cand.prop.line}|${cand.side}`;
      let sim = sims.get(simKey);
      if (!sim) {
        for (const [k, v] of sims) {
          if (
            v.player === cand.prop.player &&
            v.market === cand.prop.market &&
            v.line === cand.prop.line &&
            v.side === cand.side
          ) {
            sim = v;
            break;
          }
          if (k.toLowerCase() === simKey.toLowerCase()) {
            sim = v;
            break;
          }
        }
      }
      if (!sim) continue;
      const grade: GradeResult | null = grades.get(cand.key) ?? null;
      // Each player is graded vs the OPPOSING team's defense pack (team-wide only).
      const oppDef = cand.teamSide === "home" ? awayDef : homeDef;
      const defenseNote = oppDefenseNoteForMarket({
        sport,
        market: cand.prop.market,
        oppName: cand.oppName,
        oppDefense: oppDef,
      });
      const pick = buildConsiderPick({
        cand,
        sim,
        grade,
        sport,
        altCount: countPostedAlts(eventProps, cand.prop.player, cand.prop.market),
        defenseNote,
        opponentMarkets: oppDef?.opponentMarkets,
      });
      if (pick) out.push(pick);
    }
    out.sort((a, b) => b.simHitPct - a.simHitPct || b.price - a.price);
    return out;
  }, [
    considerBuilt.candidates,
    considerEvalQ.data,
    eventProps,
    homeDefenseQ.data,
    awayDefenseQ.data,
    sport,
  ]);

  const considerGroups = useMemo(() => {
    const filtered = filterConsiderPicks(considerPicks, marketFilter);
    return rankConsiderPicksByRole(filtered, MATCHUP_TOP_PER_ROLE);
  }, [considerPicks, marketFilter]);

  const considerFlatVisible = useMemo(
    () => considerGroups.flatMap((g) => g.picks),
    [considerGroups],
  );

  const homeForm = useMemo(
    () => summarizeTeamForm(homeResolved?.name ?? homeTeam, homeHistoryQ.data),
    [homeResolved?.name, homeTeam, homeHistoryQ.data],
  );
  const awayForm = useMemo(
    () => summarizeTeamForm(awayResolved?.name ?? awayTeam, awayHistoryQ.data),
    [awayResolved?.name, awayTeam, awayHistoryQ.data],
  );
  const homeDefRows = useMemo(
    () => teamDefenseRows(sport, homeDefenseQ.data),
    [sport, homeDefenseQ.data],
  );
  const awayDefRows = useMemo(
    () => teamDefenseRows(sport, awayDefenseQ.data),
    [sport, awayDefenseQ.data],
  );

  const teamFactors = useMemo(
    () => factorsForTeam({ sport, teamName: team, oppName: opp, isHome: data?.isHome }),
    [sport, team, opp, data?.isHome],
  );

  if (!data) return null;

  const loading = focusResolveQ.isLoading || historyQ.isLoading;
  const errored = focusResolveQ.isError || historyQ.isError;
  const noData = !loading && !errored && (!resolved || n === 0);

  const considerEmpty = emptyConsiderMessage({
    propsLoaded: eventPropsQ.isFetched,
    propsError: eventPropsQ.isError,
    candidateCount: considerBuilt.candidates.length,
    qualifiedCount: considerPicks.length,
    skipReason: considerBuilt.skipReason,
  });
  const filteredEmpty =
    considerPicks.length > 0 && considerFlatVisible.length === 0
      ? "No qualifying players for this market filter. Try All or another role."
      : null;

  return (
    <Modal visible animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: colors.background }}>
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
            Matchup Props
          </Text>
          <Pressable onPress={onClose} hitSlop={10}>
            <Text style={{ color: colors.primary, fontFamily: FONT.bold, fontSize: 15 }}>Close</Text>
          </Pressable>
        </View>

        <ScrollView
          contentContainerStyle={{
            padding: 16,
            paddingBottom: insets.bottom + 40,
            gap: 14,
          }}
        >
          {/* SECTION_ORDER:1 compact matchup header — both teams */}
          <View
            style={{
              backgroundColor: colors.surface,
              borderColor: colors.border,
              borderWidth: 1,
              borderRadius: colors.radius,
              paddingVertical: 12,
              paddingHorizontal: 14,
              gap: 8,
            }}
          >
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <Badge text={sportLabel} />
              <Badge text="REAL STATS" tone="success" />
            </View>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              {awayResolved?.logo ? (
                <Image source={{ uri: awayResolved.logo }} style={{ width: 28, height: 28 }} resizeMode="contain" />
              ) : null}
              <Text
                style={{ color: colors.foreground, fontFamily: FONT.display, fontSize: 18, lineHeight: 22, flex: 1 }}
                numberOfLines={2}
              >
                {awayTeam} @ {homeTeam}
              </Text>
              {homeResolved?.logo ? (
                <Image source={{ uri: homeResolved.logo }} style={{ width: 28, height: 28 }} resizeMode="contain" />
              ) : null}
            </View>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <Text style={{ color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 12 }}>
                Focus {nickname(resolved?.name ?? team)} · {data.isHome ? "Home" : "Away"}
              </Text>
              {formatGameTime(data.startsAt) ? (
                <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                  <Feather name="clock" size={11} color={colors.mutedForeground} />
                  <Text style={{ color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 12 }}>
                    {formatGameTime(data.startsAt)}
                  </Text>
                </View>
              ) : null}
            </View>
          </View>

          {/* SECTION_ORDER:3 both teams defensive matchup stats — team-wide only */}
          <Section title="DEFENSIVE MATCHUP · TEAM-WIDE">
            <Text style={{ color: colors.mutedForeground, fontFamily: FONT.body, fontSize: 11, marginBottom: 6 }}>
              Team-level rates below. Verified positional observations appear in player evidence when available; league rankings are not supplied.
            </Text>
            <DefenseBlock title={awayResolved?.name ?? awayTeam} rows={awayDefRows} loading={awayDefenseQ.isLoading} />
            <View style={{ height: 10 }} />
            <DefenseBlock title={homeResolved?.name ?? homeTeam} rows={homeDefRows} loading={homeDefenseQ.isLoading} />
          </Section>

          {/* SECTION_ORDER:4 top players by role — filters already above; empty/loading stay visible */}
          <Section title="TOP PLAYERS BY ROLE">
          {/* SECTION_ORDER:2 market/role filter chips — always near top */}
          <View style={{ gap: 8 }} testID="matchup-market-filters">
            <Text style={{ color: colors.mutedForeground, fontFamily: FONT.bold, fontSize: 11, letterSpacing: 0.8 }}>
              MARKET FILTERS
            </Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
              {filterChips.map((chip) => {
                const active = marketFilter === chip.key;
                return (
                  <Pressable
                    key={chip.key}
                    onPress={() => setMarketFilter(chip.key)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    style={{
                      paddingVertical: 7,
                      paddingHorizontal: 12,
                      borderRadius: 10,
                      borderWidth: 1,
                      borderColor: active ? colors.primary : colors.border,
                      backgroundColor: active ? colors.primary : colors.card,
                    }}
                  >
                    <Text
                      style={{
                        color: active ? colors.primaryForeground : colors.foreground,
                        fontFamily: FONT.bold,
                        fontSize: 12,
                      }}
                    >
                      {chip.label}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>


            <Text style={{ color: colors.mutedForeground, fontFamily: FONT.body, fontSize: 11, lineHeight: 16 }}>
              Top {MATCHUP_TOP_PER_ROLE} qualifying players per role from either side. Each card uses the opposing
              team’s defense. Verified positional observations are shown when available. Requires {MATCHUP_CONSIDER_MIN_SIMULATIONS.toLocaleString()}-sim
              exact-market evidence, ≥{GRADE_MIN_SAMPLE} history games, ≥52% simulated hit probability, positive edge,
              and a passing recent-form grade. Market groups are not verified roster positions. Grades describe recent hit rates, not simulation calibration.
            </Text>

            {considerEvalQ.isLoading || (eventPropsQ.isLoading && !eventPropsQ.isFetched) ? (
              <Text
                testID="matchup-players-loading"
                style={{ color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 13, marginTop: 4 }}
              >
                Evaluating posted props with deep simulation…
              </Text>
            ) : considerEvalQ.isError ? (
              <EmptyNote testID="matchup-players-error" text="Player analysis could not be completed. No recommendations available; close and reopen to retry." />
            ) : considerPicks.length === 0 ? (
              <EmptyNote
                testID="matchup-players-empty"
                text={considerEmpty || "No qualifying player props for this matchup."}
              />
            ) : filteredEmpty ? (
              <EmptyNote testID="matchup-players-filter-empty" text={filteredEmpty} />
            ) : (
              <View style={{ gap: 14, marginTop: 4 }} testID="matchup-players-list">
                {considerGroups.map((group) => (
                  <View key={group.roleKey} style={{ gap: 8 }}>
                    <Text style={{ color: colors.foreground, fontFamily: FONT.bold, fontSize: 13, letterSpacing: 0.3 }}>
                      {group.roleLabel.toUpperCase()}
                      <Text style={{ color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 11 }}>
                        {` · top ${group.picks.length}`}
                      </Text>
                    </Text>
                    {group.picks.map((pick) => (
                      <ConsiderPickCard
                        key={pick.key}
                        pick={pick}
                        gameLabel={gameLabel}
                        evidence={explainMatchup({
                          position: pick.positionVerified ? pick.position : null,
                          sport, athleteId: pick.athleteId, market: pick.marketKey, line: pick.line, side: pick.side,
                          history: pick.athleteId ? considerEvalQ.data?.histories[pick.athleteId] : null,
                          startsAt: data.startsAt, isHome: pick.teamSide === "home",
                          opponentId: pick.teamSide === "home" ? identityIds.awayTeamId : identityIds.homeTeamId,
                          opponentName: pick.oppName,
                          opponentDefense: pick.teamSide === "home" ? awayDefenseQ.data : homeDefenseQ.data,
                          simProbability: pick.simHitPct / 100, simSample: pick.sampleGames,
                        })}
                        onOpen={() => onOpenConsiderPick?.(pick, eventProps)}
                        canOpen={!!onOpenConsiderPick}
                      />
                    ))}
                  </View>
                ))}
              </View>
            )}
          </Section>

          {/* SECTION_ORDER:5 detailed form + recent-game history below players */}
          <Section title="BOTH TEAMS · RECENT FORM">
            <Text style={{ color: colors.mutedForeground, fontFamily: FONT.body, fontSize: 11, marginBottom: 4 }}>
              Source: ESPN team-history · timeframe: last-10 finals when available · sample sizes shown.
            </Text>
            <View style={{ flexDirection: "row", gap: 10 }}>
              <TeamFormCard form={awayForm} label="AWAY" logo={awayResolved?.logo} />
              <TeamFormCard form={homeForm} label="HOME" logo={homeResolved?.logo} />
            </View>
          </Section>

          <InjuryReport
            sport={sport}
            teams={[awayTeam, homeTeam]}
            title="INJURIES & AVAILABILITY"
            caption="ESPN injury feed · statuses only when verified for this matchup. Missing teams labeled unavailable."
            framing="matchup"
          />

          {loading ? (
            <Loading />
          ) : errored ? (
            <EmptyNote
              text={`We couldn't reach the real results feed for ${team} right now. Posted team totals above are still live when available.`}
            />
          ) : noData ? (
            <EmptyNote
              text={`We couldn't pull real recent results for ${team} in ${sportLabel} right now, so we're not estimating any numbers.`}
            />
          ) : (
            <>
              <View style={{ flexDirection: "row", gap: 10 }}>
                <MetricTile
                  icon="award"
                  label="RECORD"
                  value={history?.record.games ? `${history.record.wins}-${history.record.losses}` : "—"}
                  caption={history?.record.games ? sampleCaption(history.record.games) : "season unavailable"}
                  tint={colors.foreground}
                />
                <MetricTile
                  icon="trending-up"
                  label="LAST 10"
                  value={rec(history?.last10)}
                  caption={sampleCaption(history?.last10.games)}
                  tint={colors.foreground}
                />
                <MetricTile
                  icon="zap"
                  label="STREAK"
                  value={history?.streak ? `${history.streak.type}${history.streak.count}` : "—"}
                  caption={history?.streak ? "current" : "unavailable"}
                  tint={
                    history?.streak?.type === "W"
                      ? colors.success
                      : history?.streak?.type === "L"
                        ? colors.destructive
                        : colors.foreground
                  }
                />
              </View>

              <Section title={`FOCUS · ${nickname(team)} · LAST 10`}>
                <View style={{ gap: 0 }}>
                  <BreakdownRow
                    icon="activity"
                    label="Scoring margin"
                    sub={`${sampleCaption(history?.last10.games)} · ESPN finals`}
                    value={fmt1(history?.last10.avgMargin)}
                  />
                  <BreakdownRow
                    icon="arrow-up-circle"
                    label="Points per game"
                    sub={`${sampleCaption(history?.last10.games)} · scored · allowed`}
                    value={`${history?.last10.ptsFor?.toFixed(1) ?? "—"} · ${history?.last10.ptsAgainst?.toFixed(1) ?? "—"}`}
                  />
                  <BreakdownRow
                    icon="home"
                    label={data.isHome ? "Home form" : "Away form"}
                    sub={
                      split?.games
                        ? sampleCaption(split.games)
                        : `${data.isHome ? "Home" : "Away"} split unavailable`
                    }
                    value={rec(split)}
                    last
                  />
                </View>
              </Section>

              <Section title={`RECENT GAMES · MARGIN · n=${n}`}>
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
                </View>
              </Section>
            </>
          )}

          <Section title="WHAT YOU'RE STILL MISSING">
            <Text style={{ color: colors.mutedForeground, fontFamily: FONT.body, fontSize: 11, lineHeight: 16, marginBottom: 2 }}>
              Game-level context to research — guidance, not predictions.
            </Text>
            <FactorGrid factors={teamFactors} />
          </Section>
        </ScrollView>

      </View>
    </Modal>
  );
}

function ConsiderPickCard({
  pick,
  gameLabel,
  evidence,
  onOpen,
  canOpen,
}: {
  pick: ConsiderPick;
  gameLabel: string;
  evidence: ReturnType<typeof explainMatchup>;
  onOpen: () => void;
  canOpen: boolean;
}) {
  const colors = useColors();
  const [showEvidenceDetails, setShowEvidenceDetails] = useState(false);
  const posLabel = pick.positionVerified && pick.position
    ? pick.position
    : "Pos unavailable";
  const teamPos = `${nickname(pick.teamName)} · ${posLabel}${pick.positionVerified ? "" : " · unverified"}`;
  const quoteLabel = pick.quoteUpdatedAt
    ? `${pick.quoteStale ? "Stale quote · " : "Quoted · "}${formatGameTime(pick.quoteUpdatedAt) || pick.quoteUpdatedAt}`
    : "Quote time unavailable";
  const edgeLabel =
    pick.edgePct == null
      ? "Edge unavailable"
      : `Model vs price ${pick.edgePct > 0 ? "+" : ""}${pick.edgePct.toFixed(1)} pp`;
  const projLabel =
    pick.meanProjection == null ? "Proj unavailable" : `Proj ${pick.meanProjection.toFixed(1)}`;

  return (
    <View
      style={{
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: colors.radius,
        backgroundColor: colors.card,
        padding: 12,
        gap: 8,
      }}
    >
      <Pressable onPress={onOpen} disabled={!canOpen}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          {pick.headshot ? (
            <Image source={{ uri: pick.headshot }} style={{ width: 44, height: 44, borderRadius: 22 }} />
          ) : (
            <View
              style={{
                width: 44,
                height: 44,
                borderRadius: 22,
                backgroundColor: colors.surface,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Feather name="user" size={18} color={colors.mutedForeground} />
            </View>
          )}
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={{ color: colors.foreground, fontFamily: FONT.bold, fontSize: 15 }}>{pick.player}</Text>
            <Text style={{ color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 11 }}>
              {teamPos} · vs {nickname(pick.oppName)}
            </Text>
            <Text style={{ color: colors.foreground, fontFamily: FONT.semibold, fontSize: 12 }}>
              {pick.side} {pick.line} {pick.marketLabel}
              {pick.grade ? ` · Recent form ${pick.grade}` : " · grade unavailable"}
            </Text>
          </View>
          <View style={{ alignItems: "flex-end", gap: 2 }}>
            <Text style={{ color: colors.primary, fontFamily: FONT.display, fontSize: 14 }}>Exploratory</Text>
            <Text style={{ color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 10 }}>calibration unverified</Text>
          </View>
        </View>
      </Pressable>

      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        <MetaChip label={projLabel} />
        <MetaChip label={edgeLabel} />
        <MetaChip label={`${pick.simulations.toLocaleString()} sims · ${pick.sampleGames} simulation-history games`} />
      </View>

      <Text style={{ color: colors.mutedForeground, fontFamily: FONT.body, fontSize: 11, lineHeight: 15 }}>
        {pick.formSummary}
      </Text>
      <Text style={{ color: colors.mutedForeground, fontFamily: FONT.body, fontSize: 11, lineHeight: 15 }}>
        {evidence.opportunity.length ? evidence.opportunity.join(" ") : pick.opportunitySummary}
      </Text>
      <Text style={{ color: colors.mutedForeground, fontFamily: FONT.body, fontSize: 11, lineHeight: 15 }}>
        {evidence.positionContext ?? pick.defenseSummary}
      </Text>

      <View style={{ gap: 6 }}>
        <Text style={{ color: colors.foreground, fontFamily: FONT.bold, fontSize: 12 }}>WHY THIS MATCHUP</Text>
        {evidence.observations.slice(0, showEvidenceDetails ? undefined : 2).map((text, i) => <Text key={`e${i}`} style={{ color: colors.foreground, fontSize: 11 }}>{text}</Text>)}
        <Text style={{ color: colors.mutedForeground, fontSize: 11 }}>CAUTIONS</Text>
        {evidence.cautions.map((text, i) => <Text key={`c${i}`} style={{ color: colors.mutedForeground, fontSize: 11 }}>{text}</Text>)}
        <Pressable onPress={() => setShowEvidenceDetails(v => !v)} accessibilityRole="button" accessibilityState={{expanded:showEvidenceDetails}}>
          <Text style={{color:colors.primary,fontSize:12}}>{showEvidenceDetails ? "Hide evidence details" : `More evidence · ${evidence.missing.length} gaps`}</Text>
        </Pressable>
        {showEvidenceDetails && <>
        <Text style={{ color: colors.mutedForeground, fontSize: 11 }}>Raw simulation estimate: {pick.simHitPct}%. This is not a verified win probability. Model-vs-price edge is exploratory.</Text>
        <Text style={{ color: colors.mutedForeground, fontSize: 11 }}>MISSING EVIDENCE</Text>
        {evidence.missing.map((text, i) => <Text key={`m${i}`} style={{ color: colors.mutedForeground, fontSize: 11 }}>{text}</Text>)}
        <Text style={{ color: colors.mutedForeground, fontSize: 10 }}>{evidence.source}</Text>
        </>}
      </View>
      <Text style={{ color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 10 }}>
        {pick.sportsbook ? pick.sportsbook : "Sportsbook unavailable"}
        {" · "}
        {quoteLabel}
        {pick.altCount > 0 ? ` · ${pick.altCount} alt${pick.altCount === 1 ? "" : "s"} posted` : ""}
        {" · "}
        {gameLabel}
      </Text>


    </View>
  );
}

function MetaChip({ label }: { label: string }) {
  const colors = useColors();
  return (
    <View
      style={{
        paddingVertical: 4,
        paddingHorizontal: 8,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.surface,
      }}
    >
      <Text style={{ color: colors.foreground, fontFamily: FONT.medium, fontSize: 10 }}>{label}</Text>
    </View>
  );
}

function TeamFormCard({
  form,
  label,
  logo,
}: {
  form: ReturnType<typeof summarizeTeamForm>;
  label: string;
  logo?: string | null;
}) {
  const colors = useColors();
  return (
    <View
      style={{
        flex: 1,
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: colors.radius,
        backgroundColor: colors.card,
        padding: 10,
        gap: 6,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        {logo ? <Image source={{ uri: logo }} style={{ width: 22, height: 22 }} resizeMode="contain" /> : null}
        <Text style={{ color: colors.mutedForeground, fontFamily: FONT.bold, fontSize: 10 }}>{label}</Text>
      </View>
      <Text style={{ color: colors.foreground, fontFamily: FONT.semibold, fontSize: 13 }} numberOfLines={2}>
        {form.teamName || "—"}
      </Text>
      <Text style={{ color: colors.foreground, fontFamily: FONT.display, fontSize: 18 }}>
        {form.last10 ?? "—"}
      </Text>
      <Text style={{ color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 10 }}>
        L10 · {sampleCaption(form.last10Games)}
      </Text>
      <Text style={{ color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 10 }}>
        Home {form.homeSplit ?? "n/a"} ({sampleCaption(form.homeGames)})
      </Text>
      <Text style={{ color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 10 }}>
        Away {form.awaySplit ?? "n/a"} ({sampleCaption(form.awayGames)})
      </Text>
      <Text style={{ color: colors.mutedForeground, fontFamily: FONT.body, fontSize: 9 }}>
        {form.source}
      </Text>
    </View>
  );
}

function DefenseBlock({
  title,
  rows,
  loading,
}: {
  title: string;
  rows: ReturnType<typeof teamDefenseRows>;
  loading: boolean;
}) {
  const colors = useColors();
  if (loading) {
    return (
      <Text style={{ color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 12 }}>
        Loading defense for {title}…
      </Text>
    );
  }
  if (!rows.length) {
    return (
      <Text style={{ color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 12 }}>
        {title}: defensive rates unavailable — nothing estimated.
      </Text>
    );
  }
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ color: colors.foreground, fontFamily: FONT.bold, fontSize: 13 }}>{title}</Text>
      {rows.map((r) => (
        <View key={r.key} style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: colors.foreground, fontFamily: FONT.medium, fontSize: 12 }}>{r.label}</Text>
            <Text style={{ color: colors.mutedForeground, fontFamily: FONT.body, fontSize: 10 }}>
              {r.source} · {r.timeframe}
              {r.sampleSize != null ? ` · n=${r.sampleSize}` : ""} · scope: team
            </Text>
          </View>
          <Text style={{ color: colors.foreground, fontFamily: FONT.display, fontSize: 16 }}>{r.value}</Text>
        </View>
      ))}
    </View>
  );
}

function Badge({ text, tone }: { text: string; tone?: "success" }) {
  const colors = useColors();
  const color = tone === "success" ? colors.success : colors.mutedForeground;
  return (
    <View
      style={{
        paddingVertical: 4,
        paddingHorizontal: 10,
        borderRadius: 999,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.card,
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
      }}
    >
      {tone === "success" ? <Feather name="check-circle" size={11} color={color} /> : null}
      <Text style={{ color, fontFamily: FONT.bold, fontSize: 10, letterSpacing: 0.5 }}>{text}</Text>
    </View>
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

function EmptyNote({ text, testID }: { text: string; testID?: string }) {
  const colors = useColors();
  return (
    <View
      testID={testID}
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

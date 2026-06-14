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
import {
  getInjuries,
  getMlbBatterSplits,
  getMlbProbables,
  getOdds,
  getPlayerHistory,
  getProps,
  getTeamDefense,
  PROPS_SPORTS,
  searchTeam,
  type TeamDefense,
} from "@/lib/api";
import {
  findPlayerInjury,
  injuryTone,
  summarizeTeamInjuries,
  teamNameMatches,
} from "@/lib/injuries";
import { formatAmerican, formatGameTime } from "@/lib/format";
import { FactorGrid } from "@/components/FactorCards";
import { InjuryReport } from "@/components/InjuryReport";
import { ScoreBreakdown } from "@/components/ScoreBreakdown";
import {
  combinePickScore,
  injuryFavorProp,
  playerTrendMomentum,
  scoreInjury,
  scoreLineShopping,
  scoreLineValue,
  scoreTrend,
} from "@/lib/pickScore";
import { computeHrScore, hrScoreBand, type HrScore } from "@/lib/hrScore";
import { computeHrFlags, type HrFlags } from "@/lib/hrFlags";
import { factorsForProp, type RealPropSignals } from "@/lib/propFactors";
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

  // Resolve THIS prop's real +EV edge + line-shopping spread for the pick rubric.
  // The nav params don't carry them, so re-find the prop from the live feed:
  // getOdds → this game's event id → getProps → the matching player/line. Edge is
  // only valid on the server-flagged +EV side; spread is the side-specific value.
  // Fail-closed to null so the rubric honestly omits Line Value / Line-Shopping
  // when the prop can't be re-resolved.
  const propMetaQ = useQuery({
    queryKey: ["prop-meta", sport, game, player, marketKey, line, side],
    enabled: !!sport && !!game && !!player && PROPS_SPORTS.includes(sport),
    staleTime: 5 * 60_000,
    queryFn: async ({ signal }) => {
      const odds = await getOdds(sport, signal);
      const g = odds.find((o) => `${o.awayTeam} @ ${o.homeTeam}` === game);
      if (!g) return null;
      const res = await getProps(
        { sport, eventId: g.id, home: g.homeTeam, away: g.awayTeam },
        signal,
      );
      const match = res.props.find(
        (pr) =>
          pr.player === player &&
          pr.market === marketKey &&
          (line == null ? pr.line == null : pr.line === line),
      );
      if (!match) return null;
      return {
        edge: match.evSide === side ? (match.edge ?? null) : null,
        bookSpread: isUnder ? (match.underSpread ?? null) : (match.overSpread ?? null),
      };
    },
  });

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

  // Back nav that never throws "GO_BACK was not handled": when this screen was
  // opened cold (deep link / fresh stack) there's nothing to pop, so fall back
  // to the home tab instead of dispatching a GO_BACK no navigator can handle.
  const goBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace("/");
  };

  // --- Real availability + usage + matchup-defense signals (free ESPN feeds) ---

  // Player's REAL injury designation (status only — we never invent "impact").
  const injuriesQ = useQuery({
    queryKey: ["injuries", sport],
    enabled: !!sport,
    staleTime: 10 * 60_000,
    queryFn: ({ signal }) => getInjuries(sport, signal),
  });
  const injuryLookup = useMemo(
    () => findPlayerInjury(injuriesQ.data, player),
    [injuriesQ.data, player],
  );
  const playerInjury = injuryLookup.status === "found" ? injuryLookup.entry : null;

  // Recent minutes — a REAL workload/role read pulled straight from the game
  // log we already fetched. This is honest minutes, NOT a possession-based
  // usage rate (that needs team box-score totals we don't have for free).
  const usage = useMemo(() => {
    const labels = historyQ.data?.labels ?? [];
    const rows = historyQ.data?.recent ?? [];
    const minLabel = labels.find((l) => /^min(ute)?s?$/i.test(l.trim()));
    if (!minLabel) return null;
    const vals: number[] = [];
    for (const g of rows.slice(0, WINDOW)) {
      const raw = g.stats?.[minLabel];
      if (raw == null) continue;
      const m = String(raw).match(/^(\d+)(?::(\d+))?/);
      if (!m) continue;
      const v = Number(m[1]) + (m[2] ? Number(m[2]) / 60 : 0);
      if (Number.isFinite(v) && v > 0) vals.push(v);
    }
    if (vals.length === 0) return null;
    return { avg: Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10, n: vals.length };
  }, [historyQ.data]);

  // Both teams in this matchup, parsed from the "Away @ Home" label so we can
  // show each side's REAL season points-allowed without having to guess which
  // team the player is on.
  const [awayName, homeName] = useMemo(() => {
    const at = game.split(/\s+@\s+/);
    if (at.length === 2) return [at[0].trim(), at[1].trim()];
    const vs = game.split(/\s+vs\.?\s+/i);
    if (vs.length === 2) return [vs[0].trim(), vs[1].trim()];
    return ["", ""];
  }, [game]);

  const defenseQ = useQuery({
    queryKey: ["matchup-defense", sport, awayName, homeName],
    enabled: !!sport && !!awayName && !!homeName,
    staleTime: 30 * 60_000,
    queryFn: async ({ signal }) => {
      const resolveOne = async (name: string): Promise<{ name: string; def: TeamDefense } | null> => {
        const r = await searchTeam(name, signal);
        // Fail closed: require a same-sport hit, and prefer one whose name
        // actually matches — never silently fall back to an unrelated team.
        const sportHits = r.results.filter((t) => (t.sport ?? "") === sport);
        const hit = sportHits.find((t) => teamNameMatches(t.name, name)) ?? null;
        if (!hit) return null;
        const def = await getTeamDefense(sport, hit.teamId, signal);
        return { name: def.teamName ?? hit.name ?? name, def };
      };
      const [away, home] = await Promise.all([resolveOne(awayName), resolveOne(homeName)]);
      return { away, home };
    },
  });
  const defenseRows = useMemo(() => {
    const d = defenseQ.data;
    return [d?.away, d?.home].filter(
      (x): x is { name: string; def: TeamDefense } => !!x && x.def.avgPointsAgainst != null,
    );
  }, [defenseQ.data]);

  // Resolve which side of the matchup is the player's own team vs the opponent,
  // using ONLY real data: a player never appears as their own opponent, so the
  // team that shows up in their recent game-log opponents is the opponent and
  // the other side is their team. Fail closed (undefined) if it's not certain,
  // so the cards fall back to neutral wording rather than guessing.
  const { teamName, oppName } = useMemo(() => {
    const rows = historyQ.data?.recent ?? [];
    const opps = rows
      .map((r) => (r.opponentName ?? "").toLowerCase())
      .filter(Boolean);
    if (!awayName || !homeName || opps.length === 0) {
      return { teamName: undefined as string | undefined, oppName: undefined as string | undefined };
    }
    const nick = (n: string) => (n.toLowerCase().split(/\s+/).pop() ?? n.toLowerCase());
    const seen = (n: string) => {
      const k = nick(n);
      return !!k && opps.some((o) => o.includes(k));
    };
    const awayIsOpp = seen(awayName);
    const homeIsOpp = seen(homeName);
    if (awayIsOpp && !homeIsOpp) return { teamName: homeName, oppName: awayName };
    if (homeIsOpp && !awayIsOpp) return { teamName: awayName, oppName: homeName };
    return { teamName: undefined as string | undefined, oppName: undefined as string | undefined };
  }, [historyQ.data, awayName, homeName]);

  // REAL home/away split of THIS market's value, straight from the game log we
  // already loaded. Needs at least one game on each side or we leave it null and
  // the card falls back to generic guidance.
  const realHomeAway = useMemo(() => {
    const home = games.filter((g) => g.isHome === true).map((g) => g.value);
    const away = games.filter((g) => g.isHome === false).map((g) => g.value);
    if (home.length === 0 || away.length === 0) return null;
    const avg = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
    return { homeAvg: avg(home), awayAvg: avg(away), homeN: home.length, awayN: away.length };
  }, [games]);

  // REAL recent (this page's projection) vs season-long per-game average for the
  // same market. The season average is computed with the very same market→stat
  // resolver used per game, applied to the player's real season averages (avg of
  // a sum equals the sum of the averages, so combos/total-bases stay exact).
  const realRecentVsSeason = useMemo(() => {
    if (projection == null || n === 0) return null;
    const avgs = historyQ.data?.seasonSummary?.averages;
    if (!avgs) return null;
    const asStr: Record<string, string> = {};
    for (const [k, v] of Object.entries(avgs)) asStr[k] = String(v);
    const seasonAvg = gameValueForMarket(marketKey, asStr, ambiguous);
    if (seasonAvg == null) return null;
    return { recentAvg: projection, seasonAvg, recentN: n };
  }, [projection, n, historyQ.data, marketKey, ambiguous]);

  // MLB batter enrichment: the opposing probable starter, this batter's platoon
  // line vs that starter's hand, and the home ballpark + live weather. All real
  // ESPN data, resolved fail-closed (team-id misses leave a card generic).
  const mlbQ = useQuery({
    queryKey: ["mlb-prop-signals", athleteId, awayName, homeName],
    enabled: sport === "mlb" && !!athleteId && !!awayName && !!homeName,
    staleTime: 15 * 60_000,
    queryFn: async ({ signal }) => {
      const resolveTeamId = async (name: string): Promise<string | null> => {
        const r = await searchTeam(name, signal);
        const hits = r.results.filter((t) => (t.sport ?? "") === "mlb");
        return hits.find((t) => teamNameMatches(t.name, name))?.teamId ?? null;
      };
      const [awayId, homeId, probRes, splits] = await Promise.all([
        resolveTeamId(awayName),
        resolveTeamId(homeName),
        getMlbProbables(signal).catch(() => ({ probables: {} } as Awaited<ReturnType<typeof getMlbProbables>>)),
        getMlbBatterSplits(athleteId, signal).catch(() => null),
      ]);
      return { awayId, homeId, probRes, splits };
    },
  });

  // Assemble the REAL MLB signal block from the resolved feeds (batter only —
  // pitcher props don't face an "opposing starter"). Everything here is a real
  // recorded value; any gap stays null so the card degrades to honest guidance.
  const realMlb = useMemo<RealPropSignals["mlb"]>(() => {
    if (sport !== "mlb") return null;
    const d = mlbQ.data;
    if (!d) return null;
    const nick = (s: string) => s.toLowerCase().split(/\s+/).pop() ?? s.toLowerCase();
    // The pitcher this batter faces is the OPPONENT team's probable starter.
    // Map the (already fail-closed) opponent name back to its resolved team id,
    // but require EXACTLY ONE side to match so a shared nickname (Red Sox vs
    // White Sox) never mis-attributes the pitcher — fall back to generic.
    let oppId: string | null = null;
    if (oppName) {
      const on = nick(oppName);
      const homeMatch = !!homeName && nick(homeName) === on;
      const awayMatch = !!awayName && nick(awayName) === on;
      if (homeMatch && !awayMatch) oppId = d.homeId;
      else if (awayMatch && !homeMatch) oppId = d.awayId;
    }
    const praw = oppId ? d.probRes.probables[oppId] : null;
    const throws: "L" | "R" | null = praw?.throws === "Left" ? "L" : praw?.throws === "Right" ? "R" : null;
    const pitcher = praw?.name
      ? {
          name: praw.name,
          throws,
          kPer9: praw.tendency?.kPer9 ?? null,
          era: praw.tendency?.era ?? null,
          hrPer9: praw.tendency?.hrPer9 ?? null,
          oppOPS: praw.tendency?.oppOPS ?? null,
          whip: praw.tendency?.whip ?? null,
          flyBallPct: praw.tendency?.flyBallPct ?? null,
          barrelPctAllowed: praw.tendency?.barrelPctAllowed ?? null,
          hardHitPctAllowed: praw.tendency?.hardHitPctAllowed ?? null,
          battedBallEvents: praw.tendency?.battedBallEvents ?? null,
        }
      : null;

    // Platoon line vs the starter's hand (only meaningful once we know the hand).
    let platoon: NonNullable<RealPropSignals["mlb"]>["platoon"] = null;
    if (d.splits && throws) {
      const bats: "L" | "R" | "S" | null =
        d.splits.bats === "Left" ? "L" : d.splits.bats === "Right" ? "R" : d.splits.bats === "Switch" ? "S" : null;
      const sideMap = throws === "R" ? d.splits.vsRight : d.splits.vsLeft;
      const avg = sideMap?.["AVG"] ?? null;
      const ops = sideMap?.["OPS"] ?? null;
      if (avg != null || ops != null) platoon = { bats, hand: throws, avg, ops };
    }

    // Ballpark + weather is keyed by the HOME team and is side-independent.
    const env = d.homeId ? d.probRes.games?.[d.homeId] ?? null : null;
    let ballpark: NonNullable<RealPropSignals["mlb"]>["ballpark"] = null;
    if (env && (env.venue || env.park)) {
      ballpark = {
        venue: env.venue,
        hrIndex: env.park?.hrIndex ?? null,
        dome: env.park?.dome ?? false,
        tempF: env.weather?.tempF ?? null,
        windMph: env.weather?.windMph ?? null,
        condition: env.weather?.condition ?? null,
      };
    }

    if (!pitcher && !platoon && !ballpark) return null;
    return { pitcher, platoon, ballpark };
  }, [sport, mlbQ.data, oppName, homeName, awayName]);

  // The OPPONENT's REAL team-wide defense (blocks/steals/sacks/INT/save% etc.),
  // pulled from the team-defense pack we already fetched. oppName is fail-closed
  // and is always exactly the away or home side, so we pick that side's pack —
  // never guess. Everything stays a real recorded number; gaps drop to null and
  // the matchup card falls back to honest generic guidance. This is TEAM-WIDE
  // production, never a positional "allows X to this player" split (ESPN has none).
  const realOppDefense = useMemo<RealPropSignals["oppDefense"]>(() => {
    const d = defenseQ.data;
    if (!d || !oppName) return null;
    const side = oppName === awayName ? d.away : oppName === homeName ? d.home : null;
    if (!side) return null;
    const def = side.def;
    const num = (k: string) => def.defensive[k]?.value ?? null;
    const od = {
      team: def.teamName ?? side.name,
      pointsAgainst: def.avgPointsAgainst,
      blocks: num("avgBlocks"),
      steals: num("avgSteals"),
      defRebounds: num("avgDefensiveRebounds"),
      sacks: num("sacks"),
      interceptions: num("interceptions"),
      passesDefended: num("passesDefended"),
      stuffs: num("stuffs"),
      savePct: num("savePct"),
      goalsAgainstAvg: num("goalsAgainstAverage"),
      cleanSheets: num("cleanSheets"),
    };
    // Only surface when at least one real number landed.
    const hasAny = Object.entries(od).some(([k, v]) => k !== "team" && v != null);
    return hasAny ? od : null;
  }, [defenseQ.data, oppName, awayName, homeName]);

  // Market-aware "things to weigh before betting" cards, tailored to the sport
  // (batter vs pitcher for MLB; per-market for basketball) and personalized with
  // the REAL player and team names. Cards render real numbers when the signals
  // above are present and fall back to honest guidance when they aren't.
  const real = useMemo<RealPropSignals>(
    () => ({ homeAway: realHomeAway, recentVsSeason: realRecentVsSeason, mlb: realMlb, oppDefense: realOppDefense }),
    [realHomeAway, realRecentVsSeason, realMlb, realOppDefense],
  );
  const factors = useMemo(
    () => factorsForProp({ sport, marketKey, marketLabel, playerName: player, teamName, oppName, real }),
    [sport, marketKey, marketLabel, player, teamName, oppName, real],
  );

  // HR TARGET SCORE — only for MLB batter home-run props. A weighted blend of the
  // REAL signals already resolved in realMlb (opposing starter HR/9 + Statcast
  // contact-quality allowed + fly-ball rate, ballpark HR index + weather, platoon
  // OPS vs the starter's hand). The module renormalizes over only the factors that
  // are actually present, so missing inputs are dropped — never guessed.
  const isHrMarket = sport === "mlb" && (/home_?run/i.test(marketKey) || /home run/i.test(marketLabel));
  const hrScore = useMemo<HrScore | null>(() => {
    if (!isHrMarket) return null;
    const m = realMlb;
    if (!m) return null;
    const s = computeHrScore({
      hrPer9: m.pitcher?.hrPer9 ?? null,
      barrelPctAllowed: m.pitcher?.barrelPctAllowed ?? null,
      hardHitPctAllowed: m.pitcher?.hardHitPctAllowed ?? null,
      battedBallEvents: m.pitcher?.battedBallEvents ?? null,
      flyBallPct: m.pitcher?.flyBallPct ?? null,
      hrIndex: m.ballpark?.hrIndex ?? null,
      tempF: m.ballpark?.tempF ?? null,
      dome: m.ballpark?.dome ?? null,
      platoonOps: m.platoon?.ops ?? null,
    });
    return s.score == null ? null : s;
  }, [isHrMarket, realMlb]);

  // HR GREEN / RED FLAGS — a scannable checklist mirroring the user's HR rubric,
  // lit only from the SAME real signals as the score. Wind out/in flags can't be
  // judged (feed has no wind direction) and are omitted with a note.
  const hrFlags = useMemo<HrFlags | null>(() => {
    if (!isHrMarket) return null;
    const m = realMlb;
    if (!m) return null;
    const f = computeHrFlags({
      hrPer9: m.pitcher?.hrPer9 ?? null,
      oppOPS: m.pitcher?.oppOPS ?? null,
      flyBallPct: m.pitcher?.flyBallPct ?? null,
      kPer9: m.pitcher?.kPer9 ?? null,
      hardHitPctAllowed: m.pitcher?.hardHitPctAllowed ?? null,
      barrelPctAllowed: m.pitcher?.barrelPctAllowed ?? null,
      battedBallEvents: m.pitcher?.battedBallEvents ?? null,
      batterHand: m.platoon?.bats ?? null,
      pitcherThrows: m.pitcher?.throws ?? null,
      hrIndex: m.ballpark?.hrIndex ?? null,
      venue: m.ballpark?.venue ?? null,
      tempF: m.ballpark?.tempF ?? null,
      dome: m.ballpark?.dome ?? null,
    });
    // Nothing to show if no real flag lit AND no wind note to surface.
    return f.green.length === 0 && f.red.length === 0 && !f.windOmitted ? null : f;
  }, [isHrMarket, realMlb]);

  const injTone = playerInjury ? injuryTone(playerInjury.status) : "ok";
  const toneColor =
    injTone === "out" ? colors.destructive : injTone === "doubt" ? colors.warning : colors.success;

  // The 5-component pick rubric for THIS prop, every sub-score real-or-null:
  //  • Trend       — this player's recent hit-rate vs the line, for the picked side
  //  • Line Value  — the prop's real +EV edge (only on the flagged value side)
  //  • Line-Shop   — the side's best-vs-median book spread
  //  • Injury      — how banged-up the opponent is (gentle; Over benefits)
  //  • Matchup     — null on a prop card (no team moneyline lean applies)
  const propScore = useMemo(() => {
    const trend = scoreTrend(
      playerTrendMomentum(games.map((g) => g.value), line, side),
    );
    const edgePct = propMetaQ.data?.edge ?? null;
    const lineValue = scoreLineValue(edgePct);
    const lineShopping = scoreLineShopping(propMetaQ.data?.bookSpread ?? null);
    let injury = null;
    if (oppName && injuriesQ.data) {
      const oppTeam = injuriesQ.data.find((t) => teamNameMatches(t.team, oppName));
      if (oppTeam) {
        injury = scoreInjury(
          injuryFavorProp(summarizeTeamInjuries(sport, oppTeam).highCount, side),
        );
      }
    }
    return combinePickScore(
      { matchup: null, trend, lineValue, injury, lineShopping },
      edgePct,
      odds,
    );
  }, [games, line, side, propMetaQ.data, oppName, injuriesQ.data, sport, odds]);

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

        {/* Availability & usage — REAL ESPN injury designation + recent minutes */}
        <Section title="AVAILABILITY & USAGE">
          <View style={{ gap: 0 }}>
            {injuriesQ.isLoading ? (
              <BreakdownRow
                icon="activity"
                label="Injury status"
                sub="Checking the ESPN injury report…"
                value="…"
                last={!usage}
              />
            ) : playerInjury ? (
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 10,
                  paddingVertical: 10,
                  borderBottomWidth: usage ? 1 : 0,
                  borderBottomColor: colors.border,
                }}
              >
                <Feather name="alert-triangle" size={16} color={toneColor} />
                <View style={{ flex: 1 }}>
                  <Text style={{ color: colors.foreground, fontFamily: FONT.bold, fontSize: 13 }}>
                    {playerInjury.status}
                  </Text>
                  <Text
                    style={{ color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 11 }}
                    numberOfLines={3}
                  >
                    {playerInjury.position ? `${playerInjury.position} · ` : ""}
                    {playerInjury.description}
                  </Text>
                </View>
              </View>
            ) : injuriesQ.isError ? (
              <BreakdownRow
                icon="info"
                label="Injury status unavailable"
                sub="Couldn't reach the ESPN injury report"
                value="—"
                last={!usage}
              />
            ) : injuryLookup.status === "ambiguous" ? (
              <BreakdownRow
                icon="info"
                label="Injury status unavailable"
                sub="More than one player shares this name — not shown to avoid a wrong match"
                value="—"
                last={!usage}
              />
            ) : (
              <BreakdownRow
                icon="check-circle"
                label="Not on the injury report"
                sub="ESPN lists no active designation for this player"
                value="OK"
                last={!usage}
              />
            )}
            {usage ? (
              <BreakdownRow
                icon="clock"
                label="Recent minutes"
                sub={`Real average, last ${usage.n} games`}
                value={usage.avg.toFixed(1)}
                last
              />
            ) : null}
          </View>
        </Section>

        {/* Matchup defense — REAL season points-allowed for both sides */}
        {defenseRows.length > 0 ? (
          <Section title="MATCHUP DEFENSE">
            <View style={{ gap: 0 }}>
              {defenseRows.map((r, i) => (
                <BreakdownRow
                  key={r.name}
                  icon="shield"
                  label={r.def.teamName ?? r.name}
                  sub="Points allowed per game (season)"
                  value={r.def.avgPointsAgainst!.toFixed(1)}
                  last={i === defenseRows.length - 1}
                />
              ))}
            </View>
            <Text style={{ color: colors.mutedForeground, fontFamily: FONT.body, fontSize: 11 }}>
              Team-wide scoring allowed — a real season rate, not a position-specific matchup.
            </Text>
          </Section>
        ) : null}

        {/* The injured opponents this player is facing — real ESPN report for
            the OTHER side only. oppName is fail-closed, so this shows only when
            we're certain which team is the opponent. */}
        {oppName ? (
          <InjuryReport
            sport={sport}
            teams={[oppName]}
            title="INJURIES YOU'RE FACING"
            caption={`Who's banged up on ${oppName} for ${player}'s ${marketLabel.toLowerCase()}. Key absences can shift this matchup.`}
            framing="facing"
          />
        ) : null}

        {/* Pick rubric — the 5-component grade for this prop, real-or-null. Shown
            only when at least one signal is groundable. */}
        {propScore.composite != null ? (
          <Section title="PICK GRADE">
            <ScoreBreakdown data={propScore} variant="full" />
          </Section>
        ) : null}

        {/* HR Target Score — MLB batter home-run props only, real-data blend */}
        {hrScore ? <HrTargetScoreCard data={hrScore} /> : null}

        {/* HR Green/Red Flags — the rubric checklist (real-data only). Rendered
            independently of the score so it still shows in the rare case where no
            weighted-score factor is present but a flag is computable. */}
        {hrFlags ? <HrFlagsCard flags={hrFlags} /> : null}

        {/* Factors to weigh — real numbers where we have them, else what to check */}
        <Section title="FACTORS TO WEIGH">
          <Text style={{ color: colors.mutedForeground, fontFamily: FONT.body, fontSize: 11, lineHeight: 16, marginBottom: 2 }}>
            Real numbers where we have the data — plus what to still check yourself before betting.
          </Text>
          <FactorGrid factors={factors} />
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

// HR TARGET SCORE card — a 0..100 weighted blend of the REAL HR-favorability
// signals we resolved for this batter's matchup. Shows the headline score + band,
// every present factor with its real value, weight share and 0..1 favorability
// bar, and an honest list of any factor we didn't have the data for.
function HrTargetScoreCard({ data }: { data: HrScore }) {
  const colors = useColors();
  const score = data.score ?? 0;
  const band = hrScoreBand(score);
  const tone =
    band.tone === "hot"
      ? colors.success
      : band.tone === "warm"
        ? colors.warning
        : band.tone === "cold"
          ? colors.destructive
          : colors.primary;
  const present = data.factors.filter((f) => f.sub != null);
  const excluded = data.factors.filter((f) => f.sub == null);
  return (
    <View
      style={{
        backgroundColor: colors.surface,
        borderColor: tone,
        borderWidth: 1,
        borderRadius: colors.radius,
        padding: 14,
        gap: 12,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <View style={{ gap: 2, flex: 1 }}>
          <Text style={{ color: colors.mutedForeground, fontFamily: FONT.bold, fontSize: 11, letterSpacing: 0.8 }}>
            HR TARGET SCORE
          </Text>
          <Text style={{ color: tone, fontFamily: FONT.bold, fontSize: 13 }}>{band.label}</Text>
        </View>
        <View style={{ alignItems: "flex-end" }}>
          <Text style={{ color: tone, fontFamily: FONT.display, fontSize: 30, lineHeight: 32 }}>{score}</Text>
          <Text style={{ color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 10 }}>out of 100</Text>
        </View>
      </View>

      <Text style={{ color: colors.mutedForeground, fontFamily: FONT.body, fontSize: 11, lineHeight: 16 }}>
        A weighted blend of the real matchup signals we have — scored only on the {data.presentCount}{" "}
        factor{data.presentCount === 1 ? "" : "s"} with data, never on guesses.
      </Text>

      <View style={{ gap: 9 }}>
        {present.map((f) => {
          const pct = Math.round((f.sub ?? 0) * 100);
          return (
            <View key={f.key} style={{ gap: 4 }}>
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                <Text style={{ color: colors.foreground, fontFamily: FONT.semibold, fontSize: 12 }}>
                  {f.label}
                  <Text style={{ color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 11 }}>
                    {"  "}
                    {Math.round(f.weightShare ?? 0)}%
                  </Text>
                </Text>
                <Text style={{ color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 11 }}>{f.display}</Text>
              </View>
              <View style={{ height: 6, borderRadius: 3, backgroundColor: colors.muted, overflow: "hidden" }}>
                <View style={{ width: `${pct}%`, height: "100%", borderRadius: 3, backgroundColor: tone }} />
              </View>
            </View>
          );
        })}
      </View>

      {excluded.length ? (
        <Text style={{ color: colors.mutedForeground, fontFamily: FONT.body, fontSize: 10, lineHeight: 15 }}>
          Not in tonight's feed (excluded, not estimated): {excluded.map((f) => f.label).join(", ")}.
        </Text>
      ) : null}
    </View>
  );
}

// HR GREEN / RED FLAGS card — a scannable checklist mirroring the user's HR
// rubric. A flag lights ONLY when tonight's REAL data crosses the threshold;
// a value between green/red thresholds lights nothing, and any missing datum is
// silently skipped (never guessed). Rendered on its own so it shows even when
// the weighted HR Target Score has no present factors.
function HrFlagsCard({ flags }: { flags: HrFlags }) {
  const colors = useColors();
  const hasFlags = flags.green.length > 0 || flags.red.length > 0;
  return (
    <View
      style={{
        backgroundColor: colors.card,
        borderColor: colors.border,
        borderWidth: 1,
        borderRadius: 14,
        padding: 14,
        gap: 10,
        marginBottom: 16,
      }}
    >
      <Text style={{ color: colors.mutedForeground, fontFamily: FONT.bold, fontSize: 11, letterSpacing: 0.8 }}>
        HR GREEN / RED FLAGS
      </Text>
      <Text style={{ color: colors.mutedForeground, fontFamily: FONT.body, fontSize: 11, lineHeight: 16 }}>
        Real matchup conditions for this home-run spot — a flag lights only when tonight's data crosses the threshold,
        never on a guess.
      </Text>
      {flags.green.map((fl) => (
        <FlagRow key={fl.key} tone={colors.success} icon="check-circle" label={fl.label} value={fl.value} />
      ))}
      {flags.red.map((fl) => (
        <FlagRow key={fl.key} tone={colors.destructive} icon="alert-circle" label={fl.label} value={fl.value} />
      ))}
      {!hasFlags ? (
        <Text style={{ color: colors.mutedForeground, fontFamily: FONT.body, fontSize: 11, lineHeight: 16 }}>
          No strong green or red HR flags in tonight's data — a neutral spot.
        </Text>
      ) : null}
      {flags.windOmitted ? (
        <Text style={{ color: colors.mutedForeground, fontFamily: FONT.body, fontSize: 10, lineHeight: 15 }}>
          Wind direction isn't in our feed, so the "wind blowing out/in" flags are omitted (never guessed).
        </Text>
      ) : null}
    </View>
  );
}

// One green/red HR flag line: a colored icon, the rubric label, and the REAL
// value that lit it.
function FlagRow({
  tone,
  icon,
  label,
  value,
}: {
  tone: string;
  icon: keyof typeof Feather.glyphMap;
  label: string;
  value: string;
}) {
  const colors = useColors();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
      <Feather name={icon} size={14} color={tone} />
      <Text style={{ color: colors.foreground, fontFamily: FONT.semibold, fontSize: 12, flex: 1 }}>{label}</Text>
      <Text style={{ color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 11 }}>{value}</Text>
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


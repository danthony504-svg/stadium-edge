import { Feather } from "@expo/vector-icons";
import { useQueries, useQuery } from "@tanstack/react-query";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Image,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { GameCard } from "@/components/GameCard";
import { PickCard, type ParsedPick } from "@/components/PickCard";
import { Avatar, PropRow } from "@/components/PlayerPropRow";
import { PlayerPropsSheet, type PlayerSheetData } from "@/components/PlayerPropsSheet";
import { useSlipClearance } from "@/components/SlipBar";
import { TeamPropsSheet, type TeamSheetData } from "@/components/TeamPropsSheet";
import { EmptyState, ErrorState, FONT, Loading, Pill } from "@/components/ui";
import { useColors } from "@/hooks/useColors";
import {
  fetchUpsetSpots,
  getGames,
  getOdds,
  getPlayerHistory,
  getProps,
  isPickable,
  propMarketLabel,
  PROPS_SPORTS,
  type EspnGame,
  type OddsGame,
  type PlayerProp,
} from "@/lib/api";
import { formatAmerican } from "@/lib/format";
import { computeAmbiguous, gameValueForMarket } from "@/lib/propStats";
import { SPORTS } from "@/lib/sports";

const nickname = (full: string) => (full || "").split(/\s+/).filter(Boolean).pop() || full;

// Sports we list on this tab that have NO player-prop feed (individual sports the
// books price moneyline-only). They still get a REAL posted-matches list here —
// the prop rails stay empty (honest) and tapping a match opens full odds.
const BROWSE_ONLY_SPORTS = ["tennis"];

// How many of the soonest pickable games to pull props for. Each game is a
// separate Odds API request; the props route allows 120/min and caches 5min,
// so a dozen is comfortable and keeps the screen responsive.
const MAX_GAMES = 12;

// AI RECOMMENDED grading. The "AI grade" is NOT a fabricated model rating (the
// app has no edge/confidence feed) — it's a transparent letter derived ONLY from
// how often the player has cleared THIS posted line in their real recent games.
const GRADE_WINDOW = 10; // most-recent real games read for the hit-rate
const GRADE_MIN_SAMPLE = 5; // need at least this many real games to grade at all
const GRADE_POOL = 12; // candidate players we pull game logs for per sport
const REC_CAP = 6; // cards shown in the rail

// VALUE (+EV) rail. A prop is "mispriced" when the best posted price beats the
// de-vigged CROSS-BOOK consensus fair value — the server computes this (ev/edge/
// fairProb on main lines quoted by enough books) and we NEVER recompute or guess
// it client-side. Surface only props clearing a small positive-EV bar so the rail
// is genuinely "value", not noise; empty (hidden) when nothing qualifies.
const MIN_VALUE_EV = 1.5; // EV % floor to show a prop in the value rail
const VALUE_CAP = 8; // cards shown in the value rail

type Grade = "A+" | "A" | "A-";
// Map a real hit-rate (cleared / sample) to a letter. Below A- we don't grade.
function gradeFromHitPct(pct: number): Grade | null {
  if (pct >= 80) return "A+";
  if (pct >= 70) return "A";
  if (pct >= 60) return "A-";
  return null;
}

type RecBadge = { text: string; caption?: string; tone: "grade" | "upset" };

type TeamInfo = {
  homeTeamId: string | null;
  awayTeamId: string | null;
  homeAbbr: string | null;
  awayAbbr: string | null;
};

function buildIdMap(games: EspnGame[]): Map<string, TeamInfo> {
  const map = new Map<string, TeamInfo>();
  for (const g of games) {
    const home = g.homeTeam || g.homeAbbr || "";
    const away = g.awayTeam || g.awayAbbr || "";
    if (!home || !away) continue;
    map.set(`${nickname(away)}|${nickname(home)}`.toLowerCase(), {
      homeTeamId: g.homeTeamId ?? null,
      awayTeamId: g.awayTeamId ?? null,
      homeAbbr: g.homeAbbr ?? null,
      awayAbbr: g.awayAbbr ?? null,
    });
  }
  return map;
}

type GameProps = {
  gameLabel: string;
  startsAt: string;
  // Which league this game belongs to — lets cross-sport search route a tapped
  // result to the right sport's sheets even when it isn't the selected pill.
  sport: string;
  // Main lines only — one row per (player, market) for the list/search/count.
  props: PlayerProp[];
  // Mains + alternate-ladder rungs — used by the per-row "alt lines" expander
  // and passed to the props sheet so it can price any real rung.
  allProps: PlayerProp[];
  teams: TeamInfo | null;
};

// Resolve a player's team abbreviation from their playerTeamId against the
// game's home/away team ids. Null when ids don't resolve (honest, no guess).
function teamAbbrFor(prop: PlayerProp, teams: TeamInfo | null): string | null {
  if (!teams || !prop.playerTeamId) return null;
  if (prop.playerTeamId === teams.homeTeamId) return teams.homeAbbr;
  if (prop.playerTeamId === teams.awayTeamId) return teams.awayAbbr;
  return null;
}

// Pick the side to recommend for a prop from its REAL posted prices only.
// When both sides are priced, take the higher American number (the shorter-juice
// / better-return side) — a transparent rule, never a fabricated lean. Yes/no
// markets (line null) only carry an Over/"Yes" price, so that side is used.
// Returns null when no real price exists (nothing to honestly recommend).
function recommendSide(p: PlayerProp): { side: "Over" | "Under"; price: number } | null {
  const o = p.overPrice;
  const u = p.underPrice;
  if (o != null && u != null) return o >= u ? { side: "Over", price: o } : { side: "Under", price: u };
  if (o != null) return { side: "Over", price: o };
  if (u != null) return { side: "Under", price: u };
  return null;
}

// Fetch odds (for the pickable game list + Odds API event ids) and ESPN games
// (for team ids → headshots), then pull player props per game.
async function fetchAllProps(sport: string, signal?: AbortSignal): Promise<GameProps[]> {
  const [odds, games] = await Promise.all([
    getOdds(sport, signal),
    getGames(sport, signal).catch(() => [] as EspnGame[]),
  ]);
  const idMap = buildIdMap(games);
  // Soccer (World Cup) is a tournament: books post real player props days before
  // kickoff, but matches cluster outside the usual 48h pickable window. Widen the
  // look-ahead for soccer so those real props surface; other sports keep 48h.
  const HORIZON_H = sport === "soccer" ? 14 * 24 : 48;
  const now = Date.now();
  const inWindow = (iso?: string | null): boolean => {
    if (!iso) return false;
    const t = Date.parse(iso);
    if (Number.isNaN(t)) return false;
    return t > now - 4 * 3600_000 && t < now + HORIZON_H * 3600_000;
  };
  const pickable = odds
    .filter((g) => inWindow(g.commenceTime))
    .sort((a, b) => Date.parse(a.commenceTime) - Date.parse(b.commenceTime))
    .slice(0, MAX_GAMES);

  let failures = 0;
  const results = await Promise.all(
    pickable.map(async (g): Promise<GameProps> => {
      const ids = idMap.get(`${nickname(g.awayTeam)}|${nickname(g.homeTeam)}`.toLowerCase()) ?? null;
      try {
        const r = await getProps(
          {
            sport,
            eventId: g.id,
            home: g.homeTeam,
            away: g.awayTeam,
            homeTeamId: ids?.homeTeamId,
            awayTeamId: ids?.awayTeamId,
          },
          signal,
        );
        // Keep every priced line. Mains drive the list rows (one per player +
        // market); the full set (incl. alternate rungs) feeds the per-row alt
        // expander and the props sheet.
        const all = (r.props ?? []).filter((p) => p.overPrice != null || p.underPrice != null);
        const mains = all.filter((p) => !p.alt);
        return { gameLabel: `${g.awayTeam} @ ${g.homeTeam}`, startsAt: g.commenceTime, sport, props: mains, allProps: all, teams: ids };
      } catch {
        failures += 1;
        return { gameLabel: `${g.awayTeam} @ ${g.homeTeam}`, startsAt: g.commenceTime, sport, props: [], allProps: [], teams: ids };
      }
    }),
  );
  // Honest failure surfacing: if there were pickable games but EVERY props
  // request failed, this is a data-unavailable error, not an empty slate —
  // throw so the UI shows the retryable ErrorState instead of "no props".
  if (pickable.length > 0 && failures === pickable.length) {
    throw new Error("All player-prop requests failed");
  }
  return results.filter((r) => r.props.length > 0);
}

// Compact search result: one tappable row per player (name + how many markets
// they have in this game). Tapping opens the full props sheet — we don't dump
// every prop line inline. Used only while a search query is active.
function PlayerResultRow({
  prop,
  marketCount,
  onOpen,
}: {
  prop: PlayerProp;
  marketCount: number;
  onOpen: () => void;
}) {
  const colors = useColors();
  return (
    <Pressable
      onPress={onOpen}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        backgroundColor: colors.card,
        borderColor: colors.border,
        borderWidth: 1,
        borderRadius: colors.radius,
        padding: 12,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <Avatar headshot={prop.headshot} name={prop.player} />
      <View style={{ flex: 1 }}>
        <Text style={{ color: colors.foreground, fontFamily: FONT.semibold, fontSize: 14 }} numberOfLines={1}>
          {prop.player}
        </Text>
        <Text style={{ color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 12, marginTop: 1 }}>
          {marketCount} market{marketCount === 1 ? "" : "s"} · tap to view
        </Text>
      </View>
      <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
    </Pressable>
  );
}

// Section header used in the search results to separate teams from players.
function SearchSectionLabel({ children }: { children: React.ReactNode }) {
  const colors = useColors();
  return (
    <Text
      style={{
        color: colors.mutedForeground,
        fontFamily: FONT.bold,
        fontSize: 11,
        letterSpacing: 1,
        textTransform: "uppercase",
        marginTop: 2,
      }}
    >
      {children}
    </Text>
  );
}

// A tappable team search hit → opens the team-props sheet. Used only while a
// search query is active.
function TeamResultRow({
  team,
  opp,
  isHome,
  onOpen,
}: {
  team: string;
  opp: string;
  isHome: boolean;
  onOpen: () => void;
}) {
  const colors = useColors();
  const code = (team.split(/\s+/).filter(Boolean).pop() ?? team).slice(0, 3).toUpperCase();
  return (
    <Pressable
      onPress={onOpen}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        backgroundColor: colors.card,
        borderColor: colors.border,
        borderWidth: 1,
        borderRadius: colors.radius,
        padding: 12,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <View
        style={{
          width: 38,
          height: 38,
          borderRadius: 19,
          backgroundColor: colors.surface,
          borderWidth: 1,
          borderColor: colors.border,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Text style={{ color: colors.mutedForeground, fontFamily: FONT.bold, fontSize: 12 }}>{code}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ color: colors.foreground, fontFamily: FONT.semibold, fontSize: 14 }} numberOfLines={1}>
          {team}
        </Text>
        <Text style={{ color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 12, marginTop: 1 }}>
          {isHome ? "Home" : "Away"} vs {opp.split(/\s+/).filter(Boolean).pop() ?? opp} · tap to view
        </Text>
      </View>
      <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
    </Pressable>
  );
}

export default function PropsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const slipClearance = useSlipClearance();
  const router = useRouter();
  const params = useLocalSearchParams<{ q?: string; sp?: string }>();
  const [sport, setSport] = useState(
    params.sp && PROPS_SPORTS.includes(String(params.sp)) ? String(params.sp) : PROPS_SPORTS[0],
  );
  const [query, setQuery] = useState(params.q ? String(params.q) : "");
  const [sheet, setSheet] = useState<PlayerSheetData | null>(null);
  const [teamSheet, setTeamSheet] = useState<TeamSheetData | null>(null);
  // When the player sheet sends the user to the full-breakdown route we HIDE it
  // (keep its state) rather than closing it, then restore it whenever this
  // screen regains focus — so pressing back on the breakdown lands on the sheet.
  const [sheetHidden, setSheetHidden] = useState(false);
  useFocusEffect(
    useCallback(() => {
      setSheetHidden(false);
    }, []),
  );

  // Open the player-props detail seeded to the tapped market, gathering every
  // market that player has in this game (for the metric pills + lines list).
  const openSheet = (g: GameProps, prop: PlayerProp) => {
    const playerProps = g.allProps.filter((p) => p.player === prop.player);
    setSheet({
      player: prop.player,
      athleteId: prop.athleteId ?? null,
      headshot: prop.headshot ?? null,
      playerTeamId: prop.playerTeamId ?? null,
      teamAbbr: teamAbbrFor(prop, g.teams),
      sport: g.sport,
      gameLabel: g.gameLabel,
      startsAt: g.startsAt,
      initialMarket: prop.market,
      props: playerProps,
    });
  };

  // Open the team-props sheet from a team search hit. We carry only the team
  // names + game context; the sheet fetches everything it shows from real feeds.
  const openTeam = (t: {
    team: string;
    opp: string;
    isHome: boolean;
    sport: string;
    gameLabel: string;
    startsAt: string;
  }) => {
    setTeamSheet({
      team: t.team,
      opp: t.opp,
      isHome: t.isHome,
      sport: t.sport,
      gameLabel: t.gameLabel,
      startsAt: t.startsAt,
    });
  };

  // Open the full AI breakdown / stats page for a recommended prop. Everything
  // the page shows is fetched from the player's REAL game log — we pass only the
  // identifiers + the posted line/side/odds so it can ground its numbers.
  const openPropDetail = (p: ParsedPick) => {
    router.push({
      pathname: "/prop/[id]",
      params: {
        id: p.athleteId ?? p.player ?? "prop",
        player: p.player ?? "",
        marketKey: p.propMarketKey ?? "",
        marketLabel: p.market,
        line: p.propLine != null ? String(p.propLine) : "",
        side: p.propSide ?? "",
        odds: String(p.odds),
        game: p.game,
        sport: p.sport ?? sport,
        athleteId: p.athleteId ?? "",
        headshot: p.headshot ?? "",
        startsAt: p.startsAt ?? "",
        pick: p.pick,
      },
    });
  };

  // When navigated to with a player/sport (e.g. from the Home featured row),
  // sync the search + sport selector to that target.
  useEffect(() => {
    if (params.sp && PROPS_SPORTS.includes(String(params.sp))) setSport(String(params.sp));
    if (params.q != null) setQuery(String(params.q));
  }, [params.q, params.sp]);

  const propsSports = useMemo(() => SPORTS.filter((s) => PROPS_SPORTS.includes(s.id)), []);
  // Pills shown on this tab: every props-capable league PLUS the moneyline-only
  // browse sports. The props data queries below still run only over propsSports —
  // browse sports have no prop feed, so they get a real matches list instead.
  const isBrowseSport = BROWSE_ONLY_SPORTS.includes(sport);
  const pillSports = useMemo(
    () => SPORTS.filter((s) => PROPS_SPORTS.includes(s.id) || BROWSE_ONLY_SPORTS.includes(s.id)),
    [],
  );

  const searching = query.trim().length > 0;

  // Debounced gate for the cross-sport FETCH only (not the view, which switches
  // instantly). Without this, every transient keystroke would fan out a fetch to
  // all props sports; we wait until typing settles (~250ms) before loading the
  // non-selected leagues.
  const [debouncedQuery, setDebouncedQuery] = useState(query);
  useEffect(() => {
    const id = setTimeout(() => setDebouncedQuery(query), 250);
    return () => clearTimeout(id);
  }, [query]);
  const fetchAllSports = debouncedQuery.trim().length > 0;

  // One query per props sport. The selected sport always loads (it drives the
  // browse list + the AI rail); the rest load only once the user starts a search
  // — so search spans EVERY league at once, not just the selected pill. Per-sport
  // keys share React Query's cache, so flipping pills never refetches fresh data.
  const sportQueries = useQueries({
    queries: propsSports.map((s) => ({
      queryKey: ["props-all", s.id],
      queryFn: ({ signal }: { signal?: AbortSignal }) => fetchAllProps(s.id, signal),
      staleTime: 2 * 60_000,
      enabled: s.id === sport || fetchAllSports,
    })),
  });

  // The selected sport's query drives the browse view, the AI rail, and refresh.
  const selIdx = Math.max(0, propsSports.findIndex((s) => s.id === sport));
  const propsQ = sportQueries[selIdx]!;

  // Every loaded game across all leagues, each tagged with its own sport. Search
  // reads this pool so a player/team match in ANY league surfaces at once.
  const dataStamp = sportQueries.map((q) => q.dataUpdatedAt).join(",");
  const searchPool = useMemo(
    () => sportQueries.flatMap((q) => q.data ?? []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dataStamp],
  );
  const searchBusy = sportQueries.some((q) => q.isFetching);

  // Moneyline-only browse sports (tennis / table tennis) have no prop feed, so
  // instead of the props rails we list their REAL posted matches. Odds only —
  // tapping a card opens the full odds detail page. Disabled for prop sports.
  const browseOddsQ = useQuery({
    queryKey: ["browse-odds", sport],
    enabled: isBrowseSport,
    staleTime: 5 * 60_000,
    queryFn: ({ signal }) => getOdds(sport, signal),
  });
  const browseGames = useMemo<OddsGame[]>(() => {
    if (!isBrowseSport) return [];
    return (browseOddsQ.data ?? [])
      .filter((g) => isPickable(g.commenceTime))
      .sort((a, b) => Date.parse(a.commenceTime) - Date.parse(b.commenceTime));
  }, [browseOddsQ.data, isBrowseSport]);

  // Candidate pool for the AI RECOMMENDED rail — built ONLY from the real props
  // feed: a real player, real posted line, and the value side (recommendSide).
  // Deduped to one main line per player, in feed order, capped at GRADE_POOL so
  // we only pull game logs for a bounded set. Each entry keeps the raw
  // market/line/side so the grader can read the player's real hit-rate.
  type Cand = {
    pick: ParsedPick;
    player: string;
    athleteId: string | null;
    marketKey: string;
    line: number | null;
    side: "Over" | "Under";
  };
  const gradeCandidates = useMemo<Cand[]>(() => {
    if (isBrowseSport) return [];
    const data = propsQ.data ?? [];
    const out: Cand[] = [];
    const seen = new Set<string>();
    for (const g of data) {
      for (const p of g.props) {
        if (p.alt) continue; // main lines only
        const sel = recommendSide(p);
        if (!sel) continue;
        // Yes/no markets (no line, e.g. anytime goalscorer/TD) are only meaningful
        // on the Over/"Yes" side, and the canonical pick string drops the side
        // token — so force the Yes side here and require its price.
        let side = sel.side;
        let price = sel.price;
        if (p.line == null) {
          if (p.overPrice == null) continue;
          side = "Over";
          price = p.overPrice;
        }
        const key = p.player.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        const label = propMarketLabel(p.market);
        const pick =
          p.line != null
            ? `${p.player} ${side} ${p.line} ${label}`
            : `${p.player} ${label}`;
        out.push({
          player: p.player,
          athleteId: p.athleteId ?? null,
          marketKey: p.market,
          line: p.line,
          side,
          pick: {
            game: g.gameLabel,
            market: label,
            pick,
            odds: price,
            sport,
            isProp: true,
            startsAt: g.startsAt,
            headshot: p.headshot ?? null,
            teamAbbr: teamAbbrFor(p, g.teams),
            athleteId: p.athleteId ?? null,
            player: p.player,
            propMarketKey: p.market,
            propLine: p.line ?? null,
            propSide: side,
          },
        });
        if (out.length >= GRADE_POOL) return out;
      }
    }
    return out;
  }, [propsQ.data, sport, isBrowseSport]);

  // Real hit-rate grade per candidate. For each player we pull their REAL game
  // log and count how often they cleared THIS posted line over their last
  // GRADE_WINDOW games. Players with too few real games (or no game-log feed,
  // e.g. tennis/ufc) are simply not graded — never given a fabricated grade.
  const isSoccer = sport === "soccer";
  const gradeKey = gradeCandidates
    .map((c) => `${c.player}|${c.marketKey}|${c.line}|${c.side}`)
    .join(",");
  const gradesQ = useQuery({
    queryKey: ["prop-grades", sport, gradeKey],
    enabled: gradeCandidates.length > 0,
    staleTime: 10 * 60_000,
    queryFn: async ({ signal }) => {
      const results = new Map<string, { grade: Grade; hits: number; n: number }>();
      const queue = [...gradeCandidates];
      // Bounded concurrency so we don't fan out a dozen requests at once.
      const worker = async () => {
        for (;;) {
          const c = queue.shift();
          if (!c) return;
          if (!c.athleteId && !(isSoccer && c.player)) continue;
          try {
            const h = await getPlayerHistory(
              { sport, athleteId: c.athleteId, name: isSoccer ? c.player : null },
              signal,
            );
            const ambiguous = computeAmbiguous(h.labels);
            const vals = (h.recent ?? [])
              .map((g) => gameValueForMarket(c.marketKey, g.stats, ambiguous))
              .filter((v): v is number => v != null)
              .slice(0, GRADE_WINDOW);
            const n = vals.length;
            if (n < GRADE_MIN_SAMPLE) continue;
            const threshold = c.line != null ? c.line : 0.5;
            const isUnder = c.side === "Under";
            const hits = vals.filter((v) => (isUnder ? v < threshold : v >= threshold)).length;
            const grade = gradeFromHitPct((hits / n) * 100);
            if (grade) results.set(`${c.pick.game}|${c.pick.pick}`, { grade, hits, n });
          } catch {
            // No game log / fetch error — skip this player, never fabricate.
          }
        }
      };
      await Promise.all([worker(), worker(), worker(), worker()]);
      return results;
    },
  });

  // Model-backed confident upsets for this sport (same real mlLean engine the
  // Home tab uses) — surfaced here as recommendations too.
  const upsetsQ = useQuery({
    queryKey: ["props-upsets", sport],
    enabled: !isBrowseSport,
    queryFn: ({ signal }) => fetchUpsetSpots([sport], signal),
    staleTime: 5 * 60_000,
  });

  // The rail: A-tier graded props + confident upsets first (the only picks that
  // earn a badge). If NOTHING qualifies, fall back to the best real value picks
  // labelled honestly (no grade) so the section is never empty. Upset items
  // carry the canonical team identity (resolved here, where we still have the
  // full UpsetSpot) so navigation never has to guess the side later.
  type RecItem = {
    pick: ParsedPick;
    badge: RecBadge | null;
    upset?: { team: string; opp: string; isHome: boolean };
  };
  const recommended = useMemo<RecItem[]>(() => {
    const grades = gradesQ.data;
    const aTier: { item: RecItem; rank: number }[] = [];
    if (grades) {
      for (const c of gradeCandidates) {
        const g = grades.get(`${c.pick.game}|${c.pick.pick}`);
        if (!g) continue;
        const order = g.grade === "A+" ? 3 : g.grade === "A" ? 2 : 1;
        aTier.push({
          item: {
            pick: c.pick,
            badge: { text: g.grade, caption: `Hit ${g.hits}/${g.n} recent games`, tone: "grade" },
          },
          rank: order * 100 + (g.hits / g.n) * 10,
        });
      }
      aTier.sort((a, b) => b.rank - a.rank);
    }

    const upsets: RecItem[] = (upsetsQ.data ?? []).map((u) => {
      // u.side is EXACTLY the away or home substring of u.game ("Away @ Home"),
      // both produced from the same split in computeMlLean — so an exact match is
      // deterministic and immune to shared trailing tokens (e.g. soccer FC/SC).
      const [awayFull = "", homeFull = ""] = u.game.split(" @ ");
      const isHome = u.side === homeFull;
      const team = u.side;
      const opp = isHome ? awayFull : homeFull;
      return {
        pick: {
          game: u.game,
          market: "Moneyline",
          pick: `${nickname(u.side)} ML`,
          odds: u.dogOdds,
          sport: u.sport,
          isProp: false,
          startsAt: u.startsAt ?? null,
        } as ParsedPick,
        badge: {
          text: "CONFIDENT UPSET",
          caption: u.reasons[0] ?? `Model lean on the dog (${formatAmerican(u.dogOdds)})`,
          tone: "upset",
        },
        upset: { team, opp, isHome },
      };
    });

    const strong = [...aTier.map((a) => a.item), ...upsets];
    if (strong.length > 0) return strong.slice(0, REC_CAP);

    // Honest fallback: when nothing earns a real hit-rate grade we have NO edge
    // to stand on, so we must not promote longshots. A long plus-money price means
    // the market thinks the outcome is UNLIKELY — not that it's "good value" — and
    // recommending e.g. "Over 0.5 Stolen Bases (+1350)" for a player we have no
    // game log for would imply confidence we don't have. So drop rare-event
    // longshots entirely and surface only the lines the market prices near a coin
    // flip (shortest price first), with NO grade badge. Deterministic. If nothing
    // qualifies the rail is simply empty — honest beats padded with longshots.
    const FALLBACK_MAX_ODDS = 160; // exclude longshots when we have no real data
    return [...gradeCandidates]
      .filter((c) => c.pick.odds <= FALLBACK_MAX_ODDS)
      .sort((a, b) => a.pick.odds - b.pick.odds)
      .slice(0, REC_CAP)
      .map((c) => ({ pick: c.pick, badge: null }));
  }, [gradeCandidates, gradesQ.data, upsetsQ.data]);

  // VALUE (+EV) rail — props whose BEST posted price beats the de-vigged
  // cross-book consensus fair value (a real market inefficiency). ev/evSide/
  // fairProb/edge are computed SERVER-SIDE on main lines quoted by enough books;
  // we only read them — never recompute or guess. We show the side that carries
  // the edge (evSide) at its offered price, ranked by EV descending, capped, with
  // a plain-English caption ("+3.2% edge • fair ~48%"). Hidden when none qualify.
  type ValueItem = { pick: ParsedPick; ev: number; caption: string };
  const valueProps = useMemo<ValueItem[]>(() => {
    if (isBrowseSport) return [];
    const data = propsQ.data ?? [];
    const out: ValueItem[] = [];
    const seen = new Set<string>();
    for (const g of data) {
      for (const p of g.props) {
        if (p.alt) continue; // main lines only carry the EV signal
        const ev = p.ev;
        if (ev == null || ev < MIN_VALUE_EV || !p.evSide) continue;
        const side = p.evSide;
        // No-line (Yes/No) markets quote only the "Over"/Yes side and the
        // canonical pick-string drops the side token, so an "Under"/No edge here
        // can't be represented unambiguously — skip it rather than mislabel it.
        if (p.line == null && side !== "Over") continue;
        const price = side === "Over" ? p.overPrice : p.underPrice;
        if (price == null) continue;
        const key = `${p.player}|${p.market}|${p.line}|${side}`.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        const label = propMarketLabel(p.market);
        const pick =
          p.line != null ? `${p.player} ${side} ${p.line} ${label}` : `${p.player} ${label}`;
        const fairPct = p.fairProb != null ? Math.round(p.fairProb * 100) : null;
        const edgeTxt = p.edge != null ? `+${p.edge.toFixed(1)}% edge` : `+${ev.toFixed(1)}% value`;
        const caption = fairPct != null ? `${edgeTxt} • fair ~${fairPct}%` : edgeTxt;
        out.push({
          ev,
          caption,
          pick: {
            game: g.gameLabel,
            market: label,
            pick,
            odds: price,
            sport,
            isProp: true,
            startsAt: g.startsAt,
            headshot: p.headshot ?? null,
            teamAbbr: teamAbbrFor(p, g.teams),
            athleteId: p.athleteId ?? null,
            player: p.player,
            propMarketKey: p.market,
            propLine: p.line ?? null,
            propSide: side,
          },
        });
      }
    }
    return out.sort((a, b) => b.ev - a.ev).slice(0, VALUE_CAP);
  }, [propsQ.data, sport, isBrowseSport]);

  // Open the right detail page for a recommended card: prop breakdown for player
  // props, the team breakdown page for an upset (team moneyline) pick. The upset
  // side is resolved upstream (RecItem.upset), so we navigate with real params.
  const openRecommended = (item: RecItem) => {
    const p = item.pick;
    if (p.isProp || !item.upset) {
      openPropDetail(p);
      return;
    }
    const { team: teamFull, opp: oppFull, isHome } = item.upset;
    router.push({
      pathname: "/team-pick/[id]",
      params: {
        id: teamFull,
        team: teamFull,
        opp: oppFull,
        isHome: isHome ? "1" : "0",
        sport: p.sport ?? sport,
        market: "Moneyline",
        line: "",
        odds: String(p.odds),
        game: p.game,
        startsAt: p.startsAt ?? "",
        pick: p.pick,
      },
    });
  };

  const filtered = useMemo(() => {
    if (isBrowseSport) return [];
    const data = propsQ.data ?? [];
    const q = query.trim().toLowerCase();
    if (!q) return data;
    return data
      .map((g) => ({
        ...g,
        props: g.props.filter((p) => p.player.toLowerCase().includes(q)),
      }))
      .filter((g) => g.props.length > 0);
  }, [propsQ.data, query, isBrowseSport]);

  const totalProps = useMemo(
    () => filtered.reduce((n, g) => n + g.props.length, 0),
    [filtered],
  );

  // While searching, also surface TEAMS whose name matches the query — parsed
  // from the real game labels in the props window ("Away @ Home"). One row per
  // team (deduped), each carrying its game context so the team sheet can fetch
  // real history + posted markets. Players and teams are searched together.
  const teamResults = useMemo(() => {
    type TeamHit = {
      team: string;
      opp: string;
      isHome: boolean;
      sport: string;
      gameLabel: string;
      startsAt: string;
    };
    const q = query.trim().toLowerCase();
    if (!q) return [] as TeamHit[];
    const seen = new Set<string>();
    const out: TeamHit[] = [];
    for (const g of searchPool) {
      const [away, home] = g.gameLabel.split(" @ ");
      if (!away || !home) continue;
      const sides = [
        { team: away.trim(), opp: home.trim(), isHome: false },
        { team: home.trim(), opp: away.trim(), isHome: true },
      ];
      for (const s of sides) {
        if (!s.team.toLowerCase().includes(q)) continue;
        const k = `${g.sport}|${s.team.toLowerCase()}`;
        if (seen.has(k)) continue;
        seen.add(k);
        out.push({ ...s, sport: g.sport, gameLabel: g.gameLabel, startsAt: g.startsAt });
      }
    }
    return out;
  }, [searchPool, query]);

  // While searching, collapse each game's matches to one row per player (with a
  // representative prop to seed the sheet + a market count), instead of listing
  // every prop line.
  const playerResults = useMemo(() => {
    type PlayerGroup = { g: GameProps; players: { prop: PlayerProp; count: number }[] };
    const q = query.trim().toLowerCase();
    if (!q) return [] as PlayerGroup[];
    return searchPool
      .map((g) => {
        const byPlayer = new Map<string, { prop: PlayerProp; count: number }>();
        for (const p of g.props) {
          if (!p.player.toLowerCase().includes(q)) continue;
          const existing = byPlayer.get(p.player);
          if (existing) existing.count += 1;
          else byPlayer.set(p.player, { prop: p, count: 1 });
        }
        return { g, players: Array.from(byPlayer.values()) };
      })
      .filter((r) => r.players.length > 0);
  }, [searchPool, query]);

  const totalPlayerMatches = useMemo(
    () => playerResults.reduce((n, r) => n + r.players.length, 0),
    [playerResults],
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        stickyHeaderIndices={[0]}
        contentContainerStyle={{
          paddingBottom: insets.bottom + 24 + slipClearance,
        }}
        refreshControl={
          <RefreshControl
            refreshing={isBrowseSport ? browseOddsQ.isFetching : propsQ.isFetching}
            onRefresh={() => (isBrowseSport ? browseOddsQ.refetch() : propsQ.refetch())}
            tintColor={colors.mutedForeground}
          />
        }
      >
        {/* Pinned header — logo, search and sport pills stay affixed to the top
            of the page (including while props are loading), so the content below
            scrolls underneath them instead of pushing them around. */}
        <View style={{ paddingTop: insets.top + 8, backgroundColor: colors.background }}>
        {/* Logo — matches the Home logo's size and position */}
        <View style={{ paddingHorizontal: 16, marginBottom: 8, alignItems: "center" }}>
          <Image
            source={require("@/assets/images/logo.png")}
            style={{ width: "100%", height: 130, marginTop: -8 }}
            resizeMode="contain"
            accessibilityLabel="Stadium Edge"
          />
        </View>

        {/* Search */}
        <View style={{ paddingHorizontal: 16, marginBottom: 14 }}>
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 8,
              backgroundColor: colors.card,
              borderWidth: 1,
              borderColor: colors.border,
              borderRadius: 999,
              paddingHorizontal: 14,
              paddingVertical: 10,
            }}
          >
            <Feather name="search" size={16} color={colors.mutedForeground} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Search players or teams"
              placeholderTextColor={colors.mutedForeground}
              style={{ flex: 1, color: colors.foreground, fontFamily: FONT.medium, fontSize: 14, padding: 0 }}
              autoCorrect={false}
              autoCapitalize="none"
            />
            {query.length > 0 ? (
              <Pressable onPress={() => setQuery("")} hitSlop={8}>
                <Feather name="x" size={16} color={colors.mutedForeground} />
              </Pressable>
            ) : null}
          </View>
        </View>

        {/* Sport selector — directly under the search bar so the league scope is
            obvious before the rails. Hidden while searching, since search spans
            every league at once and the selected pill no longer scopes results. */}
        {searching ? null : (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: 16, gap: 8, marginBottom: 16 }}
          >
            {pillSports.map((s) => (
              <Pill key={s.id} label={s.label} active={sport === s.id} onPress={() => setSport(s.id)} />
            ))}
          </ScrollView>
        )}
        </View>

        {/* AI-recommended props — a varied set built from the real props feed,
            independent of the AI Coach's chat parlay. Horizontal swipe list,
            hidden while searching. */}
        {!query.trim() && recommended.length > 0 ? (
          <View style={{ marginBottom: 18 }}>
            <Text
              style={{
                color: colors.primary,
                fontFamily: FONT.display,
                fontSize: 13,
                letterSpacing: 0.5,
                marginBottom: 8,
                paddingHorizontal: 16,
              }}
            >
              ★ AI RECOMMENDED
            </Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ paddingHorizontal: 16, gap: 12 }}
            >
              {recommended.map((item, i) => (
                <View key={`${item.pick.game}|${item.pick.pick}|${i}`} style={{ width: 290 }}>
                  <PickCard
                    pick={item.pick}
                    hideReadout
                    onPress={() => openRecommended(item)}
                  />
                </View>
              ))}
            </ScrollView>
          </View>
        ) : null}

        {/* VALUE (+EV) — props whose best posted price beats the de-vigged
            cross-book consensus fair value. Server-computed, real-or-omitted;
            hidden while searching and when nothing qualifies. */}
        {!query.trim() && valueProps.length > 0 ? (
          <View style={{ marginBottom: 18 }}>
            <Text
              style={{
                color: colors.primary,
                fontFamily: FONT.display,
                fontSize: 13,
                letterSpacing: 0.5,
                marginBottom: 2,
                paddingHorizontal: 16,
              }}
            >
              ⚡ VALUE (+EV)
            </Text>
            <Text
              style={{
                color: colors.mutedForeground,
                fontFamily: FONT.medium,
                fontSize: 11,
                marginBottom: 8,
                paddingHorizontal: 16,
              }}
            >
              Best price beats the cross-book fair value
            </Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ paddingHorizontal: 16, gap: 12 }}
            >
              {valueProps.map((item, i) => (
                <View key={`val-${item.pick.game}|${item.pick.pick}|${i}`} style={{ width: 290 }}>
                  <PickCard
                    pick={item.pick}
                    hideReadout
                    badge={{ text: `+${item.ev.toFixed(1)}% EV`, caption: item.caption, tone: "value" }}
                    onPress={() => openPropDetail(item.pick)}
                  />
                </View>
              ))}
            </ScrollView>
          </View>
        ) : null}

        {/* Props list */}
        <View style={{ paddingHorizontal: 16, gap: 16 }}>
          {!searching && isBrowseSport ? (
            browseOddsQ.isLoading ? (
              <Loading label="Loading matches…" />
            ) : browseOddsQ.isError ? (
              <ErrorState onRetry={() => browseOddsQ.refetch()} />
            ) : browseGames.length === 0 ? (
              <EmptyState
                icon="calendar"
                title="No matches in the window"
                subtitle={`No ${SPORTS.find((s) => s.id === sport)?.label ?? sport} matches are posted in the next 48 hours. Try another league.`}
              />
            ) : (
              <>
                <Text
                  style={{
                    color: colors.mutedForeground,
                    fontFamily: FONT.medium,
                    fontSize: 12,
                    marginBottom: 2,
                  }}
                >
                  Moneyline and game lines only — this sport has no player props. Tap a match for all odds.
                </Text>
                {browseGames.map((g) => (
                  <GameCard
                    key={g.id}
                    game={g}
                    onPress={() =>
                      router.push({ pathname: "/game/[id]", params: { id: g.id, sport } })
                    }
                  />
                ))}
              </>
            )
          ) : !searching && propsQ.isLoading ? (
            <Loading label="Loading player props…" />
          ) : !searching && propsQ.isError ? (
            <ErrorState onRetry={() => propsQ.refetch()} />
          ) : searching ? (
            // Searching → players AND teams across EVERY league at once. Show a
            // TEAMS section (if any team name matches) above one compact tappable
            // row per matching player.
            totalPlayerMatches === 0 && teamResults.length === 0 ? (
              searchBusy ? (
                <Loading label="Searching all leagues…" />
              ) : (
                <EmptyState
                  icon="search"
                  title="No matches"
                  subtitle={`No players or teams match “${query.trim()}”.`}
                />
              )
            ) : (
              <>
                {teamResults.length > 0 ? (
                  <View style={{ gap: 10 }}>
                    <SearchSectionLabel>Teams</SearchSectionLabel>
                    {teamResults.map((t) => (
                      <TeamResultRow
                        key={`team-${t.sport}-${t.team}`}
                        team={t.team}
                        opp={t.opp}
                        isHome={t.isHome}
                        onOpen={() => openTeam(t)}
                      />
                    ))}
                  </View>
                ) : null}
                {playerResults.length > 0 && teamResults.length > 0 ? (
                  <SearchSectionLabel>Players</SearchSectionLabel>
                ) : null}
                {playerResults.map(({ g, players }, gi) => (
                  <View key={`${g.gameLabel}-${gi}`} style={{ gap: 10 }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                      <Text style={{ color: colors.foreground, fontFamily: FONT.displaySemi, fontSize: 15, flex: 1 }} numberOfLines={1}>
                        {g.gameLabel}
                      </Text>
                      <Text style={{ color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 11 }}>
                        {new Date(g.startsAt).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" })}
                      </Text>
                    </View>
                    {players.map(({ prop, count }) => (
                      <PlayerResultRow
                        key={`${g.gameLabel}-${prop.player}`}
                        prop={prop}
                        marketCount={count}
                        onOpen={() => openSheet(g, prop)}
                      />
                    ))}
                  </View>
                ))}
              </>
            )
          ) : totalProps === 0 ? (
            <EmptyState
              icon="user"
              title="No props in the window"
              subtitle={`No player props are posted for ${SPORTS.find((s) => s.id === sport)?.label ?? sport} games in the ${sport === "soccer" ? "next 2 weeks" : "next 48 hours"}. Try another league.`}
            />
          ) : (
            filtered.map((g, gi) => (
              <View key={`${g.gameLabel}-${gi}`} style={{ gap: 10 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <Text style={{ color: colors.foreground, fontFamily: FONT.displaySemi, fontSize: 15, flex: 1 }} numberOfLines={1}>
                    {g.gameLabel}
                  </Text>
                  <Text style={{ color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 11 }}>
                    {new Date(g.startsAt).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" })}
                  </Text>
                </View>
                {g.props.map((p, idx) => (
                  <PropRow
                    key={`${p.player}-${p.market}-${p.line}-${idx}`}
                    prop={p}
                    alts={g.allProps
                      .filter((a) => a.alt && a.player === p.player && a.market === p.market)
                      .sort((a, b) => (a.line ?? 0) - (b.line ?? 0))}
                    gameLabel={g.gameLabel}
                    sport={sport}
                    onOpen={() => openSheet(g, p)}
                  />
                ))}
              </View>
            ))
          )}
        </View>
      </ScrollView>
      <PlayerPropsSheet
        data={sheet}
        active={!sheetHidden}
        onHide={() => setSheetHidden(true)}
        onClose={() => {
          setSheet(null);
          setSheetHidden(false);
        }}
      />
      <TeamPropsSheet data={teamSheet} onClose={() => setTeamSheet(null)} />
    </View>
  );
}

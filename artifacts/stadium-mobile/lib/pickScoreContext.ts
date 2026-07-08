// Bridges the real chat/odds context to the pure pick rubric in lib/pickScore.
// Given the picks parsePicks() already resolved to REAL odds/prop entries, this
// re-finds each pick's backing entry and the matchup feeds (history + injuries)
// and builds its 5-component score. Everything here is REAL-or-null: when a
// signal cannot be grounded for a pick we leave that sub-score null and the
// renderer shows "no data" — never a fabricated number. Kept in its own module
// (not PickCard) so it can import lib/api types without a circular dependency.

import type { ParsedPick } from "@/components/PickCard";
import type {
  InjuryTeam,
  MatchupHistoryEntry,
  PlayerProp,
  PropPoolEntry,
  RealOddsEntry,
} from "@/lib/api";
import { propMarketLabel } from "@/lib/propMarketLabel";
import type { GameInjuryReport } from "@/lib/injuries";
import { summarizeTeamInjuries, teamNameMatches } from "@/lib/injuries";
import {
  combinePickScore,
  injuryFavorGame,
  injuryFavorProp,
  matchupAlignment,
  playerTrendMomentum,
  scoreInjury,
  scoreLineShopping,
  scoreLineValue,
  scoreMatchup,
  scoreSimulation,
  scoreTrend,
  teamTrendMomentum,
  type CombinedPickScore,
  type PickSubScores,
} from "@/lib/pickScore";
import { applyMarketWeighting, type MarketPerf } from "@/lib/marketWeighting";
import { trackedSignalBias, type SignalPerf } from "@/lib/pickTrackerAnalytics";
import { gameValueForMarket } from "@/lib/propStats";
import {
  gameSimHitForPick,
  gameLabelsMatch,
  lookupGameSim,
  probeGameSimHitFromLines,
  type CoachGameSimEntry,
} from "@/lib/gameSimScoring";
import { buildFinalAiScore } from "@/lib/finalAiScore";

// Compact player-history slice carried in chat context (keyed Player#athleteId).
export type PlayerHistorySlice = {
  player?: string;
  recent?: { date?: string; opp?: string; stats?: Record<string, unknown> }[];
};

// Words that never identify a team and would create false token overlaps when
// matching a pick selection to a game label's away/home names.
const GENERIC = new Set([
  "fc", "sc", "the", "of", "and", "los", "san", "new", "city", "club", "cf",
  "afc", "ac", "real",
]);

const tokens = (s: string | null | undefined): string[] =>
  String(s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t && !GENERIC.has(t));

// Split a "Away @ Home" game label into its two full team names.
function splitLabel(label: string): { away: string; home: string } {
  const parts = String(label || "").split(" @ ");
  return { away: (parts[0] || "").trim(), home: (parts[1] || "").trim() };
}

// Which side of the matchup a team name belongs to, by token overlap with the
// label's away/home names. Returns null on a tie or no overlap so we never guess.
function sideOfTeam(
  team: string,
  away: string,
  home: string,
): "home" | "away" | null {
  const t = tokens(team);
  if (t.length === 0) return null;
  const aw = tokens(away);
  const hm = tokens(home);
  const overlap = (a: string[], b: string[]) => a.filter((x) => b.includes(x)).length;
  const ho = overlap(t, hm);
  const ao = overlap(t, aw);
  if (ho > ao && ho > 0) return "home";
  if (ao > ho && ao > 0) return "away";
  return null;
}

// The team a GAME pick is on (moneyline/spread). Totals (Over/Under) name no
// team and return null. Strips a trailing "ML"/handicap/price so the leading
// words are the team name.
function gamePickTeam(pick: ParsedPick): string | null {
  const p = pick.pick || "";
  if (/\b(over|under)\b/i.test(p)) return null; // game total — no side
  const team = p
    .replace(/\s*(ml|moneyline)\s*$/i, "")
    .replace(/\s*[+-]?\d+(?:\.\d+)?\s*$/, "")
    .trim();
  return team || null;
}

// Resolve the GAME injury picture for a pick into the { side, magnitude } shape
// scoreInjury expects. The favored (healthier) side is read from the report's
// plain-English edge string so it stays consistent with the visible injury
// label; the magnitude comes from the difference in weighted key-injury counts
// (high = 2, med = 1, capped at 3). Returns null when the side can't be mapped.
function gameInjuryEdge(
  report: GameInjuryReport,
  away: string,
  home: string,
): { side: "home" | "away" | "neutral"; magnitude: number } | null {
  const weight = (s: GameInjuryReport["sides"][number]) =>
    s.keyPlayers.reduce((a, k) => a + (k.impact === "high" ? 2 : 1), 0);
  let awayScore: number | null = null;
  let homeScore: number | null = null;
  for (const s of report.sides) {
    const sd = sideOfTeam(s.team, away, home);
    if (sd === "away") awayScore = weight(s);
    else if (sd === "home") homeScore = weight(s);
  }
  const edge = report.edge || "";
  if (/^even/i.test(edge)) return { side: "neutral", magnitude: 0 };
  const m = edge.match(/^Edge:\s*(.+?)\s*\(/i);
  if (!m) return null;
  const favored = sideOfTeam(m[1], away, home);
  if (!favored) return null;
  // Magnitude must come from BOTH sides' real weighted key-injury counts. If
  // either side can't be mapped back to this game's away/home, we have no real
  // basis for the degree of the lean — fail closed to null rather than invent
  // one, so the Injury Impact sub-score is honestly omitted.
  if (awayScore == null || homeScore == null) return null;
  const magnitude = Math.min(3, Math.abs(homeScore - awayScore));
  return { side: favored, magnitude };
}

function numSpreadLine(pick: string): number | null {
  const m = String(pick).match(/([+-]?\d+(?:\.\d+)?)\s*$/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

function teamsLooseMatch(a: string, b: string): boolean {
  const ta = tokens(a);
  const tb = tokens(b);
  if (!ta.length || !tb.length) return false;
  if (ta.some((t) => tb.includes(t)) || tb.some((t) => ta.includes(t))) return true;
  return ta[ta.length - 1] === tb[tb.length - 1];
}

export function findBackingOddsRow(pick: ParsedPick, realOdds: RealOddsEntry[]): RealOddsEntry | undefined {
  const exact = realOdds.find(
    (r) => r.game === pick.game && r.market === pick.market && r.pick === pick.pick,
  );
  if (exact) return exact;
  const pickTeam = gamePickTeam(pick);
  const pickLine = numSpreadLine(pick.pick);
  const isSpread = /spread/i.test(pick.market);
  if (!pickTeam || pickLine == null || !isSpread) return undefined;
  return realOdds.find((r) => {
    if (!gameLabelsMatch(r.game, pick.game) || !/spread/i.test(r.market)) return false;
    if (numSpreadLine(r.pick) !== pickLine) return false;
    const rowTeam = gamePickTeam({ ...pick, pick: r.pick });
    return rowTeam != null && teamsLooseMatch(pickTeam, rowTeam);
  });
}

// Score one GAME pick (moneyline / spread / total) from the real feeds.
export function scoreGameLinePick(
  pick: ParsedPick,
  realOdds: RealOddsEntry[],
  matchupHistory: Record<string, MatchupHistoryEntry> | undefined,
  matchupInjuries: Record<string, GameInjuryReport> | undefined,
  gameSim?: CoachGameSimEntry | null,
  evalLines?: RealOddsEntry[],
): CombinedPickScore | null {
  // Line Value + Line-Shopping come straight off the backing odds row, which
  // parsePicks copied verbatim — so an exact game/market/pick match is the row.
  const ro = findBackingOddsRow(pick, realOdds);
  const edgePct = ro?.edge ?? null;
  const lineValue = scoreLineValue(edgePct);
  const lineShopping = scoreLineShopping(ro?.bookSpread ?? null);

  const { away, home } = splitLabel(pick.game);
  const pickTeam = gamePickTeam(pick);
  const pickSide = pickTeam ? sideOfTeam(pickTeam, away, home) : null;

  // Matchup: does the model's moneyline lean back the side we picked?
  const entry = matchupHistory?.[pick.game];
  const { aligned, leanEdge } = matchupAlignment(entry?.mlLean, pickTeam);
  const matchup = scoreMatchup(aligned, leanEdge);

  // Trend: the picked team's recent streak + L10 average margin.
  let trend = null;
  if (entry && pickSide) {
    const sideData: any = pickSide === "home" ? entry.home : entry.away;
    trend = scoreTrend(
      teamTrendMomentum(sideData?.streak, sideData?.last10?.avgMargin),
    );
  }

  // Injury: how the ESPN injury picture leans relative to our side.
  let injury = null;
  const injReport = matchupInjuries?.[pick.game];
  if (injReport && pickSide) {
    const ie = gameInjuryEdge(injReport, away, home);
    injury = scoreInjury(injuryFavorGame(ie, pickSide === "home"));
  }

  const scores: PickSubScores = {
    matchup,
    trend,
    lineValue,
    injury,
    lineShopping,
    simulation: scoreSimulation(
      probeGameSimHitFromLines(pick, gameSim, evalLines ?? []) ??
        gameSimHitForPick(pick, gameSim),
    ),
  };
  // Pass the leg's real price AND the picked side's no-vig fair win probability so
  // Confidence reads its de-vigged win chance. noVigFair is present on BOTH sides
  // of a two-sided main market, so a pick on the non-+EV side (which carries no
  // `edge`) still gets a real win chance instead of reading "—".
  const combined = combinePickScore(scores, edgePct, pick.odds, ro?.noVigFair ?? null);
  return combined.composite == null ? null : combined;
}

// Resolve which team a prop player is on. Prefer the pool's teamAbbr; fall back
// to recent game-log opponents (the team that never appears as an opp is ours).
function resolvePropPlayerTeam(
  game: string,
  entry: PropPoolEntry | undefined,
  ph?: PlayerHistorySlice,
): string | null {
  const { away, home } = splitLabel(game);
  const ab = entry?.teamAbbr?.toUpperCase();
  if (ab) {
    if (away.toUpperCase().includes(ab)) return away;
    if (home.toUpperCase().includes(ab)) return home;
  }
  const opps = (ph?.recent ?? [])
    .map((r) => String(r.opp ?? "").toLowerCase())
    .filter(Boolean);
  if (!opps.length || !away || !home) return null;
  const nick = (n: string) => n.toLowerCase().split(/\s+/).pop() ?? "";
  const seen = (n: string) => {
    const k = nick(n);
    return !!k && opps.some((o) => o.includes(k));
  };
  const awayIsOpp = seen(away);
  const homeIsOpp = seen(home);
  if (awayIsOpp && !homeIsOpp) return home;
  if (homeIsOpp && !awayIsOpp) return away;
  return null;
}

function playerHistoryFor(
  player: string | undefined,
  athleteId: string | null | undefined,
  map?: Record<string, PlayerHistorySlice>,
): PlayerHistorySlice | undefined {
  if (!map) return undefined;
  if (athleteId) {
    const hit = map[`${player}#${athleteId}`] ?? Object.entries(map).find(([k]) => k.endsWith(`#${athleteId}`))?.[1];
    if (hit) return hit;
  }
  if (player) {
    const hit = Object.entries(map).find(([k]) => k.startsWith(`${player}#`))?.[1];
    if (hit) return hit;
  }
  return undefined;
}

function propTrendScore(
  ph: PlayerHistorySlice | undefined,
  marketKey: string,
  line: number | null | undefined,
  side: string | null | undefined,
): PickSubScores["trend"] {
  if (!ph?.recent?.length || line == null) return null;
  const vals = ph.recent
    .map((g) => gameValueForMarket(marketKey, g.stats ?? {}, {}))
    .filter((v): v is number => v != null);
  return scoreTrend(playerTrendMomentum(vals, line, side));
}

function propMatchupScore(
  game: string,
  playerTeam: string | null,
  matchupHistory?: Record<string, MatchupHistoryEntry>,
): PickSubScores["matchup"] {
  if (!playerTeam) return null;
  const entry = matchupHistory?.[game];
  const { aligned, leanEdge } = matchupAlignment(entry?.mlLean, playerTeam);
  return scoreMatchup(aligned, leanEdge);
}

function propInjuryScore(
  sport: string | undefined,
  game: string,
  playerTeam: string | null,
  side: string | null | undefined,
  matchupInjuries?: Record<string, GameInjuryReport>,
  injuryTeams?: InjuryTeam[],
): PickSubScores["injury"] {
  const { away, home } = splitLabel(game);
  const opp =
    playerTeam && teamNameMatches(playerTeam, away)
      ? home
      : playerTeam && teamNameMatches(playerTeam, home)
        ? away
        : null;
  if (!opp) return null;
  const report = matchupInjuries?.[game];
  if (report) {
    const oppSide = report.sides.find((s) => teamNameMatches(s.team, opp));
    const highCount = oppSide?.keyPlayers.filter((k) => k.impact === "high").length ?? 0;
    return scoreInjury(injuryFavorProp(highCount, side));
  }
  if (injuryTeams?.length) {
    const oppTeam = injuryTeams.find((t) => teamNameMatches(t.team, opp));
    if (oppTeam) {
      return scoreInjury(injuryFavorProp(summarizeTeamInjuries(sport ?? "nba", oppTeam).highCount, side));
    }
  }
  return null;
}

// Build resolution-shape prop pool rows from live PlayerProp feed (simulator /
// game pages). Carries real EV edge + line-shopping spread per side.
export function propPoolFromPlayerProps(
  props: PlayerProp[],
  game: string,
  sport: string,
  teams?: {
    homeTeamId?: string | null;
    awayTeamId?: string | null;
    homeAbbr?: string | null;
    awayAbbr?: string | null;
  },
): PropPoolEntry[] {
  const out: PropPoolEntry[] = [];
  for (const p of props) {
    if (!p || p.alt || p.line == null) continue;
    const marketLabel = propMarketLabel(p.market);
    const teamAbbr =
      p.playerTeamId && teams?.homeTeamId && p.playerTeamId === teams.homeTeamId
        ? (teams.homeAbbr ?? null)
        : p.playerTeamId && teams?.awayTeamId && p.playerTeamId === teams.awayTeamId
          ? (teams.awayAbbr ?? null)
          : null;
    if (p.overPrice != null) {
      out.push({
        sport,
        game,
        marketLabel,
        player: p.player,
        line: p.line,
        side: "Over",
        odds: p.overPrice,
        edge: p.evSide === "Over" ? (p.edge ?? null) : null,
        bookSpread: p.overSpread ?? null,
        athleteId: p.athleteId,
        marketKey: p.market,
        headshot: p.headshot,
        teamAbbr,
      });
    }
    if (p.underPrice != null) {
      out.push({
        sport,
        game,
        marketLabel,
        player: p.player,
        line: p.line,
        side: "Under",
        odds: p.underPrice,
        edge: p.evSide === "Under" ? (p.edge ?? null) : null,
        bookSpread: p.underSpread ?? null,
        athleteId: p.athleteId,
        marketKey: p.market,
        headshot: p.headshot,
        teamAbbr,
      });
    }
  }
  return out;
}

// Score one PROP pick from the full real context: EV/line-shopping, recent form,
// matchup lean, injuries, and Monte Carlo (one rubric input — never the sole driver).
function scorePropPick(
  pick: ParsedPick,
  propPool: PropPoolEntry[],
  simulationByKey?: Map<string, { hitProbability: number | null }>,
  ctx?: {
    matchupHistory?: Record<string, MatchupHistoryEntry>;
    matchupInjuries?: Record<string, GameInjuryReport>;
    playerHistory?: Record<string, PlayerHistorySlice>;
    injuryTeams?: InjuryTeam[];
  },
): CombinedPickScore | null {
  // The resolved prop ParsedPick was built from a real pool entry, so match on
  // its identity fields. Prefer the exact line/side, fall back to the same
  // player+side when an alt rung was swapped in.
  const same = (e: PropPoolEntry) =>
    e.game === pick.game &&
    e.player === pick.player &&
    e.side === pick.propSide;
  const entry =
    propPool.find((e) => same(e) && e.line === pick.propLine) ??
    propPool.find(same);
  if (!entry) return null;
  const edgePct = entry.edge ?? null;
  const marketKey = pick.propMarketKey ?? entry.marketKey ?? pick.market;
  const ph = playerHistoryFor(pick.player, entry.athleteId ?? pick.athleteId, ctx?.playerHistory);
  const playerTeam = resolvePropPlayerTeam(pick.game, entry, ph);
  const simKey =
    pick.player && pick.propLine != null && pick.propSide
      ? `${pick.player}|${marketKey}|${pick.propLine}|${pick.propSide}`
      : null;
  const sim = simKey ? simulationByKey?.get(simKey) : undefined;
  const scores: PickSubScores = {
    matchup: propMatchupScore(pick.game, playerTeam, ctx?.matchupHistory),
    trend: propTrendScore(ph, marketKey, pick.propLine, pick.propSide),
    lineValue: scoreLineValue(edgePct),
    injury: propInjuryScore(
      pick.sport ?? entry.sport,
      pick.game,
      playerTeam,
      pick.propSide,
      ctx?.matchupInjuries,
      ctx?.injuryTeams,
    ),
    lineShopping: scoreLineShopping(entry.bookSpread ?? null),
    simulation: scoreSimulation(sim?.hitProbability ?? null),
  };
  const combined = combinePickScore(scores, edgePct, pick.odds);
  return combined.composite == null ? null : combined;
}

// The win-chance inputs for a leg, resolved from its REAL backing entry — the
// SAME entry scoreGamePick / scorePropPick read, so the Coach confidence filter
// scores the identical de-vigged win chance the card shows. A game pick gets the
// picked side's no-vig fair prob (both sides of a two-sided main market) plus the
// edge; a prop gets only the edge (that feed carries no both-sides fair prob).
// Both null when no backing entry is found.
export function pickWinChanceInputs(
  pick: ParsedPick,
  realOdds: RealOddsEntry[],
  propPool: PropPoolEntry[],
): { edge: number | null; fairProb: number | null } {
  if (pick.isProp) {
    const same = (e: PropPoolEntry) =>
      e.game === pick.game && e.player === pick.player && e.side === pick.propSide;
    const entry =
      propPool.find((e) => same(e) && e.line === pick.propLine) ?? propPool.find(same);
    return { edge: entry?.edge ?? null, fairProb: null };
  }
  const ro = realOdds.find(
    (r) => r.game === pick.game && r.market === pick.market && r.pick === pick.pick,
  );
  return { edge: ro?.edge ?? null, fairProb: ro?.noVigFair ?? null };
}

// Attach a `scores` rubric to each pick from the REAL context. Returns new pick
// objects (does not mutate). Picks that cannot be graded carry scores = null and
// the card falls back to its existing edge readout.
export function attachPickScores(
  picks: ParsedPick[],
  opts: {
    realOdds?: RealOddsEntry[];
    propPool?: PropPoolEntry[];
    matchupHistory?: Record<string, MatchupHistoryEntry>;
    matchupInjuries?: Record<string, GameInjuryReport>;
    // Real settled hit-rate by market family (Model Report's byFamily). When
    // present, a market above/below the user's historical thresholds nudges that
    // leg's Confidence. The fixed market-priority prior applies regardless; only
    // a grounded (non-null) Confidence is ever adjusted — never fabricated.
    perfByFamily?: Map<string, MarketPerf>;
    /** Real coach-pick history by signal category — nudges Confidence when cold/hot. */
    trackedSignalPerf?: Map<string, SignalPerf>;
    /** Monte Carlo results keyed player|market|line|side */
    propSimulations?: Map<string, { hitProbability: number | null }>;
    /** Game-outcome sim keyed by "Away @ Home" (same engine as Simulator tab). */
    gameSimulations?: Map<string, CoachGameSimEntry>;
    /** Posted ML/spread/total ladder per game — grounds sim hit for nickname alt lines. */
    evalLinesByGame?: Map<string, RealOddsEntry[]>;
    /** Real per-player game logs keyed Player#athleteId (grounds prop trend). */
    playerHistory?: Record<string, PlayerHistorySlice>;
    /** Raw league injury teams when matchupInjuries report is absent. */
    injuryTeams?: InjuryTeam[];
  },
): ParsedPick[] {
  const realOdds = opts.realOdds ?? [];
  const propPool = opts.propPool ?? [];
  const sims = opts.propSimulations;
  const gameSims = opts.gameSimulations;
  const evalByGame = opts.evalLinesByGame;
  const propCtx = {
    matchupHistory: opts.matchupHistory,
    matchupInjuries: opts.matchupInjuries,
    playerHistory: opts.playerHistory,
    injuryTeams: opts.injuryTeams,
  };
  return picks.map((p) => {
    const gameSim = lookupGameSim(p.game, gameSims);
    const evalLines = evalByGame
      ? (() => {
          const direct = evalByGame.get(p.game);
          if (direct?.length) return direct;
          for (const [label, rows] of evalByGame) {
            if (gameLabelsMatch(label, p.game)) return rows;
          }
          return undefined;
        })()
      : undefined;
    const raw = p.isProp
      ? scorePropPick(p, propPool, sims, propCtx)
      : scoreGameLinePick(
          p,
          realOdds,
          opts.matchupHistory,
          opts.matchupInjuries,
          gameSim,
          evalLines,
        );
    const scores = applyMarketWeighting(raw, p, opts.perfByFamily);
    const trackedDelta = opts.trackedSignalPerf
      ? trackedSignalBias(p, opts.trackedSignalPerf)
      : 0;
    const weighted =
      scores && trackedDelta !== 0 && scores.confidencePct != null
        ? {
            ...scores,
            confidencePct: Math.max(
              5,
              Math.min(95, Math.round(scores.confidencePct + trackedDelta)),
            ),
          }
        : scores;
    if (!weighted) return { ...p, scores: null };

    const propKey =
      p.isProp && p.player && p.propLine != null && p.propSide
        ? `${p.player}|${p.propMarketKey ?? p.market}|${p.propLine}|${p.propSide}`
        : null;
    const propSimHit =
      p.isProp && propKey && sims?.get(propKey)?.hitProbability != null
        ? (sims.get(propKey)!.hitProbability as number)
        : null;

    const finalAiScore = buildFinalAiScore({
      pick: p,
      rubricScores: weighted.scores,
      edgePct: weighted.edgePct,
      odds: p.odds,
      gameSim,
      propSimHit,
    });

    return {
      ...p,
      scores: finalAiScore.rubric,
      finalAiScore,
      highRiskValuePlay: finalAiScore.highRiskValuePlay || p.highRiskValuePlay,
    };
  });
}

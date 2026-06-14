// Bridges the real chat/odds context to the pure pick rubric in lib/pickScore.
// Given the picks parsePicks() already resolved to REAL odds/prop entries, this
// re-finds each pick's backing entry and the matchup feeds (history + injuries)
// and builds its 5-component score. Everything here is REAL-or-null: when a
// signal cannot be grounded for a pick we leave that sub-score null and the
// renderer shows "no data" — never a fabricated number. Kept in its own module
// (not PickCard) so it can import lib/api types without a circular dependency.

import type { ParsedPick } from "@/components/PickCard";
import type { MatchupHistoryEntry, PropPoolEntry, RealOddsEntry } from "@/lib/api";
import type { GameInjuryReport } from "@/lib/injuries";
import {
  combinePickScore,
  injuryFavorGame,
  matchupAlignment,
  scoreInjury,
  scoreLineShopping,
  scoreLineValue,
  scoreMatchup,
  scoreTrend,
  teamTrendMomentum,
  type CombinedPickScore,
  type PickSubScores,
} from "@/lib/pickScore";

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

// Score one GAME pick (moneyline / spread / total) from the real feeds.
function scoreGamePick(
  pick: ParsedPick,
  realOdds: RealOddsEntry[],
  matchupHistory: Record<string, MatchupHistoryEntry> | undefined,
  matchupInjuries: Record<string, GameInjuryReport> | undefined,
): CombinedPickScore | null {
  // Line Value + Line-Shopping come straight off the backing odds row, which
  // parsePicks copied verbatim — so an exact game/market/pick match is the row.
  const ro = realOdds.find(
    (r) => r.game === pick.game && r.market === pick.market && r.pick === pick.pick,
  );
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

  const scores: PickSubScores = { matchup, trend, lineValue, injury, lineShopping };
  // Pass the leg's real price AND the picked side's no-vig fair win probability so
  // Confidence reads its de-vigged win chance. noVigFair is present on BOTH sides
  // of a two-sided main market, so a pick on the non-+EV side (which carries no
  // `edge`) still gets a real win chance instead of reading "—".
  const combined = combinePickScore(scores, edgePct, pick.odds, ro?.noVigFair ?? null);
  return combined.composite == null ? null : combined;
}

// Score one PROP pick. On a card we have no per-player game log, so Trend and
// Matchup are honestly null; Line Value + Line-Shopping come off the prop's
// backing pool entry (the prop detail page grounds the full five). edge is only
// present on the side the server flagged as +EV — null otherwise, which is fine.
function scorePropPick(
  pick: ParsedPick,
  propPool: PropPoolEntry[],
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
  const scores: PickSubScores = {
    matchup: null,
    trend: null,
    lineValue: scoreLineValue(edgePct),
    injury: null,
    lineShopping: scoreLineShopping(entry.bookSpread ?? null),
  };
  // Pass the prop's real price so Confidence reads its de-vigged win chance.
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
  },
): ParsedPick[] {
  const realOdds = opts.realOdds ?? [];
  const propPool = opts.propPool ?? [];
  return picks.map((p) => {
    const scores = p.isProp
      ? scorePropPick(p, propPool)
      : scoreGamePick(p, realOdds, opts.matchupHistory, opts.matchupInjuries);
    return { ...p, scores };
  });
}

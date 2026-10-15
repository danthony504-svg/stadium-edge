// One committed team per game for ML/spread legs on server-precomputed Coach tickets.
// Conflicting sides resolve by market-specific simulation, value, and quality —
// never by outright win probability alone when a better-qualified underdog exists.

import type { CoachGameSimEntry, ParsedPick } from "./coachSlateTypes.js";

const norm = (s: string) =>
  String(s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const teamNick = (team: string) => {
  const t = norm(team).split(" ").filter(Boolean);
  return t[t.length - 1] || "";
};

function teamsMatch(pickTeam: string, leanSide: string): boolean {
  const a = norm(pickTeam);
  const b = norm(leanSide);
  if (!a || !b) return false;
  if (a.includes(b) || b.includes(a)) return true;
  const na = teamNick(pickTeam);
  const nb = teamNick(leanSide);
  if (na.length > 2 && na === nb) return true;
  const ta = new Set(a.split(" ").filter((w) => w.length > 2));
  return b
    .split(" ")
    .filter((w) => w.length > 2)
    .some((w) => ta.has(w));
}

const SIM_SIDE_MARGIN = 0.03;

function splitLabel(label: string): { away: string; home: string } {
  const parts = String(label || "").split(" @ ");
  return { away: (parts[0] || "").trim(), home: (parts[1] || "").trim() };
}

function gameLabelsMatch(a: string, b: string): boolean {
  const pa = splitLabel(a);
  const pb = splitLabel(b);
  if (!pa.away || !pa.home || !pb.away || !pb.home) {
    return String(a).toLowerCase().trim() === String(b).toLowerCase().trim();
  }
  const overlap = (x: string, y: string) => {
    const tx = norm(x).split(" ").filter((w) => w.length > 2);
    const ty = norm(y).split(" ").filter((w) => w.length > 2);
    return tx.some((t) => ty.includes(t)) || ty.some((t) => tx.includes(t));
  };
  return overlap(pa.away, pb.away) && overlap(pa.home, pb.home);
}

function isGameLinePick(pick: ParsedPick): boolean {
  if (pick.isProp) return false;
  const m = String(pick.market ?? "").toLowerCase();
  if (/team total|race to/.test(m)) return true;
  if (/spread|run ?line|puck ?line|total|over|under|o\/u|money|h2h|\bml\b/.test(m)) return true;
  return false;
}

function isMlOrSpreadPick(pick: ParsedPick): boolean {
  if (!isGameLinePick(pick)) return false;
  const m = String(pick.market ?? "").toLowerCase();
  if (/total|over|under|o\/u/.test(m) || /\b(over|under)\b/i.test(pick.pick)) return false;
  return true;
}

function lookupGameSim(
  gameLabel: string,
  simByGame?: Map<string, CoachGameSimEntry>,
): CoachGameSimEntry | undefined {
  if (!simByGame) return undefined;
  const direct = simByGame.get(gameLabel);
  if (direct) return direct;
  for (const [label, sim] of simByGame) {
    if (gameLabelsMatch(label, gameLabel)) return sim;
  }
  return undefined;
}

function simFavoredTeamSide(sim: CoachGameSimEntry | null | undefined): "home" | "away" | null {
  const home = sim?.winProbHome;
  const away = sim?.winProbAway;
  if (home == null || away == null || !Number.isFinite(home) || !Number.isFinite(away)) {
    return null;
  }
  const diff = Math.abs(home - away);
  if (diff < SIM_SIDE_MARGIN) return null;
  return home > away ? "home" : "away";
}

type MlLeanEntry = { mlLean?: { side?: string } };

function lookupMatchupHistory(
  game: string,
  matchupHistory?: Record<string, MlLeanEntry>,
): MlLeanEntry | undefined {
  if (!matchupHistory) return undefined;
  const direct = matchupHistory[game];
  if (direct) return direct;
  for (const [label, entry] of Object.entries(matchupHistory)) {
    if (gameLabelsMatch(label, game)) return entry;
  }
  return undefined;
}

function leanSideForGame(
  game: string,
  away: string,
  home: string,
  matchupHistory?: Record<string, MlLeanEntry>,
): "home" | "away" | null {
  const entry = lookupMatchupHistory(game, matchupHistory);
  const lean = entry?.mlLean?.side;
  if (!lean) return null;
  if (teamsMatch(home, lean)) return "home";
  if (teamsMatch(away, lean)) return "away";
  return null;
}

function groupMlSpreadLegsByGame(picks: ParsedPick[]): Map<string, ParsedPick[]> {
  const groups: { game: string; legs: ParsedPick[] }[] = [];
  for (const p of picks) {
    if (!isMlOrSpreadPick(p)) continue;
    const existing = groups.find((g) => gameLabelsMatch(g.game, p.game));
    if (existing) existing.legs.push(p);
    else groups.push({ game: p.game, legs: [p] });
  }
  const byGame = new Map<string, ParsedPick[]>();
  for (const { game, legs } of groups) byGame.set(game, legs);
  return byGame;
}

function pickTeamName(pick: ParsedPick): string | null {
  const p = pick.pick || "";
  if (/\b(over|under)\b/i.test(p)) return null;
  return (
    p
      .replace(/\s*(ml|moneyline)\s*$/i, "")
      .replace(/\s*[+-]?\d+(?:\.\d+)?\s*$/, "")
      .trim() || null
  );
}

function pickTeamSide(
  pick: ParsedPick,
  away: string,
  home: string,
): "home" | "away" | null {
  const team = pickTeamName(pick);
  if (!team) return null;
  if (teamsMatch(team, home)) return "home";
  if (teamsMatch(team, away)) return "away";
  return null;
}

function pickRank(p: ParsedPick): number {
  return p.finalAiScore?.composite ?? p.scores?.composite ?? 0;
}

function coverHitForPick(pick: ParsedPick, sim: CoachGameSimEntry | undefined): number {
  // Accept coverProbs (server) or coverHitRates (client alias) for parity.
  const rates = sim?.coverProbs ?? sim?.coverHitRates;
  if (!rates) return Number.NEGATIVE_INFINITY;
  const key = `${pick.game}|${pick.market}|${pick.pick}`.toLowerCase();
  const direct = rates[key];
  if (direct != null && Number.isFinite(direct)) return direct as number;
  const pickNorm = norm(pick.pick);
  for (const [k, v] of Object.entries(rates)) {
    if (v == null || !Number.isFinite(v)) continue;
    if (norm(k).includes(pickNorm) || k.toLowerCase().includes(pick.pick.toLowerCase())) {
      return v as number;
    }
  }
  return Number.NEGATIVE_INFINITY;
}

type SideMetrics = {
  composite: number;
  edgePct: number;
  evPct: number;
  simAligned: boolean;
  qualified: boolean;
};

function americanToDecimal(odds: number): number | null {
  if (!Number.isFinite(odds) || odds === 0) return null;
  return odds > 0 ? 1 + odds / 100 : 1 + 100 / -odds;
}

function evPctFromHitAndOdds(hit: number | null, odds: number | null | undefined): number | null {
  if (hit == null || !Number.isFinite(hit) || odds == null) return null;
  const dec = americanToDecimal(odds);
  if (dec == null) return null;
  return (hit * dec - 1) * 100;
}

function legMetrics(pick: ParsedPick, sim: CoachGameSimEntry | undefined): SideMetrics {
  const composite = pick.finalAiScore?.composite ?? pick.scores?.composite ?? Number.NEGATIVE_INFINITY;
  const edgePct =
    pick.finalAiScore?.edgePct ??
    (typeof pick.scores?.edgePct === "number" ? pick.scores.edgePct : null) ??
    Number.NEGATIVE_INFINITY;
  const fromScore = pick.finalAiScore?.simHit;
  const fromCover = coverHitForPick(pick, sim);
  const marketSimHit =
    fromScore != null && Number.isFinite(fromScore)
      ? fromScore
      : Number.isFinite(fromCover)
        ? fromCover
        : Number.NEGATIVE_INFINITY;
  const simAligned =
    (pick.finalAiScore as { simAligned?: boolean } | undefined)?.simAligned === true ||
    (Number.isFinite(marketSimHit) && marketSimHit >= 0.52);
  const ev =
    evPctFromHitAndOdds(
      Number.isFinite(marketSimHit) ? marketSimHit : null,
      pick.odds,
    ) ?? Number.NEGATIVE_INFINITY;
  const qualified =
    pick.finalAiScore != null &&
    ((pick.finalAiScore as { recommends?: boolean }).recommends === true ||
      (pick.finalAiScore.composite != null && pick.finalAiScore.composite >= 6.5));
  return {
    composite: Number.isFinite(composite) ? composite : Number.NEGATIVE_INFINITY,
    edgePct: Number.isFinite(edgePct as number) ? (edgePct as number) : Number.NEGATIVE_INFINITY,
    evPct: Number.isFinite(ev) ? ev : Number.NEGATIVE_INFINITY,
    simAligned,
    qualified,
  };
}

/** Final AI / value order — never ranks by raw cover across priced lines. */
function compareMetrics(a: SideMetrics, b: SideMetrics): number {
  if (a.qualified !== b.qualified) return a.qualified ? 1 : -1;
  if (a.composite !== b.composite) return a.composite - b.composite;
  if (a.simAligned !== b.simAligned) return a.simAligned ? 1 : -1;
  if (a.edgePct !== b.edgePct) return a.edgePct - b.edgePct;
  if (a.evPct !== b.evPct) return a.evPct - b.evPct;
  return 0;
}

function bestOnSide(
  legs: ParsedPick[],
  side: "home" | "away",
  away: string,
  home: string,
  sim: CoachGameSimEntry | undefined,
): { pick: ParsedPick; metrics: SideMetrics } | null {
  let best: { pick: ParsedPick; metrics: SideMetrics } | null = null;
  for (const leg of legs) {
    if (pickTeamSide(leg, away, home) !== side) continue;
    const metrics = legMetrics(leg, sim);
    if (!best || compareMetrics(metrics, best.metrics) > 0) best = { pick: leg, metrics };
  }
  return best;
}

function resolveKeepSide(
  game: string,
  legs: ParsedPick[],
  opts: {
    simByGame?: Map<string, CoachGameSimEntry>;
    matchupHistory?: Record<string, MlLeanEntry>;
  },
): "home" | "away" | null {
  const { away, home } = splitLabel(game);
  const sides = new Set(
    legs.map((l) => pickTeamSide(l, away, home)).filter((s): s is "home" | "away" => !!s),
  );
  if (sides.size <= 1) return null;

  const sim = lookupGameSim(game, opts.simByGame);
  const homeBest = bestOnSide(legs, "home", away, home, sim);
  const awayBest = bestOnSide(legs, "away", away, home, sim);

  if (homeBest && awayBest) {
    const cmp = compareMetrics(homeBest.metrics, awayBest.metrics);
    if (cmp > 0) return "home";
    if (cmp < 0) return "away";
  } else if (homeBest) return "home";
  else if (awayBest) return "away";

  const lean = leanSideForGame(game, away, home, opts.matchupHistory);
  if (lean) return lean;

  const noMetrics =
    (!homeBest ||
      (homeBest.metrics.composite === Number.NEGATIVE_INFINITY &&
        homeBest.metrics.edgePct === Number.NEGATIVE_INFINITY)) &&
    (!awayBest ||
      (awayBest.metrics.composite === Number.NEGATIVE_INFINITY &&
        awayBest.metrics.edgePct === Number.NEGATIVE_INFINITY));
  if (noMetrics) {
    const winProb = simFavoredTeamSide(sim);
    if (winProb) return winProb;
  }

  return pickTeamSide(legs[0]!, away, home);
}

/** One game-side leg per team bucket — drops duplicate team ML + spread stacks. */
function dedupeSameTeamGameLegs(picks: ParsedPick[]): ParsedPick[] {
  const bucketIndex = new Map<string, number>();
  const out: ParsedPick[] = [];
  for (const p of picks) {
    if (!isGameLinePick(p) || p.isProp) {
      out.push(p);
      continue;
    }
    const bucket = `${norm(p.game)}|${pickTeamName(p) ?? norm(p.pick)}`;
    const idx = bucketIndex.get(bucket);
    if (idx == null) {
      bucketIndex.set(bucket, out.length);
      out.push(p);
      continue;
    }
    if (pickRank(p) > pickRank(out[idx]!)) out[idx] = p;
  }
  return out;
}

/** Drop exact duplicate game|market|pick legs. */
function dedupeExactGameLineLegs(picks: ParsedPick[]): ParsedPick[] {
  const legIndex = new Map<string, number>();
  const out: ParsedPick[] = [];
  for (const p of picks) {
    if (!isGameLinePick(p) || p.isProp) {
      out.push(p);
      continue;
    }
    const key = `${p.game}|${p.market}|${p.pick}`.toLowerCase();
    const idx = legIndex.get(key);
    if (idx == null) {
      legIndex.set(key, out.length);
      out.push(p);
      continue;
    }
    if (pickRank(p) > pickRank(out[idx]!)) out[idx] = p;
  }
  return out;
}

export function enforceServerConsistentGameSides(
  picks: ParsedPick[],
  opts: {
    simByGame?: Map<string, CoachGameSimEntry>;
    matchupHistory?: Record<string, MlLeanEntry>;
  } = {},
): ParsedPick[] {
  const byGame = groupMlSpreadLegsByGame(picks);
  const dropKeys = new Set<string>();

  for (const [game, legs] of byGame) {
    const keep = resolveKeepSide(game, legs, opts);
    if (!keep) continue;
    const { away, home } = splitLabel(game);
    for (const leg of legs) {
      const side = pickTeamSide(leg, away, home);
      if (side && side !== keep) {
        dropKeys.add(`${leg.game}|${leg.market}|${leg.pick}`.toLowerCase());
      }
    }
  }

  const kept: ParsedPick[] = [];
  for (const p of picks) {
    const k = `${p.game}|${p.market}|${p.pick}`.toLowerCase();
    if (dropKeys.has(k)) continue;
    kept.push(p);
  }
  return kept;
}

/** Team-bucket + exact-leg + one-side-per-game dedupe for server ticket assembly. */
export function dedupeServerCoachGameLinePicks(
  picks: ParsedPick[],
  opts: {
    simByGame?: Map<string, CoachGameSimEntry>;
    matchupHistory?: Record<string, MlLeanEntry>;
  } = {},
): ParsedPick[] {
  if (!picks.some((p) => isGameLinePick(p) && !p.isProp)) return picks;
  const team = dedupeSameTeamGameLegs(picks);
  const exact = dedupeExactGameLineLegs(team);
  return enforceServerConsistentGameSides(exact, opts);
}

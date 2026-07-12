// One committed team per game for ML/spread legs on server-precomputed Coach tickets.

import type { CoachGameSimEntry, ParsedPick } from "./coachSlateTypes.js";

const norm = (s: string) =>
  String(s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
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
    const { away, home } = splitLabel(game);
    const sides = new Set(
      legs.map((l) => pickTeamSide(l, away, home)).filter((s): s is "home" | "away" => !!s),
    );
    if (sides.size <= 1) continue;

    const sim = lookupGameSim(game, opts.simByGame);
    let keep: "home" | "away" | null = simFavoredTeamSide(sim);
    if (!keep) keep = leanSideForGame(game, away, home, opts.matchupHistory);
    if (!keep) keep = pickTeamSide(legs[0]!, away, home);
    if (!keep) continue;

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

import type { InjuryEntry, InjuryTeam } from "./api";

// Normalize a free-text name for matching: lowercase, strip accents, drop
// generational suffixes and punctuation, collapse whitespace. Used to line up
// the odds feed's player/team strings with ESPN's injury report names.
const norm = (s: string): string =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, "")
    .replace(/[^a-z ]/g, "")
    .replace(/\s+/g, " ")
    .trim();

const words = (s: string): string[] => norm(s).split(" ").filter(Boolean);

// Word-boundary subset match between two team names. True when every word of
// the shorter name appears as a WHOLE word in the longer one — so "Lakers"
// matches "Los Angeles Lakers" but "ny" never matches inside "brooklyn", and
// "Los Angeles Clippers" never matches "Los Angeles Lakers". Avoids the
// over-matching a raw substring check would cause.
export function teamNameMatches(a: string, b: string): boolean {
  const aw = words(a);
  const bw = words(b);
  if (aw.length === 0 || bw.length === 0) return false;
  const [short, long] = aw.length <= bw.length ? [aw, bw] : [bw, aw];
  const longSet = new Set(long);
  return short.every((w) => longSet.has(w));
}

// Result of a single-player injury lookup. We distinguish "ambiguous" (more
// than one player in the league shares this name) from "none" so the UI never
// claims a player is healthy when we simply couldn't be sure which one it is.
export type InjuryLookup =
  | { status: "found"; entry: InjuryEntry }
  | { status: "none" }
  | { status: "ambiguous" };

// Find one player's REAL injury designation in the league-wide report. Exact
// normalized-name match only — never a fuzzy/substring guess. Fail-closed: a
// match is only accepted when EXACTLY ONE player in the league carries that
// name; duplicate names return "ambiguous" so we don't attach a real status to
// the wrong person.
export function findPlayerInjury(
  teams: InjuryTeam[] | undefined,
  player: string,
): InjuryLookup {
  if (!teams || !player) return { status: "none" };
  const target = norm(player);
  if (!target) return { status: "none" };
  const matches: InjuryEntry[] = [];
  for (const t of teams) {
    for (const e of t.entries) {
      if (norm(e.player) === target) matches.push(e);
    }
  }
  if (matches.length === 0) return { status: "none" };
  if (matches.length > 1) return { status: "ambiguous" };
  return { status: "found", entry: matches[0] };
}

// The injury groups for BOTH sides of a matchup. Matches each ESPN team by a
// word-boundary name match (or exact abbreviation) against the two free-text
// names from the odds feed — no loose substring matching that could pull in a
// third, unrelated team.
export function injuriesForMatchup(
  teams: InjuryTeam[] | undefined,
  names: string[],
): InjuryTeam[] {
  if (!teams) return [];
  const wanted = names.filter((n) => norm(n).length > 0);
  if (wanted.length === 0) return [];
  return teams.filter((t) => {
    const ta = norm(t.teamAbbr);
    return wanted.some(
      (n) => teamNameMatches(t.team, n) || (ta.length > 0 && ta === norm(n)),
    );
  });
}

// Severity bucket for an ESPN status string → drives the badge colour. Default
// is "doubt" (amber) for anything on the report we don't recognise as either
// fully out or fully cleared.
export type InjuryTone = "out" | "doubt" | "ok";
export function injuryTone(status: string): InjuryTone {
  const s = status.toLowerCase();
  if (/probable|active|available/.test(s)) return "ok";
  if (
    /\bout\b|injured reserve|\bir\b|\bil\b|suspend|inactive|doubtful|10-day|15-day|60-day|season/.test(
      s,
    )
  )
    return "out";
  return "doubt";
}

// ---------- Injury impact (deterministic heuristic, NOT a fabricated metric) ----------
//
// HONESTY NOTE: the app has no WAR / depth-chart / starter feed. So "impact" is
// NOT a player rating — it is a transparent, deterministic guide derived only
// from two REAL inputs ESPN gives us: how severe the designation is, and the
// player's position. It tells a casual bettor "is this a starter who's out for
// the season, or a reliever who's day-to-day?". The UI labels it as a guide,
// never as a precise number.

// Fan-friendly label + severity for one ESPN status string.
// severity: 3 = out long-term, 2 = out, 1 = questionable / short absence,
// 0 = effectively available. Order of checks matters (most-severe first).
export type InjurySeverity = {
  label: string;
  tier: "long" | "out" | "quest" | "ok";
  severity: number;
};
export function friendlyInjury(status: string): InjurySeverity {
  const s = status.toLowerCase();
  if (/probable|\bactive\b|available/.test(s))
    return { label: "Probable", tier: "ok", severity: 0 };
  if (/season|60-?day|injured reserve|\bir\b|out for (the )?season/.test(s))
    return { label: "Out Long-Term", tier: "long", severity: 3 };
  if (/\bout\b|10-?day|15-?day|doubtful|suspend|inactive|\bil\b|\bdl\b/.test(s))
    return { label: "Out", tier: "out", severity: 2 };
  if (/day-?to-?day|questionable|game-?time/.test(s))
    return { label: "Questionable", tier: "quest", severity: 1 };
  if (/bereavement|paternity|personal|family|illness|covid|\brest\b/.test(s))
    return { label: "Unavailable", tier: "quest", severity: 1 };
  // On the report but unrecognised — show ESPN's own wording, treat as short.
  return { label: status, tier: "quest", severity: 1 };
}

// How much a position matters when its holder is unavailable, per sport. We can
// only see the position abbreviation (not who starts), so this is intentionally
// coarse: premium positions (MLB starters, NFL QBs, goalies) weigh more.
export function positionWeight(sport: string, position: string | null): number {
  const p = (position ?? "").toUpperCase();
  switch (sport) {
    case "mlb":
      if (p === "SP") return 3;
      if (p === "RP" || p === "CP" || p === "CL") return 1;
      if (p === "P") return 2;
      return 2; // position players (batters)
    case "nfl":
    case "ncaaf":
      if (p === "QB") return 3;
      if (["RB", "FB", "WR", "TE"].includes(p)) return 2;
      if (["K", "P", "LS"].includes(p)) return 1;
      return 2; // linemen / defense
    case "nhl":
      return p === "G" ? 3 : 2;
    case "soccer":
      return p === "G" || p === "GK" ? 3 : 2;
    default:
      return 2; // nba/wnba/ncaab/tennis/ufc — can't infer role from position
  }
}

// Coarse position group for the per-team counts ("SP 2 · RP 3 · Batters 10").
export function positionGroup(sport: string, position: string | null): string {
  const p = (position ?? "").toUpperCase();
  if (!p) return "Other";
  switch (sport) {
    case "mlb":
      if (p === "SP") return "SP";
      if (p === "RP" || p === "CP" || p === "CL") return "RP";
      if (p === "P") return "P";
      return "Batters";
    case "nfl":
    case "ncaaf":
      if (p === "QB") return "QB";
      if (["RB", "FB", "WR", "TE"].includes(p)) return "Offense";
      if (["C", "G", "T", "OL", "OT", "OG", "LT", "RT", "LG", "RG"].includes(p)) return "O-Line";
      if (["K", "P", "LS"].includes(p)) return "Special";
      return "Defense";
    case "nhl":
      if (p === "G") return "Goalies";
      if (["D", "LD", "RD"].includes(p)) return "Defense";
      return "Forwards";
    default:
      return p; // nba / soccer / etc — show the raw position
  }
}

export type InjuryImpactTier = "high" | "med" | "low" | "none";
// Combine real severity × position weight into a tier. A 0-severity (available)
// entry is "none" so it never inflates a team's injury picture.
export function injuryImpact(
  sport: string,
  entry: InjuryEntry,
): { score: number; tier: InjuryImpactTier } {
  const sev = friendlyInjury(entry.status).severity;
  if (sev === 0) return { score: 0, tier: "none" };
  const score = sev * positionWeight(sport, entry.position);
  const tier: InjuryImpactTier = score >= 6 ? "high" : score >= 3 ? "med" : "low";
  return { score, tier };
}

export type TeamInjurySummary = {
  team: string;
  totalScore: number;
  highCount: number;
  groups: { group: string; count: number }[];
};
// Roll one team's real injuries up into a total impact score, a high-impact
// count, and per-position-group counts (sorted by count desc for a stable view).
export function summarizeTeamInjuries(sport: string, t: InjuryTeam): TeamInjurySummary {
  let totalScore = 0;
  let highCount = 0;
  const groupMap = new Map<string, number>();
  for (const e of t.entries) {
    const { tier, score } = injuryImpact(sport, e);
    totalScore += score;
    if (tier === "high") highCount += 1;
    const g = positionGroup(sport, e.position);
    groupMap.set(g, (groupMap.get(g) ?? 0) + 1);
  }
  const groups = [...groupMap.entries()]
    .map(([group, count]) => ({ group, count }))
    .sort((a, b) => b.count - a.count);
  return { team: t.team, totalScore, highCount, groups };
}

// The injury EDGE between two summaries: the LESS-injured team benefits. Require
// a meaningful gap (~one high-impact injury) before claiming an edge, else even.
export type InjuryEdge =
  | { kind: "even" }
  | { kind: "advantage"; team: string; opp: string; margin: number };
export function injuryEdge(summaries: TeamInjurySummary[]): InjuryEdge {
  if (summaries.length !== 2) return { kind: "even" };
  const [a, b] = summaries;
  const diff = a.totalScore - b.totalScore; // higher score = more hurt
  if (Math.abs(diff) < 3) return { kind: "even" };
  const healthy = diff > 0 ? b : a;
  const hurt = diff > 0 ? a : b;
  return { kind: "advantage", team: healthy.team, opp: hurt.team, margin: Math.abs(diff) };
}

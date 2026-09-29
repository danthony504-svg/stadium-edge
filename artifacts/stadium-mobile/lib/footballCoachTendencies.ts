/**
 * Soft head-coach tendency profiles for NFL / NCAAF.
 * Documented play-calling reputations on a -2..+2 scale — never invented
 * per-game stats. Missing teams return null (fail closed).
 */

export type FootballCoachSport = "nfl" | "ncaaf";

export type FootballCoachProfile = {
  name: string;
  team: string;
  sport: FootballCoachSport;
  /** +2 = hyper-aggressive 4th-down / tempo; -2 = conservative clock. */
  aggressive: number;
  /** +2 = strong as favorite; -2 = better live dog. */
  favLean: number;
  notes: string;
};

const NFL_COACHES: FootballCoachProfile[] = [
  { name: "Andy Reid", team: "KC", sport: "nfl", aggressive: 2, favLean: 2, notes: "Aggressive 4th-down; elite scripted offense." },
  { name: "Sean McVay", team: "LAR", sport: "nfl", aggressive: 2, favLean: 1, notes: "High-tempo offense; strong opening scripts." },
  { name: "Dan Campbell", team: "DET", sport: "nfl", aggressive: 2, favLean: 1, notes: "Hyper-aggressive 4th-down; high variance totals." },
  { name: "Kyle Shanahan", team: "SF", sport: "nfl", aggressive: 1, favLean: 2, notes: "Scheme-driven; strong as favorite." },
  { name: "John Harbaugh", team: "BAL", sport: "nfl", aggressive: 1, favLean: 1, notes: "Analytics-forward 4th-down / 2-pt." },
  { name: "Mike Tomlin", team: "PIT", sport: "nfl", aggressive: 0, favLean: -1, notes: "Tough as underdog; balanced game scripts." },
  { name: "Nick Sirianni", team: "PHI", sport: "nfl", aggressive: 1, favLean: 1, notes: "Aggressive early downs; tempo with lead." },
  { name: "Sean McDermott", team: "BUF", sport: "nfl", aggressive: 1, favLean: 1, notes: "Pass-lean scripts; competitive in big spots." },
  { name: "Mike Vrabel", team: "NE", sport: "nfl", aggressive: 0, favLean: 0, notes: "Defense-first identity; conservative finishes." },
  { name: "Kevin Stefanski", team: "CLE", sport: "nfl", aggressive: 1, favLean: 0, notes: "Run-heavy identity; situational aggression." },
  { name: "Zac Taylor", team: "CIN", sport: "nfl", aggressive: 1, favLean: 1, notes: "Pass-forward when healthy at QB." },
  { name: "Matt LaFleur", team: "GB", sport: "nfl", aggressive: 1, favLean: 1, notes: "Packaged-play offense; mid-range aggression." },
  { name: "Mike McDaniel", team: "MIA", sport: "nfl", aggressive: 1, favLean: 1, notes: "Motion-heavy; pace when leading." },
  { name: "Todd Bowles", team: "TB", sport: "nfl", aggressive: 0, favLean: 0, notes: "Defense-first; measured 4th-down." },
  { name: "Brian Daboll", team: "NYG", sport: "nfl", aggressive: 1, favLean: 0, notes: "Analytics lean on 4th; variance with young QBs." },
  { name: "Aaron Glenn", team: "NYJ", sport: "nfl", aggressive: 0, favLean: 0, notes: "Defense-rooted; conservative game flow." },
  { name: "DeMeco Ryans", team: "HOU", sport: "nfl", aggressive: 1, favLean: 1, notes: "Balanced scripts; assertive with lead." },
  { name: "Shane Steichen", team: "IND", sport: "nfl", aggressive: 1, favLean: 0, notes: "QB-friendly design; mid aggression." },
  { name: "Doug Pederson", team: "JAX", sport: "nfl", aggressive: 1, favLean: 0, notes: "Historically aggressive late-game calls." },
  { name: "Brian Callahan", team: "TEN", sport: "nfl", aggressive: 0, favLean: 0, notes: "Complementary football; measured pace." },
  { name: "Dave Canales", team: "CAR", sport: "nfl", aggressive: 0, favLean: 0, notes: "Development-first; limited aggression." },
  { name: "Raheem Morris", team: "ATL", sport: "nfl", aggressive: 1, favLean: 1, notes: "Balanced; leans on skill-talent scripts." },
  { name: "Kellen Moore", team: "NO", sport: "nfl", aggressive: 1, favLean: 0, notes: "Pass-lean design background." },
  { name: "Ben Johnson", team: "CHI", sport: "nfl", aggressive: 2, favLean: 1, notes: "Creative/aggressive play designs." },
  { name: "Kevin O'Connell", team: "MIN", sport: "nfl", aggressive: 1, favLean: 1, notes: "Aggressive through air; situational 4th." },
  { name: "Sean Payton", team: "DEN", sport: "nfl", aggressive: 1, favLean: 1, notes: "Veteran play-caller; assertive with lead." },
  { name: "Pete Carroll", team: "LV", sport: "nfl", aggressive: 0, favLean: 0, notes: "Run-lean identity; physical script." },
  { name: "Jim Harbaugh", team: "LAC", sport: "nfl", aggressive: 1, favLean: 1, notes: "Physical run identity; situational aggression." },
  { name: "Brian Schottenheimer", team: "DAL", sport: "nfl", aggressive: 0, favLean: 0, notes: "Conservative lean historically as OC; soft only." },
  { name: "Mike Macdonald", team: "SEA", sport: "nfl", aggressive: 0, favLean: 0, notes: "Defense-rooted; complementary offense." },
  { name: "Jonathan Gannon", team: "ARI", sport: "nfl", aggressive: 0, favLean: 0, notes: "Defense-first; measured scripts." },
  { name: "Dan Quinn", team: "WSH", sport: "nfl", aggressive: 1, favLean: 1, notes: "Aggressive defense; assertive offense lean." },
];

const NCAAF_COACHES: FootballCoachProfile[] = [
  { name: "Kirby Smart", team: "UGA", sport: "ncaaf", aggressive: 1, favLean: 2, notes: "Defense-first; dominant as favorite." },
  { name: "Lane Kiffin", team: "MISS", sport: "ncaaf", aggressive: 2, favLean: 1, notes: "Aggressive tempo offense — over lean." },
  { name: "Ryan Day", team: "OSU", sport: "ncaaf", aggressive: 1, favLean: 2, notes: "Explosive offense; strong favorite profile." },
  { name: "Kalèn DeBoer", team: "ALA", sport: "ncaaf", aggressive: 1, favLean: 2, notes: "Efficient offense; assertive as favorite." },
  { name: "Steve Sarkisian", team: "TEX", sport: "ncaaf", aggressive: 2, favLean: 2, notes: "Aggressive play-caller; high ceiling scripts." },
  { name: "Lincoln Riley", team: "USC", sport: "ncaaf", aggressive: 2, favLean: 1, notes: "Pass-heavy tempo — totals lean over." },
  { name: "Marcus Freeman", team: "ND", sport: "ncaaf", aggressive: 1, favLean: 1, notes: "Physical identity; situational aggression." },
  { name: "Dan Lanning", team: "ORE", sport: "ncaaf", aggressive: 1, favLean: 2, notes: "Tempo offense; strong favorite profile." },
  { name: "James Franklin", team: "PSU", sport: "ncaaf", aggressive: 0, favLean: 1, notes: "Complementary; measured late-game." },
  { name: "Brian Kelly", team: "LSU", sport: "ncaaf", aggressive: 1, favLean: 1, notes: "Balanced SEC scripts." },
  { name: "Billy Napier", team: "FLA", sport: "ncaaf", aggressive: 0, favLean: 0, notes: "Methodical offense; soft lean only." },
  { name: "Dabo Swinney", team: "CLEM", sport: "ncaaf", aggressive: 0, favLean: 1, notes: "Conservative finishes as favorite." },
  { name: "Josh Heupel", team: "TENN", sport: "ncaaf", aggressive: 2, favLean: 1, notes: "Extreme tempo — over lean on totals." },
  { name: "Mario Cristobal", team: "MIA", sport: "ncaaf", aggressive: 0, favLean: 1, notes: "Physical run identity." },
  { name: "Sherrone Moore", team: "MICH", sport: "ncaaf", aggressive: 0, favLean: 1, notes: "Run-first; clock-friendly leads." },
  { name: "Brent Venables", team: "OU", sport: "ncaaf", aggressive: 1, favLean: 1, notes: "Defense-rooted; mid aggression." },
  { name: "Deion Sanders", team: "COLO", sport: "ncaaf", aggressive: 1, favLean: 0, notes: "Aggressive identity; variance." },
  { name: "Luke Fickell", team: "WIS", sport: "ncaaf", aggressive: 0, favLean: 0, notes: "Physical / slower pace lean." },
  { name: "Eliah Drinkwitz", team: "MIZ", sport: "ncaaf", aggressive: 1, favLean: 1, notes: "Tempo-friendly scripts." },
  { name: "Mike Elko", team: "TA&M", sport: "ncaaf", aggressive: 0, favLean: 1, notes: "Defense-first; measured offense." },
  { name: "Mike Elko", team: "TAMU", sport: "ncaaf", aggressive: 0, favLean: 1, notes: "Defense-first; measured offense." },
];

function normAbbr(s: string | null | undefined): string {
  return String(s ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9&]/g, "");
}

/** Lookup by ESPN team abbreviation. Duplicate DAL rows: prefer the last match. */
export function lookupFootballCoach(
  sport: string | null | undefined,
  teamAbbr: string | null | undefined,
): FootballCoachProfile | null {
  const sp = String(sport ?? "").toLowerCase();
  if (sp !== "nfl" && sp !== "ncaaf") return null;
  const key = normAbbr(teamAbbr);
  if (!key) return null;
  const list = sp === "nfl" ? NFL_COACHES : NCAAF_COACHES;
  let hit: FootballCoachProfile | null = null;
  for (const c of list) {
    if (normAbbr(c.team) === key) hit = c;
  }
  return hit;
}

/**
 * Soft composite tilt (-0.4..+0.4) from home/away coach tendencies.
 * Totals/overs get aggressive boost; favorites get favLean boost; dogs get the inverse.
 * Never fabricates — returns 0 when no coaches resolve.
 */
export function footballCoachSoftTilt(opts: {
  sport?: string | null;
  market?: string | null;
  pick?: string | null;
  homeAbbr?: string | null;
  awayAbbr?: string | null;
  /** True when the pick is on the home side / home total. */
  homeSide?: boolean | null;
  /** Pre-resolved coaches from footballGameEnv (preferred). */
  coaches?: {
    home?: { name: string; aggressive: number; favLean: number } | null;
    away?: { name: string; aggressive: number; favLean: number } | null;
  } | null;
}): number {
  const home =
    opts.coaches?.home ??
    lookupFootballCoach(opts.sport, opts.homeAbbr);
  const away =
    opts.coaches?.away ??
    lookupFootballCoach(opts.sport, opts.awayAbbr);
  if (!home && !away) return 0;

  const m = `${opts.market ?? ""} ${opts.pick ?? ""}`.toLowerCase();
  const isTotal =
    /\btotal\b|\bo\/u\b/.test(m) ||
    ((/\bover\b|\bunder\b/.test(m) && !/player_|pass_|rush_|rec|tackle|sack|kick/.test(m)));
  const isOver = /\bover\b/.test(m);
  const isUnder = /\bunder\b/.test(m);
  const isSpreadOrMl = /spread|moneyline|\bml\b|run line|puck line/.test(m);
  const isPassProp = /pass|passing/.test(m);
  const isAnytimeTd = /anytime.?td|touchdown/.test(m);

  const agg = ((home?.aggressive ?? 0) + (away?.aggressive ?? 0)) / 2;
  let tilt = 0;

  if (isTotal || isPassProp || isAnytimeTd) {
    if (isOver) tilt += agg * 0.12;
    else if (isUnder) tilt -= agg * 0.12;
  }

  if (isSpreadOrMl && opts.homeSide != null) {
    const sideCoach = opts.homeSide ? home : away;
    if (sideCoach) {
      tilt += sideCoach.favLean * 0.06;
    }
  }

  return Math.max(-0.4, Math.min(0.4, Math.round(tilt * 100) / 100));
}

export function footballCoachEdgeBits(opts: {
  sport?: string | null;
  homeAbbr?: string | null;
  awayAbbr?: string | null;
}): string[] {
  const bits: string[] = [];
  const home = lookupFootballCoach(opts.sport, opts.homeAbbr);
  const away = lookupFootballCoach(opts.sport, opts.awayAbbr);
  if (home && home.aggressive >= 2) {
    bits.push(`${home.name} aggressive play-caller`);
  }
  if (away && away.aggressive >= 2) {
    bits.push(`${away.name} aggressive play-caller`);
  }
  if (home && home.favLean >= 2) {
    bits.push(`${home.name} strong as favorite`);
  }
  return bits;
}

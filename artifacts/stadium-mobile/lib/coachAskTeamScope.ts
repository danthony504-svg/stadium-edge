/**
 * Map unambiguous pro-team nicknames in Coach asks to a sport (+ match tokens).
 * "7 leg saints game" must not load the multi-sport board and fill with MLB.
 *
 * Ambiguous nicknames (Giants, Cardinals, Rangers, …) are ignored unless a
 * disambiguating city/region token appears alongside them.
 */

export type CoachAskTeamScope = {
  sport: string;
  /** Lowercase tokens that identify the franchise in Odds/ESPN labels. */
  matchTokens: string[];
};

/** Nicknames that collide across leagues — require a city/region cue. */
const AMBIGUOUS_NICKNAMES = new Set([
  "giants", // NFL NY vs MLB SF
  "cardinals", // NFL Arizona vs MLB St. Louis
  "rangers", // MLB Texas vs NHL NY
  "panthers", // NFL Carolina vs NHL Florida
  "kings", // NBA Sacramento vs NHL LA
  "jets", // NFL NY vs NHL Winnipeg
  "lions", // NFL Detroit vs (rare) others
]);

type NickEntry = { sport: string; tokens: string[] };

/** Unambiguous (or city-disambiguated) nickname → sport. */
const NICK_TO_SPORT: Record<string, NickEntry> = {
  // NFL
  saints: { sport: "nfl", tokens: ["saints", "new orleans"] },
  chiefs: { sport: "nfl", tokens: ["chiefs", "kansas city"] },
  bills: { sport: "nfl", tokens: ["bills", "buffalo"] },
  bengals: { sport: "nfl", tokens: ["bengals", "cincinnati"] },
  ravens: { sport: "nfl", tokens: ["ravens", "baltimore"] },
  cowboys: { sport: "nfl", tokens: ["cowboys", "dallas"] },
  eagles: { sport: "nfl", tokens: ["eagles", "philadelphia"] },
  "49ers": { sport: "nfl", tokens: ["49ers", "niners", "san francisco"] },
  niners: { sport: "nfl", tokens: ["49ers", "niners", "san francisco"] },
  rams: { sport: "nfl", tokens: ["rams"] },
  packers: { sport: "nfl", tokens: ["packers", "green bay"] },
  dolphins: { sport: "nfl", tokens: ["dolphins", "miami"] },
  patriots: { sport: "nfl", tokens: ["patriots", "new england"] },
  steelers: { sport: "nfl", tokens: ["steelers", "pittsburgh"] },
  broncos: { sport: "nfl", tokens: ["broncos", "denver"] },
  chargers: { sport: "nfl", tokens: ["chargers"] },
  raiders: { sport: "nfl", tokens: ["raiders", "las vegas"] },
  vikings: { sport: "nfl", tokens: ["vikings", "minnesota"] },
  bears: { sport: "nfl", tokens: ["bears", "chicago"] },
  falcons: { sport: "nfl", tokens: ["falcons", "atlanta"] },
  buccaneers: { sport: "nfl", tokens: ["buccaneers", "bucs", "tampa bay"] },
  bucs: { sport: "nfl", tokens: ["buccaneers", "bucs", "tampa bay"] },
  seahawks: { sport: "nfl", tokens: ["seahawks", "seattle"] },
  texans: { sport: "nfl", tokens: ["texans", "houston"] },
  colts: { sport: "nfl", tokens: ["colts", "indianapolis"] },
  jaguars: { sport: "nfl", tokens: ["jaguars", "jags", "jacksonville"] },
  jags: { sport: "nfl", tokens: ["jaguars", "jags", "jacksonville"] },
  titans: { sport: "nfl", tokens: ["titans", "tennessee"] },
  browns: { sport: "nfl", tokens: ["browns", "cleveland"] },
  commanders: { sport: "nfl", tokens: ["commanders", "washington"] },
  // lions / jets / giants / cardinals / panthers / kings are ambiguous —
  // handled only with city cues below (see AMBIGUOUS_NICKNAMES).
  "detroit lions": { sport: "nfl", tokens: ["lions", "detroit"] },
  "ny jets": { sport: "nfl", tokens: ["jets", "new york"] },
  "new york jets": { sport: "nfl", tokens: ["jets", "new york"] },
  "ny giants": { sport: "nfl", tokens: ["giants", "new york"] },
  "new york giants": { sport: "nfl", tokens: ["giants", "new york"] },
  "arizona cardinals": { sport: "nfl", tokens: ["cardinals", "arizona"] },
  "carolina panthers": { sport: "nfl", tokens: ["panthers", "carolina"] },
  "florida panthers": { sport: "nhl", tokens: ["panthers", "florida"] },
  "sacramento kings": { sport: "nba", tokens: ["kings", "sacramento"] },
  "st louis cardinals": { sport: "mlb", tokens: ["cardinals", "st louis", "st. louis"] },
  "st. louis cardinals": { sport: "mlb", tokens: ["cardinals", "st louis", "st. louis"] },
  "san francisco giants": { sport: "mlb", tokens: ["giants", "san francisco"] },
  "texas rangers": { sport: "mlb", tokens: ["rangers", "texas"] },
  "new york rangers": { sport: "nhl", tokens: ["rangers", "new york"] },

  // MLB (unambiguous nicknames)
  yankees: { sport: "mlb", tokens: ["yankees", "new york"] },
  dodgers: { sport: "mlb", tokens: ["dodgers", "los angeles"] },
  braves: { sport: "mlb", tokens: ["braves", "atlanta"] },
  phillies: { sport: "mlb", tokens: ["phillies", "philadelphia"] },
  mets: { sport: "mlb", tokens: ["mets", "new york"] },
  "red sox": { sport: "mlb", tokens: ["red sox", "boston"] },
  astros: { sport: "mlb", tokens: ["astros", "houston"] },
  padres: { sport: "mlb", tokens: ["padres", "san diego"] },
  cubs: { sport: "mlb", tokens: ["cubs", "chicago"] },
  "white sox": { sport: "mlb", tokens: ["white sox", "chicago"] },
  brewers: { sport: "mlb", tokens: ["brewers", "milwaukee"] },
  twins: { sport: "mlb", tokens: ["twins", "minnesota"] },
  mariners: { sport: "mlb", tokens: ["mariners", "seattle"] },
  athletics: { sport: "mlb", tokens: ["athletics", "oakland", "a's"] },
  angels: { sport: "mlb", tokens: ["angels", "los angeles"] },
  "blue jays": { sport: "mlb", tokens: ["blue jays", "toronto"] },
  orioles: { sport: "mlb", tokens: ["orioles", "baltimore"] },
  rays: { sport: "mlb", tokens: ["rays", "tampa bay"] },
  guardians: { sport: "mlb", tokens: ["guardians", "cleveland"] },
  tigers: { sport: "mlb", tokens: ["tigers", "detroit"] },
  royals: { sport: "mlb", tokens: ["royals", "kansas city"] },
  reds: { sport: "mlb", tokens: ["reds", "cincinnati"] },
  pirates: { sport: "mlb", tokens: ["pirates", "pittsburgh"] },
  marlins: { sport: "mlb", tokens: ["marlins", "miami"] },
  nationals: { sport: "mlb", tokens: ["nationals", "washington"] },
  rockies: { sport: "mlb", tokens: ["rockies", "colorado"] },
  diamondbacks: { sport: "mlb", tokens: ["diamondbacks", "dbacks", "arizona"] },
  dbacks: { sport: "mlb", tokens: ["diamondbacks", "dbacks", "arizona"] },

  // NBA
  lakers: { sport: "nba", tokens: ["lakers", "los angeles"] },
  celtics: { sport: "nba", tokens: ["celtics", "boston"] },
  warriors: { sport: "nba", tokens: ["warriors", "golden state"] },
  nuggets: { sport: "nba", tokens: ["nuggets", "denver"] },
  bucks: { sport: "nba", tokens: ["bucks", "milwaukee"] },
  heat: { sport: "nba", tokens: ["heat", "miami"] },
  knicks: { sport: "nba", tokens: ["knicks", "new york"] },
  sixers: { sport: "nba", tokens: ["sixers", "76ers", "philadelphia"] },
  "76ers": { sport: "nba", tokens: ["sixers", "76ers", "philadelphia"] },
  suns: { sport: "nba", tokens: ["suns", "phoenix"] },
  mavericks: { sport: "nba", tokens: ["mavericks", "mavs", "dallas"] },
  mavs: { sport: "nba", tokens: ["mavericks", "mavs", "dallas"] },
  thunder: { sport: "nba", tokens: ["thunder", "oklahoma city", "okc"] },
  timberwolves: { sport: "nba", tokens: ["timberwolves", "wolves", "minnesota"] },
  wolves: { sport: "nba", tokens: ["timberwolves", "wolves", "minnesota"] },
  clippers: { sport: "nba", tokens: ["clippers", "los angeles"] },
  nets: { sport: "nba", tokens: ["nets", "brooklyn"] },
  bulls: { sport: "nba", tokens: ["bulls", "chicago"] },
  cavaliers: { sport: "nba", tokens: ["cavaliers", "cavs", "cleveland"] },
  cavs: { sport: "nba", tokens: ["cavaliers", "cavs", "cleveland"] },
  pistons: { sport: "nba", tokens: ["pistons", "detroit"] },
  pacers: { sport: "nba", tokens: ["pacers", "indiana"] },
  grizzlies: { sport: "nba", tokens: ["grizzlies", "memphis"] },
  hornets: { sport: "nba", tokens: ["hornets", "charlotte"] },
  magic: { sport: "nba", tokens: ["magic", "orlando"] },
  hawks: { sport: "nba", tokens: ["hawks", "atlanta"] },
  wizards: { sport: "nba", tokens: ["wizards", "washington"] },
  pelicans: { sport: "nba", tokens: ["pelicans", "new orleans"] },
  spurs: { sport: "nba", tokens: ["spurs", "san antonio"] },
  rockets: { sport: "nba", tokens: ["rockets", "houston"] },
  raptors: { sport: "nba", tokens: ["raptors", "toronto"] },
  jazz: { sport: "nba", tokens: ["jazz", "utah"] },
  "trail blazers": { sport: "nba", tokens: ["trail blazers", "blazers", "portland"] },
  blazers: { sport: "nba", tokens: ["trail blazers", "blazers", "portland"] },
};

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * First unambiguous team nickname in the ask → sport + match tokens.
 * Prefers longer nicknames ("red sox" before "sox" if ever added).
 */
export function coachAskTeamScope(
  text: string | null | undefined,
): CoachAskTeamScope | null {
  const t = String(text ?? "");
  if (!t.trim()) return null;
  const nicks = Object.keys(NICK_TO_SPORT).sort((a, b) => b.length - a.length);
  for (const nick of nicks) {
    // Multi-word keys ("new york giants") use a looser boundary check.
    const pat =
      nick.includes(" ") || nick.includes(".")
        ? new RegExp(escapeRegExp(nick), "i")
        : new RegExp(`\\b${escapeRegExp(nick)}\\b`, "i");
    if (!pat.test(t)) continue;
    // Bare ambiguous nicknames never auto-scope (giants / cardinals / …).
    if (AMBIGUOUS_NICKNAMES.has(nick.toLowerCase())) continue;
    const entry = NICK_TO_SPORT[nick]!;
    return { sport: entry.sport, matchTokens: entry.tokens.map((x) => x.toLowerCase()) };
  }
  return null;
}

/** Sports implied by team nicknames in the ask (feeds focalSportsFromText). */
export function sportsFromAskTeamNicknames(
  text: string | null | undefined,
): Set<string> {
  const out = new Set<string>();
  const scope = coachAskTeamScope(text);
  if (scope) out.add(scope.sport);
  return out;
}

function labelMatchesTeamTokens(
  label: string,
  tokens: readonly string[],
): boolean {
  const g = label.toLowerCase();
  return tokens.some((tok) => g.includes(tok));
}

/** Keep only odds games that include the named franchise. Strict: empty > wrong games. */
export function filterOddsGamesForAskTeam<
  T extends { homeTeam?: string; awayTeam?: string; sport?: string },
>(games: T[], scope: CoachAskTeamScope | null): T[] {
  if (!scope || !games.length) return games;
  return games.filter((g) => {
    if (g.sport && g.sport !== scope.sport) return false;
    const label = `${g.awayTeam ?? ""} @ ${g.homeTeam ?? ""}`;
    return labelMatchesTeamTokens(label, scope.matchTokens);
  });
}

/** Final ticket defense: drop legs outside the named franchise's game. Strict. */
export function filterPicksForAskTeam<
  T extends { game?: string | null; sport?: string | null },
>(picks: T[], scope: CoachAskTeamScope | null): T[] {
  if (!scope || !picks.length) return picks;
  return picks.filter((p) => {
    if (p.sport && p.sport !== scope.sport) return false;
    return labelMatchesTeamTokens(String(p.game ?? ""), scope.matchTokens);
  });
}

/**
 * Honest copy when a named franchise was asked for but is not on tonight's board.
 * Prefer empty over filling with Falcons / other NFL games.
 */
export function coachAskTeamMissNote(
  scope: CoachAskTeamScope | null,
  matchedGameCount: number,
): string {
  if (!scope || matchedGameCount > 0) return "";
  const nick = scope.matchTokens[0] ?? "that team";
  return `No ${nick} matchup is on tonight's ${scope.sport.toUpperCase()} board — won't fill with other games.`;
}

/**
 * True when the ask names a franchise we can scope to (with or without "game").
 * "6 leg Saints" and "7 leg saints game" both qualify.
 */
export function askNamesTeamGame(text: string | null | undefined): boolean {
  return coachAskTeamScope(text) != null;
}

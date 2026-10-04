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

/** Explicit negative franchise constraint — exclude the entire matchup. */
export type CoachAskExcludedTeam = {
  sport: string;
  /** Lowercase tokens that identify the franchise in Odds/ESPN labels. */
  matchTokens: string[];
  /** Nickname key matched in the ask (e.g. "ducks", "anaheim"). */
  nick: string;
  /** Human-readable franchise label for diagnostics. */
  name: string;
  /**
   * ESPN (or board) team ids when resolved from loaded games.
   * Empty until resolveExcludedTeamIdsFromGames runs.
   */
  teamIds: string[];
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

  // NHL (unambiguous nicknames + city forms for exclusions)
  ducks: { sport: "nhl", tokens: ["ducks", "anaheim"] },
  anaheim: { sport: "nhl", tokens: ["ducks", "anaheim"] },
  "anaheim ducks": { sport: "nhl", tokens: ["ducks", "anaheim"] },
  bruins: { sport: "nhl", tokens: ["bruins", "boston"] },
  "boston bruins": { sport: "nhl", tokens: ["bruins", "boston"] },
  sabres: { sport: "nhl", tokens: ["sabres", "buffalo"] },
  "buffalo sabres": { sport: "nhl", tokens: ["sabres", "buffalo"] },
  flames: { sport: "nhl", tokens: ["flames", "calgary"] },
  "calgary flames": { sport: "nhl", tokens: ["flames", "calgary"] },
  hurricanes: { sport: "nhl", tokens: ["hurricanes", "carolina"] },
  "carolina hurricanes": { sport: "nhl", tokens: ["hurricanes", "carolina"] },
  "blackhawks": { sport: "nhl", tokens: ["blackhawks", "chicago"] },
  "chicago blackhawks": { sport: "nhl", tokens: ["blackhawks", "chicago"] },
  avalanche: { sport: "nhl", tokens: ["avalanche", "colorado"] },
  "colorado avalanche": { sport: "nhl", tokens: ["avalanche", "colorado"] },
  "blue jackets": { sport: "nhl", tokens: ["blue jackets", "columbus"] },
  "columbus blue jackets": { sport: "nhl", tokens: ["blue jackets", "columbus"] },
  stars: { sport: "nhl", tokens: ["stars", "dallas"] },
  "dallas stars": { sport: "nhl", tokens: ["stars", "dallas"] },
  "red wings": { sport: "nhl", tokens: ["red wings", "detroit"] },
  "detroit red wings": { sport: "nhl", tokens: ["red wings", "detroit"] },
  oilers: { sport: "nhl", tokens: ["oilers", "edmonton"] },
  "edmonton oilers": { sport: "nhl", tokens: ["oilers", "edmonton"] },
  "golden knights": { sport: "nhl", tokens: ["golden knights", "vegas", "las vegas"] },
  "vegas golden knights": { sport: "nhl", tokens: ["golden knights", "vegas", "las vegas"] },
  "la kings": { sport: "nhl", tokens: ["kings", "los angeles"] },
  "los angeles kings": { sport: "nhl", tokens: ["kings", "los angeles"] },
  "minnesota wild": { sport: "nhl", tokens: ["wild", "minnesota"] },
  wild: { sport: "nhl", tokens: ["wild", "minnesota"] },
  canadiens: { sport: "nhl", tokens: ["canadiens", "montreal", "montréal"] },
  "montreal canadiens": { sport: "nhl", tokens: ["canadiens", "montreal", "montréal"] },
  "montréal canadiens": { sport: "nhl", tokens: ["canadiens", "montreal", "montréal"] },
  predators: { sport: "nhl", tokens: ["predators", "nashville"] },
  "nashville predators": { sport: "nhl", tokens: ["predators", "nashville"] },
  "devils": { sport: "nhl", tokens: ["devils", "new jersey"] },
  "new jersey devils": { sport: "nhl", tokens: ["devils", "new jersey"] },
  islanders: { sport: "nhl", tokens: ["islanders", "new york"] },
  "new york islanders": { sport: "nhl", tokens: ["islanders", "new york"] },
  senators: { sport: "nhl", tokens: ["senators", "ottawa"] },
  "ottawa senators": { sport: "nhl", tokens: ["senators", "ottawa"] },
  flyers: { sport: "nhl", tokens: ["flyers", "philadelphia"] },
  "philadelphia flyers": { sport: "nhl", tokens: ["flyers", "philadelphia"] },
  penguins: { sport: "nhl", tokens: ["penguins", "pittsburgh"] },
  "pittsburgh penguins": { sport: "nhl", tokens: ["penguins", "pittsburgh"] },
  "san jose sharks": { sport: "nhl", tokens: ["sharks", "san jose"] },
  sharks: { sport: "nhl", tokens: ["sharks", "san jose"] },
  "seattle kraken": { sport: "nhl", tokens: ["kraken", "seattle"] },
  kraken: { sport: "nhl", tokens: ["kraken", "seattle"] },
  "st louis blues": { sport: "nhl", tokens: ["blues", "st louis", "st. louis"] },
  "st. louis blues": { sport: "nhl", tokens: ["blues", "st louis", "st. louis"] },
  blues: { sport: "nhl", tokens: ["blues", "st louis", "st. louis"] },
  lightning: { sport: "nhl", tokens: ["lightning", "tampa bay"] },
  "tampa bay lightning": { sport: "nhl", tokens: ["lightning", "tampa bay"] },
  "maple leafs": { sport: "nhl", tokens: ["maple leafs", "leafs", "toronto"] },
  leafs: { sport: "nhl", tokens: ["maple leafs", "leafs", "toronto"] },
  "toronto maple leafs": { sport: "nhl", tokens: ["maple leafs", "leafs", "toronto"] },
  canucks: { sport: "nhl", tokens: ["canucks", "vancouver"] },
  "vancouver canucks": { sport: "nhl", tokens: ["canucks", "vancouver"] },
  "winnipeg jets": { sport: "nhl", tokens: ["jets", "winnipeg"] },
  "utah mammoth": { sport: "nhl", tokens: ["mammoth", "utah"] },
  mammoth: { sport: "nhl", tokens: ["mammoth", "utah"] },
  "washington capitals": { sport: "nhl", tokens: ["capitals", "caps", "washington"] },
  capitals: { sport: "nhl", tokens: ["capitals", "caps", "washington"] },
  caps: { sport: "nhl", tokens: ["capitals", "caps", "washington"] },

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

function nickPattern(nick: string): RegExp {
  return nick.includes(" ") || nick.includes(".")
    ? new RegExp(escapeRegExp(nick), "i")
    : new RegExp(`\\b${escapeRegExp(nick)}\\b`, "i");
}

/** Sorted longest-first so "anaheim ducks" wins over "ducks" / "anaheim". */
function nickKeysLongestFirst(): string[] {
  return Object.keys(NICK_TO_SPORT).sort((a, b) => b.length - a.length);
}

/** Lightweight league hints — avoids importing chatContextPriority (cycle). */
function sportsHintFromText(text: string): Set<string> {
  const out = new Set<string>();
  const t = String(text || "");
  if (/\bnhl\b|\bhockey\b/i.test(t)) out.add("nhl");
  if (/\bnfl\b/i.test(t)) out.add("nfl");
  if (/\bnba\b/i.test(t)) out.add("nba");
  if (/\bmlb\b|\bbaseball\b/i.test(t)) out.add("mlb");
  if (/\bwnba\b/i.test(t)) out.add("wnba");
  if (/\bncaaf\b|\bcfb\b|\bcollege\s+football\b/i.test(t)) out.add("ncaaf");
  if (/\bncaab\b|\bcbb\b|\bcollege\s+basketball\b/i.test(t)) out.add("ncaab");
  return out;
}

/**
 * Negation cue immediately before a franchise token:
 * "not the Ducks", "no Ducks", "exclude Anaheim", "without the Ducks",
 * "anything but the Ducks", "skip the Lakers", "avoid Cowboys".
 */
const TEAM_NEGATION_CUE =
  String.raw`(?:no|not|without|exclude|excluding|skip|avoid|anything\s+but)`;

function isDirectlyNegatedNick(text: string, nick: string): boolean {
  const kw = escapeRegExp(nick);
  const nickBody =
    nick.includes(" ") || nick.includes(".")
      ? kw
      : String.raw`\b${kw}\b`;
  return new RegExp(
    String.raw`\b${TEAM_NEGATION_CUE}\s+(?:any\s+)?(?:the\s+)?${nickBody}`,
    "i",
  ).test(text);
}

/** Franchise display name for notes / diagnostics. */
function franchiseDisplayName(nick: string, entry: NickEntry): string {
  const cityTok = entry.tokens.find((t) => t !== nick && !t.includes("'"));
  const nickTok = entry.tokens[0] ?? nick;
  if (cityTok && nickTok && cityTok !== nickTok) {
    return `${cityTok} ${nickTok}`.replace(/\b\w/g, (c) => c.toUpperCase());
  }
  return nickTok.replace(/\b\w/g, (c) => c.toUpperCase());
}

function excludedKey(sport: string, tokens: readonly string[]): string {
  return `${sport}|${[...tokens].map((t) => t.toLowerCase()).sort().join(",")}`;
}

/**
 * Resolve a nick key → entry, using league hints for bare ambiguous nicknames
 * ("Giants" after "Cowboys, Eagles and …" on an NFL ask → NY Giants).
 */
function resolveNickEntry(
  nick: string,
  hintSports: Set<string>,
  clauseSportHint: string | null,
): NickEntry | null {
  const key = nick.toLowerCase();
  const direct = NICK_TO_SPORT[key];
  if (direct && !AMBIGUOUS_NICKNAMES.has(key)) return direct;

  const sport =
    clauseSportHint ||
    (hintSports.size === 1 ? [...hintSports][0]! : null);

  if (key === "giants") {
    if (sport === "nfl") return NICK_TO_SPORT["ny giants"] ?? null;
    if (sport === "mlb") return NICK_TO_SPORT["san francisco giants"] ?? null;
  }
  if (key === "cardinals") {
    if (sport === "nfl") return NICK_TO_SPORT["arizona cardinals"] ?? null;
    if (sport === "mlb") return NICK_TO_SPORT["st louis cardinals"] ?? null;
  }
  if (key === "rangers") {
    if (sport === "mlb") return NICK_TO_SPORT["texas rangers"] ?? null;
    if (sport === "nhl") return NICK_TO_SPORT["new york rangers"] ?? null;
  }
  if (key === "panthers") {
    if (sport === "nfl") return NICK_TO_SPORT["carolina panthers"] ?? null;
    if (sport === "nhl") return NICK_TO_SPORT["florida panthers"] ?? null;
  }
  if (key === "kings") {
    if (sport === "nba") return NICK_TO_SPORT["sacramento kings"] ?? null;
    if (sport === "nhl") return NICK_TO_SPORT["la kings"] ?? null;
  }
  if (key === "jets") {
    if (sport === "nfl") return NICK_TO_SPORT["ny jets"] ?? null;
    if (sport === "nhl") return NICK_TO_SPORT["winnipeg jets"] ?? null;
  }
  if (key === "lions" && sport === "nfl") {
    return NICK_TO_SPORT["detroit lions"] ?? null;
  }

  return direct && !AMBIGUOUS_NICKNAMES.has(key) ? direct : null;
}

function collectNicksInSpan(
  span: string,
  hintSports: Set<string>,
  clauseSportHint: string | null,
): CoachAskExcludedTeam[] {
  const out: CoachAskExcludedTeam[] = [];
  const seen = new Set<string>();
  let sportHint = clauseSportHint;
  for (const nick of nickKeysLongestFirst()) {
    if (!nickPattern(nick).test(span)) continue;
    const entry = resolveNickEntry(nick, hintSports, sportHint);
    if (!entry) continue;
    const tokens = entry.tokens.map((x) => x.toLowerCase());
    const key = excludedKey(entry.sport, tokens);
    if (seen.has(key)) continue;
    seen.add(key);
    if (!sportHint) sportHint = entry.sport;
    out.push({
      sport: entry.sport,
      matchTokens: tokens,
      nick,
      name: franchiseDisplayName(nick, entry),
      teamIds: [],
    });
  }
  return out;
}

/**
 * Explicit negative team constraints from the ask.
 * "6 leg NHL no Ducks" / "no Yankees or Dodgers" / "exclude Cowboys, Eagles and Giants".
 * Negative phrases must not feed positive teamScope (see stripTeamExclusionClauses).
 */
export function excludedTeamScopesFromText(
  text: string | null | undefined,
): CoachAskExcludedTeam[] {
  const raw = String(text ?? "");
  if (!raw.trim()) return [];
  const hintSports = sportsHintFromText(raw);
  const found: CoachAskExcludedTeam[] = [];
  const seen = new Set<string>();

  const pushAll = (rows: CoachAskExcludedTeam[]) => {
    for (const row of rows) {
      const key = excludedKey(row.sport, row.matchTokens);
      if (seen.has(key)) continue;
      seen.add(key);
      found.push(row);
    }
  };

  // Direct "no/not/exclude … <nick>" hits (handles "not the Ducks").
  for (const nick of nickKeysLongestFirst()) {
    if (!isDirectlyNegatedNick(raw, nick)) continue;
    const entry = resolveNickEntry(nick, hintSports, null);
    if (!entry) continue;
    pushAll([
      {
        sport: entry.sport,
        matchTokens: entry.tokens.map((x) => x.toLowerCase()),
        nick,
        name: franchiseDisplayName(nick, entry),
        teamIds: [],
      },
    ]);
  }

  // Coordinated lists after a negation cue: "no Yankees or Dodgers",
  // "exclude Cowboys, Eagles and Giants".
  const cueRe = new RegExp(String.raw`\b${TEAM_NEGATION_CUE}\s+(?:any\s+)?`, "gi");
  let m: RegExpExecArray | null;
  while ((m = cueRe.exec(raw)) != null) {
    const start = m.index + m[0].length;
    const window = raw.slice(start, start + 140);
    // Stop at a new sentence / leg count so we don't swallow the rest of the ask.
    const cut = window.search(/\b\d{1,3}\s*l(?:eg|ag)s?\b|[.!?;]|\n/i);
    const span = (cut >= 0 ? window.slice(0, cut) : window).trim();
    if (!span) continue;
    const clauseSport =
      [...collectNicksInSpan(span, hintSports, null)].find((x) => x.sport)?.sport ??
      (hintSports.size === 1 ? [...hintSports][0]! : null);
    pushAll(collectNicksInSpan(span, hintSports, clauseSport));
  }

  return found;
}

/**
 * Remove negative team clauses so positive teamScope cannot treat
 * "no Cowboys" as an include-Cowboys ask.
 */
export function stripTeamExclusionClauses(text: string): string {
  const raw = String(text ?? "");
  if (!raw.trim()) return raw;
  const excluded = excludedTeamScopesFromText(raw);
  if (!excluded.length) return raw;

  // Drop each "negation + optional the + nick" and list connectors left behind.
  let out = raw;
  const cueRe = new RegExp(String.raw`\b${TEAM_NEGATION_CUE}\s+(?:any\s+)?`, "gi");
  const spans: Array<{ start: number; end: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = cueRe.exec(raw)) != null) {
    const cueStart = m.index;
    const start = m.index + m[0].length;
    const window = raw.slice(start, start + 140);
    const cut = window.search(/\b\d{1,3}\s*l(?:eg|ag)s?\b|[.!?;]|\n/i);
    const span = cut >= 0 ? window.slice(0, cut) : window;
    // Only strip when the span actually named an excluded franchise.
    const hit = excluded.some((ex) =>
      ex.matchTokens.some((tok) => span.toLowerCase().includes(tok)) ||
      nickPattern(ex.nick).test(span),
    );
    if (!hit) continue;
    spans.push({ start: cueStart, end: start + span.length });
  }
  // Remove from the end so indices stay valid.
  spans.sort((a, b) => b.start - a.start);
  for (const s of spans) {
    out = `${out.slice(0, s.start)} ${out.slice(s.end)}`;
  }
  return out.replace(/\s+/g, " ").trim();
}

/**
 * First unambiguous team nickname in the ask → sport + match tokens.
 * Prefers longer nicknames ("red sox" before "sox" if ever added).
 * Negative team phrases are stripped first so they never become includes.
 */
export function coachAskTeamScope(
  text: string | null | undefined,
): CoachAskTeamScope | null {
  const t = stripTeamExclusionClauses(String(text ?? ""));
  if (!t.trim()) return null;
  for (const nick of nickKeysLongestFirst()) {
    if (!nickPattern(nick).test(t)) continue;
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
  // Exclusions also imply the league when no sport keyword was named
  // ("no Cowboys" → NFL) so board sport focus still works with league+exclude asks.
  for (const ex of excludedTeamScopesFromText(text)) {
    out.add(ex.sport);
  }
  return out;
}

function labelMatchesTeamTokens(
  label: string,
  tokens: readonly string[],
): boolean {
  const g = label.toLowerCase();
  return tokens.some((tok) => tok.length > 0 && g.includes(tok));
}

/** True when a game/pick label involves any excluded franchise (entire matchup). */
export function gameLabelHitsExcludedTeams(
  label: string,
  sport: string | null | undefined,
  excluded: readonly CoachAskExcludedTeam[] | null | undefined,
): boolean {
  if (!excluded?.length) return false;
  const g = String(label ?? "");
  if (!g.trim()) return false;
  for (const ex of excluded) {
    if (sport && ex.sport && sport !== ex.sport) continue;
    if (labelMatchesTeamTokens(g, ex.matchTokens)) return true;
  }
  return false;
}

/**
 * Attach ESPN team ids from the loaded board when home/away labels match.
 * Canonical id is preferred for diagnostics; label tokens remain the filter key.
 */
export function resolveExcludedTeamIdsFromGames<
  T extends {
    homeTeam?: string | null;
    awayTeam?: string | null;
    homeTeamId?: string | null;
    awayTeamId?: string | null;
    sport?: string | null;
  },
>(
  excluded: readonly CoachAskExcludedTeam[],
  games: readonly T[],
): CoachAskExcludedTeam[] {
  if (!excluded.length) return [];
  return excluded.map((ex) => {
    const ids = new Set<string>(ex.teamIds);
    for (const g of games) {
      if (g.sport && g.sport !== ex.sport) continue;
      const home = String(g.homeTeam ?? "");
      const away = String(g.awayTeam ?? "");
      if (labelMatchesTeamTokens(home, ex.matchTokens) && g.homeTeamId) {
        ids.add(String(g.homeTeamId));
      }
      if (labelMatchesTeamTokens(away, ex.matchTokens) && g.awayTeamId) {
        ids.add(String(g.awayTeamId));
      }
    }
    return { ...ex, teamIds: [...ids] };
  });
}

/** Drop every game whose home or away side is an excluded franchise. */
export function filterOddsGamesExcludingTeams<
  T extends {
    homeTeam?: string | null;
    awayTeam?: string | null;
    sport?: string | null;
  },
>(games: T[], excluded: readonly CoachAskExcludedTeam[] | null | undefined): T[] {
  if (!excluded?.length || !games.length) return games;
  return games.filter((g) => {
    const label = `${g.awayTeam ?? ""} @ ${g.homeTeam ?? ""}`;
    return !gameLabelHitsExcludedTeams(label, g.sport, excluded);
  });
}

/** Final ticket / pool defense: drop any leg from an excluded matchup. */
export function filterPicksExcludingTeams<
  T extends { game?: string | null; sport?: string | null },
>(picks: T[], excluded: readonly CoachAskExcludedTeam[] | null | undefined): T[] {
  if (!excluded?.length || !picks.length) return picks;
  return picks.filter(
    (p) => !gameLabelHitsExcludedTeams(String(p.game ?? ""), p.sport, excluded),
  );
}

/** Keep only odds games that include the named franchise. Strict: empty > wrong games. */
export function filterOddsGamesForAskTeam<
  T extends {
    homeTeam?: string | null;
    awayTeam?: string | null;
    sport?: string | null;
  },
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
 * Include-scope then exclude-scope for board loads.
 * Exclusions always win when both apply to the same phrase (negatives stripped from include).
 */
export function filterOddsGamesForCoachAskTeams<
  T extends {
    homeTeam?: string | null;
    awayTeam?: string | null;
    sport?: string | null;
  },
>(
  games: T[],
  scope: CoachAskTeamScope | null,
  excluded: readonly CoachAskExcludedTeam[] | null | undefined,
): T[] {
  return filterOddsGamesExcludingTeams(
    filterOddsGamesForAskTeam(games, scope),
    excluded,
  );
}

export function filterPicksForCoachAskTeams<
  T extends { game?: string | null; sport?: string | null },
>(
  picks: T[],
  scope: CoachAskTeamScope | null,
  excluded: readonly CoachAskExcludedTeam[] | null | undefined,
): T[] {
  return filterPicksExcludingTeams(filterPicksForAskTeam(picks, scope), excluded);
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

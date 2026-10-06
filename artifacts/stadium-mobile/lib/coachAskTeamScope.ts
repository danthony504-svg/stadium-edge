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
  /** Raw team phrase parsed from the ask (e.g. "troy"). */
  parsedTeam?: string;
  /** Display label for notes/diagnostics (e.g. "Troy Trojans"). */
  displayName?: string;
};

/** Funnel diagnostics for team-scoped parlays ("4 leg Troy"). */
export type CoachTeamGameScopeDiagnostics = {
  requestedLegs: number;
  parsedTeam: string | null;
  resolvedTeamId: string | null;
  resolvedSport: string | null;
  resolvedLeague: string | null;
  resolvedGameId: string | null;
  candidateCountBeforeGameFilter: number;
  candidateCountAfterGameFilter: number;
  finalLegCount: number;
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

  // Soccer (club nicknames — exclusion / include via same NICK_TO_SPORT path)
  chelsea: { sport: "soccer", tokens: ["chelsea"] },
  "chelsea fc": { sport: "soccer", tokens: ["chelsea"] },
  arsenal: { sport: "soccer", tokens: ["arsenal"] },
  liverpool: { sport: "soccer", tokens: ["liverpool"] },
  "man city": { sport: "soccer", tokens: ["man city", "manchester city"] },
  "manchester city": { sport: "soccer", tokens: ["man city", "manchester city"] },
  "man united": { sport: "soccer", tokens: ["man united", "manchester united"] },
  "manchester united": { sport: "soccer", tokens: ["man united", "manchester united"] },

  // NCAAF (common exclusion / include aliases)
  "ohio state": { sport: "ncaaf", tokens: ["ohio state", "buckeyes"] },
  buckeyes: { sport: "ncaaf", tokens: ["ohio state", "buckeyes"] },
  alabama: { sport: "ncaaf", tokens: ["alabama", "crimson tide"] },
  "crimson tide": { sport: "ncaaf", tokens: ["alabama", "crimson tide"] },
  // Troy Trojans — do NOT add bare "trojans" (collides with USC).
  troy: { sport: "ncaaf", tokens: ["troy"] },
  "troy trojans": { sport: "ncaaf", tokens: ["troy"] },
  // Unambiguous FBS school names (avoid bare city names that collide with pro clubs).
  "appalachian state": { sport: "ncaaf", tokens: ["appalachian state", "app state"] },
  "app state": { sport: "ncaaf", tokens: ["appalachian state", "app state"] },
  "boise state": { sport: "ncaaf", tokens: ["boise state"] },
  "florida state": { sport: "ncaaf", tokens: ["florida state", "fsu"] },
  fsu: { sport: "ncaaf", tokens: ["florida state", "fsu"] },
  "penn state": { sport: "ncaaf", tokens: ["penn state", "nittany lions"] },
  "michigan state": { sport: "ncaaf", tokens: ["michigan state"] },
  "oklahoma state": { sport: "ncaaf", tokens: ["oklahoma state"] },
  "oregon state": { sport: "ncaaf", tokens: ["oregon state"] },
  "arizona state": { sport: "ncaaf", tokens: ["arizona state"] },
  "kansas state": { sport: "ncaaf", tokens: ["kansas state"] },
  "san diego state": { sport: "ncaaf", tokens: ["san diego state"] },
  "san jose state": { sport: "ncaaf", tokens: ["san jose state"] },
  "fresno state": { sport: "ncaaf", tokens: ["fresno state"] },
  "colorado state": { sport: "ncaaf", tokens: ["colorado state"] },
  "georgia state": { sport: "ncaaf", tokens: ["georgia state"] },
  "georgia tech": { sport: "ncaaf", tokens: ["georgia tech"] },
  "texas tech": { sport: "ncaaf", tokens: ["texas tech"] },
  "texas a&m": { sport: "ncaaf", tokens: ["texas a&m", "texas am"] },
  "ole miss": { sport: "ncaaf", tokens: ["ole miss"] },
  "southern miss": { sport: "ncaaf", tokens: ["southern miss", "southern mississippi"] },
  "southern mississippi": { sport: "ncaaf", tokens: ["southern miss", "southern mississippi"] },
  clemson: { sport: "ncaaf", tokens: ["clemson"] },
  auburn: { sport: "ncaaf", tokens: ["auburn"] },
  lsu: { sport: "ncaaf", tokens: ["lsu", "louisiana state"] },
  "louisiana state": { sport: "ncaaf", tokens: ["lsu", "louisiana state"] },
  georgia: { sport: "ncaaf", tokens: ["georgia"] },
  michigan: { sport: "ncaaf", tokens: ["michigan"] },
  oregon: { sport: "ncaaf", tokens: ["oregon"] },
  oklahoma: { sport: "ncaaf", tokens: ["oklahoma"] },
  wisconsin: { sport: "ncaaf", tokens: ["wisconsin"] },
  nebraska: { sport: "ncaaf", tokens: ["nebraska"] },
  iowa: { sport: "ncaaf", tokens: ["iowa"] },
  "iowa state": { sport: "ncaaf", tokens: ["iowa state"] },
  missouri: { sport: "ncaaf", tokens: ["missouri"] },
  arkansas: { sport: "ncaaf", tokens: ["arkansas"] },
  kentucky: { sport: "ncaaf", tokens: ["kentucky"] },
  "mississippi state": { sport: "ncaaf", tokens: ["mississippi state"] },
  vanderbilt: { sport: "ncaaf", tokens: ["vanderbilt"] },
  "notre dame": { sport: "ncaaf", tokens: ["notre dame"] },
  louisville: { sport: "ncaaf", tokens: ["louisville"] },
  tulane: { sport: "ncaaf", tokens: ["tulane"] },
  smu: { sport: "ncaaf", tokens: ["smu", "southern methodist"] },
  baylor: { sport: "ncaaf", tokens: ["baylor"] },
  tcu: { sport: "ncaaf", tokens: ["tcu"] },
  byu: { sport: "ncaaf", tokens: ["byu"] },
  "utah state": { sport: "ncaaf", tokens: ["utah state"] },
  "air force": { sport: "ncaaf", tokens: ["air force"] },
  army: { sport: "ncaaf", tokens: ["army"] },
  navy: { sport: "ncaaf", tokens: ["navy"] },
  uconn: { sport: "ncaaf", tokens: ["uconn", "connecticut"] },
  connecticut: { sport: "ncaaf", tokens: ["uconn", "connecticut"] },
  "james madison": { sport: "ncaaf", tokens: ["james madison", "jmu"] },
  jmu: { sport: "ncaaf", tokens: ["james madison", "jmu"] },
  liberty: { sport: "ncaaf", tokens: ["liberty"] },
  "coastal carolina": { sport: "ncaaf", tokens: ["coastal carolina"] },
  "louisiana tech": { sport: "ncaaf", tokens: ["louisiana tech"] },
  "louisiana monroe": { sport: "ncaaf", tokens: ["louisiana monroe", "ul monroe"] },
  marshall: { sport: "ncaaf", tokens: ["marshall"] },
  "western kentucky": { sport: "ncaaf", tokens: ["western kentucky", "wku"] },
  wku: { sport: "ncaaf", tokens: ["western kentucky", "wku"] },
  "middle tennessee": { sport: "ncaaf", tokens: ["middle tennessee", "mtsu"] },
  "jacksonville state": { sport: "ncaaf", tokens: ["jacksonville state"] },
  "kennesaw state": { sport: "ncaaf", tokens: ["kennesaw state"] },
  "new mexico state": { sport: "ncaaf", tokens: ["new mexico state"] },
  "florida international": { sport: "ncaaf", tokens: ["florida international", "fiu"] },
  fiu: { sport: "ncaaf", tokens: ["florida international", "fiu"] },
  "florida atlantic": { sport: "ncaaf", tokens: ["florida atlantic", "fau"] },
  fau: { sport: "ncaaf", tokens: ["florida atlantic", "fau"] },
  "south alabama": { sport: "ncaaf", tokens: ["south alabama"] },
  "texas state": { sport: "ncaaf", tokens: ["texas state"] },
  utsa: { sport: "ncaaf", tokens: ["utsa", "texas san antonio"] },
  "north texas": { sport: "ncaaf", tokens: ["north texas"] },
  rice: { sport: "ncaaf", tokens: ["rice"] },
  tulsa: { sport: "ncaaf", tokens: ["tulsa"] },
  uab: { sport: "ncaaf", tokens: ["uab"] },
  "south florida": { sport: "ncaaf", tokens: ["south florida", "usf"] },
  usf: { sport: "ncaaf", tokens: ["south florida", "usf"] },
  "central florida": { sport: "ncaaf", tokens: ["central florida", "ucf"] },
  ucf: { sport: "ncaaf", tokens: ["central florida", "ucf"] },
  "virginia tech": { sport: "ncaaf", tokens: ["virginia tech"] },
  "north carolina": { sport: "ncaaf", tokens: ["north carolina", "unc"] },
  unc: { sport: "ncaaf", tokens: ["north carolina", "unc"] },
  "nc state": { sport: "ncaaf", tokens: ["nc state", "north carolina state"] },
  "north carolina state": { sport: "ncaaf", tokens: ["nc state", "north carolina state"] },
  duke: { sport: "ncaaf", tokens: ["duke"] },
  "wake forest": { sport: "ncaaf", tokens: ["wake forest"] },
  syracuse: { sport: "ncaaf", tokens: ["syracuse"] },
  "boston college": { sport: "ncaaf", tokens: ["boston college"] },
  "west virginia": { sport: "ncaaf", tokens: ["west virginia"] },
  "miami ohio": { sport: "ncaaf", tokens: ["miami ohio", "miami (oh)"] },
  "miami (oh)": { sport: "ncaaf", tokens: ["miami ohio", "miami (oh)"] },
  "bowling green": { sport: "ncaaf", tokens: ["bowling green"] },
  "central michigan": { sport: "ncaaf", tokens: ["central michigan"] },
  "eastern michigan": { sport: "ncaaf", tokens: ["eastern michigan"] },
  "western michigan": { sport: "ncaaf", tokens: ["western michigan"] },
  "northern illinois": { sport: "ncaaf", tokens: ["northern illinois"] },
  "ball state": { sport: "ncaaf", tokens: ["ball state"] },
  northwestern: { sport: "ncaaf", tokens: ["northwestern"] },
  purdue: { sport: "ncaaf", tokens: ["purdue"] },
  rutgers: { sport: "ncaaf", tokens: ["rutgers"] },
  usc: { sport: "ncaaf", tokens: ["usc", "southern california"] },
  "southern california": { sport: "ncaaf", tokens: ["usc", "southern california"] },
  "usc trojans": { sport: "ncaaf", tokens: ["usc", "southern california"] },
  ucla: { sport: "ncaaf", tokens: ["ucla"] },
  stanford: { sport: "ncaaf", tokens: ["stanford"] },
  "washington state": { sport: "ncaaf", tokens: ["washington state"] },
  "south carolina": { sport: "ncaaf", tokens: ["south carolina"] },
  "washington huskies": { sport: "ncaaf", tokens: ["washington huskies", "washington"] },
  "miami hurricanes": { sport: "ncaaf", tokens: ["miami hurricanes", "miami"] },
  "texas longhorns": { sport: "ncaaf", tokens: ["texas longhorns", "texas"] },
  "florida gators": { sport: "ncaaf", tokens: ["florida gators", "florida"] },
  "tennessee volunteers": { sport: "ncaaf", tokens: ["tennessee volunteers", "tennessee"] },
  "tennessee vols": { sport: "ncaaf", tokens: ["tennessee volunteers", "tennessee"] },
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
  if (/\bsoccer\b|\bfutbol\b|\bfootball\s+club\b|\bfc\b/i.test(t)) out.add("soccer");
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
 *
 * Also resolves "N leg <Team>" phrases (e.g. "4 leg Troy") via the nickname
 * catalog so college/pro franchises not previously matched still scope the board.
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
    return scopeFromEntry(nick, entry);
  }
  // "4 leg Troy" / "5 leg Boise State" — phrase after leg count when nick
  // word-boundary missed (shouldn't for troy) or multi-word school names.
  const phrase = extractTeamPhraseFromLegAsk(t);
  if (phrase) {
    const fromPhrase = resolveNickEntryForPhrase(phrase);
    if (fromPhrase) return scopeFromEntry(phrase, fromPhrase.entry, fromPhrase.nick);
  }
  return null;
}

function scopeFromEntry(
  parsedTeam: string,
  entry: NickEntry,
  nickKey?: string,
): CoachAskTeamScope {
  const display =
    nickKey && nickKey.includes(" ")
      ? titleCaseTeam(nickKey)
      : entry.sport === "ncaaf" && parsedTeam === "troy"
        ? "Troy Trojans"
        : titleCaseTeam(parsedTeam);
  return {
    sport: entry.sport,
    matchTokens: entry.tokens.map((x) => x.toLowerCase()),
    parsedTeam: parsedTeam.toLowerCase().trim(),
    displayName: display,
  };
}

function titleCaseTeam(s: string): string {
  return String(s ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

/** Stopwords that must never become a team phrase after "N leg …". */
const TEAM_PHRASE_STOPWORDS = new Set([
  "parlay",
  "props",
  "prop",
  "picks",
  "pick",
  "total",
  "totals",
  "spread",
  "spreads",
  "moneyline",
  "moneylines",
  "ml",
  "tonight",
  "today",
  "tomorrow",
  "best",
  "value",
  "legs",
  "leg",
  "mixed",
  "mix",
  "multi",
  "sport",
  "sports",
  "game",
  "games",
  "player",
  "players",
  "alt",
  "alts",
  "alternate",
  "nfl",
  "nba",
  "mlb",
  "nhl",
  "wnba",
  "ncaaf",
  "ncaab",
  "cfb",
  "cbb",
  "soccer",
  "ufc",
  "tennis",
  "college",
  "football",
  "basketball",
  "baseball",
  "hockey",
]);

/**
 * Extract the team phrase from asks like "4 leg Troy", "4-leg Troy Trojans",
 * "give me 5 Alabama legs". Returns lowercase trimmed phrase or null.
 */
export function extractTeamPhraseFromLegAsk(
  text: string | null | undefined,
): string | null {
  const raw = String(text ?? "").toLowerCase().replace(/\s+/g, " ").trim();
  if (!raw) return null;
  const patterns = [
    /\b\d{1,2}\s*-?\s*legs?\s+(.+?)(?:\s+game|\s+picks?|\s+parlay)?\s*$/i,
    /\bgive\s+me\s+\d{1,2}\s+(.+?)\s+legs?\b/i,
    /\b\d{1,2}\s+(.+?)\s+legs?\b/i,
  ];
  for (const re of patterns) {
    const m = raw.match(re);
    if (!m?.[1]) continue;
    let phrase = m[1]!.trim();
    phrase = phrase
      .replace(/\b(game|picks?|parlay|tonight|today|tomorrow)\b/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (!phrase || TEAM_PHRASE_STOPWORDS.has(phrase)) continue;
    // Reject phrases that are only sport keywords.
    if ([...phrase.split(" ")].every((w) => TEAM_PHRASE_STOPWORDS.has(w))) continue;
    return phrase;
  }
  return null;
}

function resolveNickEntryForPhrase(
  phrase: string,
): { nick: string; entry: NickEntry } | null {
  const p = phrase.toLowerCase().trim();
  if (!p || TEAM_PHRASE_STOPWORDS.has(p) || AMBIGUOUS_NICKNAMES.has(p)) return null;
  // Exact nick key.
  if (NICK_TO_SPORT[p] && !AMBIGUOUS_NICKNAMES.has(p)) {
    return { nick: p, entry: NICK_TO_SPORT[p]! };
  }
  // Match against longer nick keys / tokens (longest first).
  for (const nick of nickKeysLongestFirst()) {
    if (AMBIGUOUS_NICKNAMES.has(nick)) continue;
    const entry = NICK_TO_SPORT[nick]!;
    if (nick === p) return { nick, entry };
    if (entry.tokens.some((tok) => tok === p)) return { nick, entry };
    // "troy trojans" phrase ↔ nick "troy"
    if (p.includes(nick) && nick.length >= 3) return { nick, entry };
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
  const nick = scope.displayName ?? scope.parsedTeam ?? scope.matchTokens[0] ?? "that team";
  return `No ${nick} matchup is on tonight's ${scope.sport.toUpperCase()} board — won't fill with other games.`;
}

/**
 * When the team's game is on the board but fewer than N legs qualify, do not
 * fill with other games — tell the user the shortfall is team-scoped.
 */
export function coachAskTeamShortfallNote(
  scope: CoachAskTeamScope | null,
  requestedLegs: number,
  finalLegCount: number,
  matchedGameCount: number,
): string {
  if (!scope || matchedGameCount <= 0) return "";
  if (finalLegCount >= requestedLegs) return "";
  const nick = scope.displayName ?? scope.parsedTeam ?? scope.matchTokens[0] ?? "that team";
  if (finalLegCount <= 0) {
    return `No eligible real markets cleared for ${nick} — won't fill a ${requestedLegs}-leg ticket with other games.`;
  }
  return `Only ${finalLegCount} eligible real-market selection${finalLegCount === 1 ? "" : "s"} for ${nick} — not enough for a ${requestedLegs}-leg ticket. Won't fill with other games.`;
}

/**
 * Build team-game scope diagnostics for "N leg <Team>" asks.
 * finalLegCount may be filled in after ticket assembly.
 */
export function buildCoachTeamGameScopeDiagnostics(opts: {
  requestedLegs: number;
  scope: CoachAskTeamScope | null;
  gamesBeforeFilter: readonly {
    id?: string | null;
    sport?: string | null;
    homeTeam?: string | null;
    awayTeam?: string | null;
    homeTeamId?: string | null;
    awayTeamId?: string | null;
  }[];
  gamesAfterFilter: readonly {
    id?: string | null;
    sport?: string | null;
    homeTeam?: string | null;
    awayTeam?: string | null;
    homeTeamId?: string | null;
    awayTeamId?: string | null;
  }[];
  finalLegCount?: number;
}): CoachTeamGameScopeDiagnostics {
  const scope = opts.scope;
  const matched = opts.gamesAfterFilter[0] ?? null;
  let resolvedTeamId: string | null = null;
  if (scope && matched) {
    const home = String(matched.homeTeam ?? "");
    const away = String(matched.awayTeam ?? "");
    if (labelMatchesTeamTokens(home, scope.matchTokens) && matched.homeTeamId) {
      resolvedTeamId = String(matched.homeTeamId);
    } else if (labelMatchesTeamTokens(away, scope.matchTokens) && matched.awayTeamId) {
      resolvedTeamId = String(matched.awayTeamId);
    }
  }
  const gameLabel = matched
    ? `${matched.awayTeam ?? ""} @ ${matched.homeTeam ?? ""}`.trim()
    : null;
  return {
    requestedLegs: opts.requestedLegs,
    parsedTeam: scope?.parsedTeam ?? scope?.matchTokens?.[0] ?? null,
    resolvedTeamId,
    resolvedSport: scope?.sport ?? null,
    resolvedLeague: scope?.sport ? scope.sport.toUpperCase() : null,
    resolvedGameId: matched?.id != null ? String(matched.id) : gameLabel,
    candidateCountBeforeGameFilter: opts.gamesBeforeFilter.length,
    candidateCountAfterGameFilter: opts.gamesAfterFilter.length,
    finalLegCount: opts.finalLegCount ?? 0,
  };
}

/**
 * True when the ask names a franchise we can scope to (with or without "game").
 * "6 leg Saints" and "7 leg saints game" both qualify.
 */
export function askNamesTeamGame(text: string | null | undefined): boolean {
  return coachAskTeamScope(text) != null;
}

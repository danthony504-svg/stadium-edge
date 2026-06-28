// Detect a "look up a player's stats" chat message and pull out the player
// name + optional season / opponent / period / requested stat. Returns null
// when the message isn't a stat lookup so the normal parlay/AI chat path
// handles it. Faithful port of the web app's parseStatLookup
// (artifacts/stadium-edge/src/ParlayBuilder.tsx) — deliberately conservative:
// it will NOT fire on parlay/build/bet requests.

// Per-sport recent-games TABLE columns (which ESPN labels to show, in order).
export const STAT_TABLE_COLS: Record<string, string[]> = {
  mlb: ["AB", "R", "H", "HR", "RBI", "BB", "SO", "AVG"],
  nba: ["MIN", "PTS", "REB", "AST", "STL", "BLK", "3PM"],
  wnba: ["MIN", "PTS", "REB", "AST", "STL", "BLK", "3PM"],
  nhl: ["G", "A", "PTS", "+/-", "SOG", "PIM"],
};

// Season-summary headline stats. ONLY counting stats here — summing or
// averaging a counting stat over the game log is exact/real. Rate stats
// (AVG/OPS/FG%) are intentionally excluded because a mean of per-game rates is
// NOT the true season rate; we never show a derived number we can't compute
// correctly. (The per-game table still shows ESPN's own exact rate values.)
export const STAT_SUMMARY: Record<string, [string, "avg" | "total"][]> = {
  mlb: [["HR", "total"], ["RBI", "total"], ["H", "total"], ["R", "total"]],
  nba: [["PTS", "avg"], ["REB", "avg"], ["AST", "avg"], ["3PM", "avg"]],
  wnba: [["PTS", "avg"], ["REB", "avg"], ["AST", "avg"], ["3PM", "avg"]],
  nhl: [["G", "total"], ["A", "total"], ["PTS", "total"], ["SOG", "total"]],
};

// MLB pitchers carry IP/ER/K/ERA and label strikeouts "K"; hitters carry
// AB/AVG/RBI and label strikeouts "SO". Pitchers get their own column/summary
// set, chosen when the log has an "IP" column.
export const MLB_PITCHER_COLS = ["IP", "H", "R", "ER", "BB", "K", "ERA"];
export const MLB_PITCHER_SUMMARY: [string, "avg" | "total"][] = [
  ["K", "total"], ["ER", "total"], ["BB", "total"], ["H", "total"],
];

const STAT_NOUNS =
  "points?|pts|yards?|yds|rebounds?|reb|assists?|ast|hits?|runs?|rbis?|home runs?|homers?|hr|strikeouts?|ks|goals?|saves?|touchdowns?|tds?|receptions?|catches|blocks?|steals?";

export const BARE_NAME_STOP = new Set([
  "hi","hey","hello","yo","sup","thanks","thank","thx","ty","ok","okay","k","yes","yeah","yep","yup",
  "no","nope","nah","cool","nice","great","good","bad","lol","help","stop","wait","what","whats","why",
  "how","who","when","where","sure","please","pls","more","again","next","back","done","test","testing",
  "odds","picks","pick","live","today","tonight","now","hmm","idk","maybe","go","got","the","and","but",
  "it","its","is","are","was","were","do","does","did","to","of","in","on","for","my","me","you","we",
  "this","that","them","they","love","hate","game","games","team","teams","player","players","parlay","bet",
]);

// Single-token words that must NEVER be accepted as a player name on their own
// during the span-search recovery (below). Without this, a stray verb/adverb
// left clinging to a name (e.g. "wembanyama will", "jokic dominate wednesday")
// could fuzzy-match an unrelated athlete. Mirrors the web app's set.
export const NAME_FALLBACK_SKIP = new Set([
  ...BARE_NAME_STOP,
  "will","wont","won","gonna","gon","going","shall","would","should","could","can","may","might","must",
  "score","scores","scored","scoring","dominate","dominates","explode","explodes","drop","drops","put","puts",
  "have","has","had","hit","hits","throw","throws","threw","pass","passes","passed","rush","rushes","rushed",
  "perform","performs","look","looks","looking","think","thinks","thought","believe","believes","expect",
  "predict","project","guess","reckon","suppose","feel","feels","say","says","against","vs","versus","many",
  "likely","most","mostly","anybody","anyone","someone","everybody","everyone","best",
  "much","about","over","under","line","first","second","third","fourth","quarter","half","period","inning",
  "week","tomorrow","yesterday","night","monday","tuesday","wednesday","thursday","friday","saturday","sunday",
  // Generic position/role words — a CLASS of players, never a standalone name.
  "pitcher","pitchers","hitter","hitters","batter","batters","catcher","catchers",
  "quarterback","quarterbacks","qb","qbs","goalie","goalies","goaltender","goaltenders","kicker","kickers",
]);

export type StatLookup = {
  name: string;
  season: string | null;
  period: boolean;
  periodPhrase: string | null;
  opponent: string | null;
  statCols: string[] | null;
  statWord: string | null;
  bareName?: boolean;
};

// Either-or / comparison asks want the coach's recommendation (and often a PICK
// card), not a single-player ESPN stat dump. Examples: "Adames or Ramos to hit a
// HR", "Curry or LeBron tonight", "which is better to score".
export function isCoachRecommendationQuestion(raw: string): boolean {
  const t = String(raw || "").trim();
  const low = t.toLowerCase();
  if (!t) return false;
  if (
    /\b or \b/i.test(t) &&
    /\b(hit|hr|home runs?|homers?|score|get|have|reach|strikeouts?|touchdowns?|goals?|points?|pts|better|more likely)\b/.test(
      low,
    )
  )
    return true;
  if (
    /\b(which|who|compare|better|versus|vs\.?)\b/.test(low) &&
    /\b(hit|hr|bet|pick|play|take|score|get)\b/.test(low)
  )
    return true;
  return false;
}

export function parseStatLookup(raw: string): StatLookup | null {
  const t = String(raw || "").trim();
  if (!t) return null;
  const low = t.toLowerCase();
  if (isCoachRecommendationQuestion(t)) return null;
  // Never hijack parlay / betting-build requests.
  if (
    /\b(parlay|build|wager|slip|leg|legs|prop bet|bet on|place a bet|moneyline|spread|over\/under|pick'?em|sgp|same game)\b/.test(
      low,
    )
  )
    return null;
  // Plays / picks / bets requests ("best hr plays for tomorrow", "top plays
  // today", "give me some picks") ask the model to PICK from tonight's pool —
  // they never NAME a single player to look up. Without this the leftover words
  // fuzzy-bind to a real athlete (reported bug: "best hr plays for tomorrow" →
  // NCAAF player Jadon Best).
  if (/\b(plays|picks|bets)\b/.test(low)) return null;
  // Superlative / pool questions ("who is most likely to hit a HR", "which
  // player will go off tonight", "who's the best bet to score") ask the model
  // to PICK a player from tonight's pool — they never NAME the player to look
  // up. Treat them as AI/pool questions, never a single-player stat lookup.
  // Otherwise a stray adverb like "likely" fuzzy-binds to an unrelated athlete
  // (the reported bug: "most likely to hit a home run" → NFL TE Isaiah Likely).
  if (/\bmost likely\b/.test(low)) return null;
  if (/^\s*(who|who'?s|whos|which)\b/.test(low)) return null;
  // ROLE/POSITION SUBJECT guard: a message that LEADS with a generic role word
  // ("pitcher strikeouts for the Brewers", "best hitters tonight", "batters to
  // hit a HR") names a CLASS of players, not a single player — it's a
  // pool/market question for the AI/parlay path, never a one-player stat card.
  // Without this, the stat words get stripped and the leftover role word
  // resolves to a real athlete with that surname (the reported bug: "pitcher
  // strikeouts for brewers and cardinals" → NCAAF player Calvin Pitcher).
  // Anchored at the start (after generic qualifiers) so a real player whose
  // surname is a role word ("Calvin Pitcher stats") is NOT swallowed.
  if (
    /^(?:\s*(?:the|a|an|any|all|best|top|good|great|some|which|what|list|show|give|me|need|tonight|today|todays)\s+)*(?:pitchers?|hitters?|batters?|catchers?|quarterbacks?|qbs?|goalies?|goaltenders?|kickers?)\b/.test(
      low,
    )
  )
    return null;
  // GAME / MATCHUP POOL guard: a stat asked about a specific MATCHUP — "<stat>
  // in the <team> and <team> game" or "game between <team> and <team>" — is a
  // whole-GAME pool question, not one player. Without this a team-nickname token
  // ("Blue" from "Blue Jays") fuzzy-binds to a real athlete via the span-search
  // fallback (reported bug: "home runs in the orioles and blue jays game today"
  // -> NFL RB Jaydon Blue). Anchored to a preposition (in/for/during/from) or
  // "between" so combined-stat single-player lookups ("lebron points and
  // rebounds game log") and "vs"/"against" opponent asks are NOT swallowed.
  if (
    /\b(?:in|for|during|from)\s+(?:the\s+)?[a-z][\w'.-]*\s+(?:and|&)\s+(?:the\s+)?[a-z][\w'.-]*(?:\s+[a-z][\w'.-]*){0,2}\s+(?:game|matchup)\b/.test(
      low,
    ) ||
    /\b(?:game|matchup)s?\s+between\s+(?:the\s+)?[a-z][\w'.-]*\s+(?:and|&)\s+(?:the\s+)?[a-z]/.test(
      low,
    )
  )
    return null;
  const statNounRe = new RegExp(`\\b(${STAT_NOUNS})\\b`);
  const hasCue =
    /\b(stat|stats|stat ?line|numbers|game ?log|box ?score|splits?)\b/.test(low) ||
    /\blast \d+ games?\b/.test(low) ||
    /\b(last|recent) games?\b/.test(low) ||
    /\blast game\b/.test(low) ||
    /\bhow (did|has|have|is|are|many)\b/.test(low) ||
    /\bhow'?s\b/.test(low) ||
    /\b(score|scored|scoring)\b/.test(low) ||
    statNounRe.test(low) ||
    /\b20\d{2}\b.*\b(season|stats?|numbers)\b/.test(low) ||
    /\b(season|stats?|numbers)\b.*\b20\d{2}\b/.test(low);
  if (!hasCue) {
    // Bare player-name fallback: a short, name-like message with no other
    // intent (e.g. just "Wembanyama"). Only committed if ESPN resolves a real
    // player (caller searches first and falls through to the AI on a miss).
    const toks = low.replace(/[?.!,]/g, " ").trim().split(/\s+/).filter(Boolean);
    const looksLikeName =
      toks.length >= 1 &&
      toks.length <= 3 &&
      toks.every((w) => /^[a-z][a-z'.-]*$/.test(w)) &&
      toks.some((w) => w.length >= 3) &&
      !toks.some((w) => BARE_NAME_STOP.has(w));
    if (looksLikeName) {
      const nm = t.replace(/[?.!,]/g, " ").replace(/\s+/g, " ").trim();
      return {
        name: nm,
        season: null,
        period: false,
        periodPhrase: null,
        opponent: null,
        statCols: null,
        statWord: null,
        bareName: true,
      };
    }
    return null;
  }
  const season = (low.match(/\b(20\d{2})\b/) || [])[1] || null;

  // Capture an explicit opponent ("vs Celtics", "against the Lakers").
  let opponent: string | null = null;
  const oppM = t.match(/\b(?:vs\.?|versus|against|@)\s+(?:the\s+)?(.+)$/i);
  if (oppM) {
    const oppStop = new Set([
      "in","on","over","during","this","last","recent","lately","their","his","her","its","our","for",
      "of","to","game","games","season","seasons","year","years","tonight","today","yesterday","night",
      "so","far","past","few","couple","several","matchup","matchups","meeting","meetings","since","when",
      "while","and","or","but","do","did","does","have","had","has","score","scored","scoring",
    ]);
    const statRe = new RegExp(`^(?:${STAT_NOUNS})$`, "i");
    const toks: string[] = [];
    for (const w of oppM[1].replace(/[?.!,]/g, " ").trim().split(/\s+/)) {
      const lw = w.toLowerCase();
      if (!lw) continue;
      if (oppStop.has(lw) || /^\d+$/.test(lw) || statRe.test(lw)) break;
      toks.push(w);
      if (toks.length >= 3) break;
    }
    const o = toks.join(" ").trim();
    if (o && o.length >= 2) opponent = o;
  }
  // "vs pitch mix" / "vs pitches" isn't an opponent TEAM — it's a request to
  // weigh the opposing pitcher's repertoire (Statcast pitch-type data we don't
  // have). Treating it as a team renders a misleading "no game vs pitch mix
  // (they may not have met yet)" note (reported bug). Drop it so the card just
  // shows the player's real recent game log.
  if (
    opponent &&
    /^(?:pitch(?:es|ing)?(?:\s*-?\s*(?:mix(?:es)?|types?))?|arsenal|repertoire|velo(?:city)?|spin(?:\s*rate)?|movement|stuff|offspeed|fastballs?|sinkers?|sliders?|curveballs?|changeups?|cutters?|splitters?|breaking\s*balls?)$/i.test(
      opponent.replace(/\s+/g, " ").trim(),
    )
  )
    opponent = null;

  let name = t;
  const nameTrunc = name.replace(/\b(?:vs\.?|versus|against|@)\s+.*$/i, " ");
  if (/[a-z]/i.test(nameTrunc)) name = nameTrunc;
  // Strip a leading assistant-addressed opener ("Can you ...", "Have you ...",
  // "Do you ...", "Will you ..."). The "<aux> you" head can never be a player
  // name, so removing it stops meta/capability questions ("Have you ever
  // predicted a home run?") from leaving a stray token that fuzzy-binds to a
  // real athlete. "Will you" is safe to strip — real names are "Will <surname>".
  name = name.replace(/^\s*(can|could|would|do|does|did|have|has|had|will|are|is|was|should|shall)\s+you\b/i, " ");
  name = name.replace(/\b20\d{2}\b/g, " ");
  name = name.replace(
    /^(show me|show|pull up|pull|get me|get|look up|lookup|what (?:are|is|were|was)|what'?s|how many|how (?:did|has|have|is|are)|how'?s|give me|tell me|find|check|see|display)\s+/i,
    " ",
  );
  name = name.replace(/'s\b/gi, " ");
  name = name.replace(new RegExp(`\\b(${STAT_NOUNS})\\b`, "gi"), " ");
  name = name.replace(
    /\b(stat ?line|stats|stat|numbers|game ?log|box ?score|recent games?|last \d+ games?|last game|this season|last season|this year|career|splits?|seasons?|score[ds]?|scoring|do|did|does|doing|done|have|had|get|got|record(?:ed)?|put up|throw|threw|pass(?:ed)?|rush(?:ed)?|play(?:ing|ed)?|perform(?:ance|ing|ed)?|look(?:ing)?|regular|playoffs?|games?|tonight|today|yesterday|night)\b/gi,
    " ",
  );
  name = name.replace(
    /\b(first|second|third|fourth|1st|2nd|3rd|4th|quarters?|qtr|q[1-4]|halves?|half|halftime|h[12]|innings?|periods?)\b/gi,
    " ",
  );
  name = name.replace(/\b(for|of|about|on|the|in|a|an|me|my|with|vs|versus|against|did|do|many|and|or)\b/gi, " ");
  name = name.replace(
    /\b(you|we|they|he|she|it|ever|never|think|thinks|thought|believe|believes|guess|guessed|reckon|expect|expects|expected|predict|predicts|predicted|projecte?d?|suppose|feel|feels|say|says|gonna|going|would|should|could|shall|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/gi,
    " ",
  );
  name = name.replace(/\b\d+\b/g, " ");
  if (opponent) {
    for (const tok of opponent.split(" ").filter((w) => w.length >= 3)) {
      name = name.replace(new RegExp(`\\b${tok.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi"), " ");
    }
  }
  name = name.replace(/[?.!,]/g, " ").replace(/\s+/g, " ").trim();
  if (name.length < 2) return null;
  if (name.split(" ").length > 5) return null;

  // Period intent + friendly phrase (for the StatMuse game-log query). The
  // boolean is broad (any quarter/half/period/inning reference) so a period ask
  // always surfaces an honest "full-game only" note on the ESPN card even when
  // we can't build a precise StatMuse phrase; periodPhrase is best-effort.
  const periodPhrase = extractPeriodPhrase(low);
  const period =
    !!periodPhrase ||
    /\b(quarter|quarters|qtr|q[1-4]|[1-4]q|halftime|h[12]|[12]h|inning|innings|period|periods)\b/i.test(low) ||
    /\b(first|second|third|fourth)\s+(quarter|half|period|inning)\b/i.test(low);

  // The stat the user asked about → ESPN label codes (FLOAT that column) +
  // a friendly word for the StatMuse query.
  let statCols: string[] | null = null;
  let statWord: string | null = null;
  const sm = low.match(
    /\b(points?|pts|rebounds?|reb|assists?|ast|blocks?|steals?|hits?|runs?|rbis?|home runs?|homers?|hr|strikeouts?|ks|walks?|saves?|goals?|touchdowns?|tds?|receptions?|catches|yards?|yds)\b/,
  );
  if (sm) {
    const w = sm[1];
    if (/^(points?|pts)$/.test(w)) { statCols = ["PTS"]; statWord = "points"; }
    else if (/^(rebounds?|reb)$/.test(w)) { statCols = ["REB"]; statWord = "rebounds"; }
    else if (/^(assists?|ast)$/.test(w)) { statCols = ["AST"]; statWord = "assists"; }
    else if (/^blocks?$/.test(w)) { statCols = ["BLK"]; statWord = "blocks"; }
    else if (/^steals?$/.test(w)) { statCols = ["STL"]; statWord = "steals"; }
    else if (/^hits?$/.test(w)) { statCols = ["H"]; statWord = "hits"; }
    else if (/^runs?$/.test(w)) { statCols = ["R"]; statWord = "runs"; }
    else if (/^rbis?$/.test(w)) { statCols = ["RBI"]; statWord = "RBIs"; }
    else if (/^(home runs?|homers?|hr)$/.test(w)) { statCols = ["HR"]; statWord = "home runs"; }
    else if (/^(strikeouts?|ks)$/.test(w)) { statCols = ["K", "SO"]; statWord = "strikeouts"; }
    else if (/^walks?$/.test(w)) { statCols = ["BB"]; statWord = "walks"; }
    else if (/^saves?$/.test(w)) { statCols = ["SV"]; statWord = "saves"; }
    else if (/^goals?$/.test(w)) { statCols = ["G"]; statWord = "goals"; }
    else if (/^(touchdowns?|tds?)$/.test(w)) { statCols = ["TD"]; statWord = "touchdowns"; }
    else if (/^(receptions?|catches)$/.test(w)) { statCols = ["REC"]; statWord = "receptions"; }
    else if (/^(yards?|yds)$/.test(w)) { statCols = ["YDS"]; statWord = "yards"; }
  }
  return { name, season, period, periodPhrase, opponent, statCols, statWord };
}

// Map a message's period reference to the friendly phrase StatMuse expects.
function extractPeriodPhrase(low: string): string | null {
  // Basketball quarters
  if (/\b(q1|1q|first quarter|1st quarter)\b/.test(low)) return "first quarter";
  if (/\b(q2|2q|second quarter|2nd quarter)\b/.test(low)) return "second quarter";
  if (/\b(q3|3q|third quarter|3rd quarter)\b/.test(low)) return "third quarter";
  if (/\b(q4|4q|fourth quarter|4th quarter)\b/.test(low)) return "fourth quarter";
  // Halves
  if (/\b(h1|1h|first half|1st half|halftime)\b/.test(low)) return "first half";
  if (/\b(h2|2h|second half|2nd half)\b/.test(low)) return "second half";
  // Hockey periods
  if (/\b(first period|1st period)\b/.test(low)) return "first period";
  if (/\b(second period|2nd period)\b/.test(low)) return "second period";
  if (/\b(third period|3rd period)\b/.test(low)) return "third period";
  // Baseball innings — normalize the ordinal to the word StatMuse expects.
  const inn = low.match(
    /\b(1st|2nd|3rd|[4-9]th|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth)\s+inning\b/,
  );
  if (inn) {
    const map: Record<string, string> = {
      "1st": "first", "2nd": "second", "3rd": "third", "4th": "fourth",
      "5th": "fifth", "6th": "sixth", "7th": "seventh", "8th": "eighth", "9th": "ninth",
    };
    return `${map[inn[1]] || inn[1]} inning`;
  }
  return null;
}

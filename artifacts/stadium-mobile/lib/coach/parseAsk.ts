/** Greenfield ask parsing — leg targets and build intent only. */

/** Accept "leg(s)" and common typos like "lag" / "lags" so board scan still runs. */
export const LEG_WORD = String.raw`l(?:eg|ag)s?`;

const PARLAY_BUILD_RE = new RegExp(
  String.raw`\b((?:\d{1,3})\s*[-\s]?\s*${LEG_WORD}\b|\b(?:build|make|create|give me|need|want)\b.{0,40}\bparlay\b|\bparlay\b)`,
  "i",
);

/**
 * Normalize "9 lag" → "9 leg" so props-only / market parsers that still say
 * `legs?` honor the same typo as parseRequestedLegs (phone: "9 lag NFL player
 * prop" was skipping propsOnly and staging spreads).
 */
export function normalizeCoachLegTypos(text: string | null | undefined): string {
  return String(text ?? "").replace(/\b(\d{1,3})\s*[-\s]?\s*lags?\b/gi, "$1 leg");
}

export function parseRequestedLegs(text: string): number {
  const raw = String(text || "");
  const m = raw.match(
    new RegExp(String.raw`\b(\d{1,3})\s*[-\s]?\s*${LEG_WORD}\b`, "i"),
  );
  if (m) {
    const n = parseInt(m[1]!, 10);
    if (Number.isFinite(n) && n > 0) return n;
  }
  // Phone: "give me 4 different ones" / "give me 4 NHL picks" — no "leg" word,
  // but still a fixed-count ticket ask (was falling through to freeform chat).
  const giveMe = raw.match(
    /\b(?:give\s+me|get\s+me|need|want)\s+(\d{1,3})\s+(?:different\s+)?(?:ones?|picks?|bets?|plays?)\b/i,
  );
  if (giveMe) {
    const n = parseInt(giveMe[1]!, 10);
    if (Number.isFinite(n) && n > 0) return n;
  }
  const sportPicks = raw.match(
    /\b(\d{1,3})\s+(?:different\s+)?(?:nhl|nfl|nba|mlb|wnba|ncaaf|ncaab|cfb|soccer)\s+picks?\b/i,
  );
  if (sportPicks) {
    const n = parseInt(sportPicks[1]!, 10);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return 0;
}

export function isParlayBuildAsk(text: string): boolean {
  const t = String(text || "").trim();
  if (!t) return false;
  if (parseRequestedLegs(t) > 0) return true;
  return PARLAY_BUILD_RE.test(t);
}

export function resolveBuildLegTarget(text: string): number {
  const explicit = parseRequestedLegs(text);
  if (explicit > 0) return Math.min(explicit, 25);
  if (isParlayBuildAsk(text)) return 6;
  return 0;
}

/** True when a staged pick is a team/game line (spread/total/ML), not a player prop. */
export function coachPickLooksLikeGameLine(p: {
  isProp?: boolean;
  market?: string | null;
}): boolean {
  const m = String(p.market ?? "").toUpperCase();
  // Phone screenshots: "1H ALT SPREAD", "Q2 SPREAD", "TOTAL", "2H ALT TOTAL".
  if (
    /\b(SPREAD|TOTAL|MONEYLINE|MONEY\s*LINE|PUCK\s*LINE|RUN\s*LINE)\b/.test(m) ||
    /(?:^|[\s/])(ML)(?:$|[\s/])/.test(m)
  ) {
    return true;
  }
  return !p.isProp;
}

function coachAskedForPlayerProps(text: string): boolean {
  const t = normalizeCoachLegTypos(text).toLowerCase();
  if (/\bno\s+(?:player\s+)?props?\b/.test(t) || /\bwithout\s+(?:player\s+)?props?\b/.test(t)) {
    return false;
  }
  // Phone: "4 leg NHL team prop" staged spreads correctly but this note claimed
  // the user asked for player props. Team props / game-lines asks are intentional.
  if (/\bteam\s+props?\b/.test(t) && !/\bplayer\s+props?\b/.test(t)) return false;
  if (/\bgame\s*lines?\s+only\b/.test(t) || /\bsides?\s+only\b/.test(t)) return false;
  if (/\bplayer\s+props?\b/.test(t)) return true;
  if (/\b\d{1,3}\s*leg\b[\s\w]{0,40}\bprops?\b/.test(t)) return true;
  // Slate-only N-leg ("5 leg for tomorrow") is props-only — still show why if
  // game lines leak past that gate.
  if (
    /\b\d{1,3}\s*[-\s]?\s*legs?\b/.test(t) &&
    /\b(today|tonight|tomorrow)\b/.test(t) &&
    !/\bparlay\b/.test(t) &&
    !/\b(nfl|nba|mlb|nhl|wnba|ncaaf|ncaab|cfb|soccer|football)\b/.test(t) &&
    !/\b(spread|total|moneyline|sides?|game\s*lines?)\b/.test(t)
  ) {
    return true;
  }
  // Phone: "5 leg soccer" → Asian spread shortfall — sport N-leg is props-only.
  if (
    /\b\d{1,3}\s*[-\s]?\s*legs?\b/.test(t) &&
    !/\bparlay\b/.test(t) &&
    /\b(soccer|nba|mlb|nhl|wnba|ncaab)\b/.test(t) &&
    !/\b(nfl|ncaaf|cfb|football)\b/.test(t) &&
    !/\b(spread|total|moneyline|sides?|game\s*lines?)\b/.test(t)
  ) {
    return true;
  }
  return false;
}

/**
 * Phone-visible lead when the user asked for player props but the ticket is
 * game lines (spreads/totals). Lead copy sits above pick cards so a leak is
 * diagnosable on-device (lag typo / propsOnly miss / team-scoped fill).
 */
export function coachPropsAskGameLineMismatchNote(opts: {
  askText?: string | null;
  propsOnly: boolean;
  picks: readonly { isProp?: boolean; market?: string | null }[];
}): string {
  const raw = String(opts.askText ?? "");
  if (!coachAskedForPlayerProps(raw)) return "";
  const gameLinePicks = opts.picks.filter((p) => coachPickLooksLikeGameLine(p));
  const propCount = opts.picks.length - gameLinePicks.length;
  const gameLineCount = gameLinePicks.length;
  if (opts.picks.length === 0 || gameLineCount <= 0) return "";
  const markets = [
    ...new Set(
      gameLinePicks
        .map((p) => String(p.market ?? "").trim())
        .filter(Boolean)
        .slice(0, 6),
    ),
  ];
  const marketBit = markets.length ? ` markets=${markets.join("|")}` : "";
  const askBit = JSON.stringify(normalizeCoachLegTypos(raw).slice(0, 80));
  if (opts.propsOnly) {
    return (
      `You asked for player props — props-only still staged team game lines ` +
      `(spreads/totals). ` +
      `[PROPS_ONLY_LEAKED_GAME_LINES: props=${propCount} gameLines=${gameLineCount}${marketBit}]`
    );
  }
  const legs = parseRequestedLegs(raw);
  return (
    `You asked for player props — this ticket staged team game lines ` +
    `(spreads/totals) instead of player props. ` +
    `[PROPS_ASK_GOT_GAME_LINES: propsOnly=false legs=${legs}` +
    ` props=${propCount} gameLines=${gameLineCount}${marketBit}` +
    ` ask=${askBit}]`
  );
}

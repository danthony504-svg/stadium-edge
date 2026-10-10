/**
 * Server-side Coach ask classification + Q&A gate.
 * Mirrors stadium-mobile parseAsk / live detection for fail-closed API checks.
 */

export const COACH_QA_SIGN_IN_MESSAGE = "Sign in to ask AI Coach questions.";
export const COACH_QA_SUBSCRIBE_MESSAGE = "Subscribe to unlock AI Coach answers.";

/** Accept "leg(s)" and common typos like "lag" / "lags". */
const LEG_WORD = String.raw`l(?:eg|ag)s?`;

const PARLAY_BUILD_RE = new RegExp(
  String.raw`\b((?:\d{1,3})\s*[-\s]?\s*${LEG_WORD}\b|\b(?:build|make|create|give me|need|want)\b.{0,40}\bparlay\b|\bparlay\b)`,
  "i",
);

export function parseRequestedLegs(text: string): number {
  const raw = String(text || "");
  const m = raw.match(
    new RegExp(String.raw`\b(\d{1,3})\s*[-\s]?\s*${LEG_WORD}\b`, "i"),
  );
  if (m) {
    const n = parseInt(m[1]!, 10);
    if (Number.isFinite(n) && n > 0) return n;
  }
  const giveMe = raw.match(
    /\b(?:give\s+me|get\s+me|need|want)\s+(\d{1,3})\s+(?:different\s+)?(?:ones?|picks?|bets?|plays?)\b/i,
  );
  if (giveMe) {
    const n = parseInt(giveMe[1]!, 10);
    if (Number.isFinite(n) && n > 0) return n;
  }
  const sportPicks = raw.match(
    /\b(\d{1,3})\s+(?:different\s+)?(?:nhl|nfl|nba|mlb|wnba|ncaaf|ncaab|cfb|soccer|ufc|mma|tennis)\s+picks?\b/i,
  );
  if (sportPicks) {
    const n = parseInt(sportPicks[1]!, 10);
    if (Number.isFinite(n) && n > 0) return n;
  }
  const barePicks = raw.match(/\b(\d{1,3})\s+(?:different\s+)?picks?\b/i);
  if (barePicks) {
    const n = parseInt(barePicks[1]!, 10);
    if (Number.isFinite(n) && n > 0) return n;
  }
  const propFamilyCount = raw.match(
    /\b(\d{1,3})\s+(?:(?:different\s+)?(?:player\s+)?props?\b|(?:anytime\s+)?(?:touchdowns?|tds?)\b|(?:home\s*runs?|hrs?|homers?)\b|(?:(?:rushing|receiving|passing)\s+yards?(?:\s+props?)?)\b)/i,
  );
  if (propFamilyCount) {
    const n = parseInt(propFamilyCount[1]!, 10);
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

/** Cap open Coach parlay targets at 15 legs (matches product HARD cap). */
export function resolveBuildLegTarget(text: string): number {
  const explicit = parseRequestedLegs(text);
  if (explicit > 0) return Math.min(explicit, 15);
  if (isParlayBuildAsk(text)) return 6;
  return 0;
}

/** Live / in-play asks are premium Q&A — not open parlays. */
export function wantsLiveCoachAsk(text?: string | null): boolean {
  const t = String(text ?? "").toLowerCase().trim();
  if (!t) return false;
  if (/\blive\s+bets?\b/.test(t)) return true;
  if (/\bbest\s+live\b/.test(t)) return true;
  if (/\blive\s+picks?\b/.test(t)) return true;
  if (/\blive\s+(?:nba|nfl|nhl|mlb|wnba|ncaaf|ncaab|soccer|tennis|ufc)\b/.test(t)) {
    return true;
  }
  if (/\b(?:nba|nfl|nhl|mlb|wnba|ncaaf|ncaab|soccer|tennis|ufc)\s+live\b/.test(t)) {
    return true;
  }
  if (/\b\d{1,3}\s+live\b/.test(t)) return true;
  if (/\blive\s+\d{1,3}\b/.test(t)) return true;
  if (/\bin[-\s]?play\b/.test(t)) return true;
  if (/\bin[-\s]?progress\s+(?:bets?|picks?|games?|odds|lines?)\b/.test(t)) {
    return true;
  }
  if (/\b(?:bets?|picks?|odds|lines?)\s+in[-\s]?progress\b/.test(t)) return true;
  if (
    /\blive\b/.test(t) &&
    /\b(bets?|betting|picks?|parlay|legs?|props?|moneylines?|spreads?|totals?)\b/.test(t)
  ) {
    return true;
  }
  return false;
}

/**
 * True when this ask may run without a subscription (1–15 leg parlay builds).
 * Live asks and photo analysis are never open.
 */
export function isOpenCoachParlayAsk(
  text: string,
  opts: { hasImages?: boolean } = {},
): boolean {
  if (opts.hasImages) return false;
  if (wantsLiveCoachAsk(text)) return false;
  if (!isParlayBuildAsk(text)) return false;
  const legs = resolveBuildLegTarget(text);
  return legs >= 1 && legs <= 15;
}

export type CoachQaGateResult =
  | { allowed: true; openParlay: boolean }
  | {
      allowed: false;
      status: 401 | 403;
      reason: "sign_in" | "subscribe";
      message: string;
    };

/**
 * Fail-closed Q&A gate for POST /chat.
 * Open parlays skip auth; everything else needs login + verified Go/Pro.
 */
export function resolveCoachQaGate(opts: {
  askText: string;
  hasImages?: boolean;
  signedIn: boolean;
  premiumUnlocked: boolean;
}): CoachQaGateResult {
  if (isOpenCoachParlayAsk(opts.askText, { hasImages: opts.hasImages })) {
    return { allowed: true, openParlay: true };
  }
  if (!opts.signedIn) {
    return {
      allowed: false,
      status: 401,
      reason: "sign_in",
      message: COACH_QA_SIGN_IN_MESSAGE,
    };
  }
  if (!opts.premiumUnlocked) {
    return {
      allowed: false,
      status: 403,
      reason: "subscribe",
      message: COACH_QA_SUBSCRIBE_MESSAGE,
    };
  }
  return { allowed: true, openParlay: false };
}

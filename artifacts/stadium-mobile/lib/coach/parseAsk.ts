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
  const m = String(text || "").match(
    new RegExp(String.raw`\b(\d{1,3})\s*[-\s]?\s*${LEG_WORD}\b`, "i"),
  );
  if (!m) return 0;
  const n = parseInt(m[1], 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
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

/**
 * Phone-visible reason when the user asked for player props but the ticket is
 * game lines (spreads/totals). Used when lag-typo / routing misses propsOnly.
 */
export function coachPropsAskGameLineMismatchNote(opts: {
  askText?: string | null;
  propsOnly: boolean;
  picks: readonly { isProp?: boolean }[];
}): string {
  const raw = String(opts.askText ?? "");
  const t = normalizeCoachLegTypos(raw).toLowerCase();
  if (!/\bplayer\s+props?\b/.test(t) && !/\b\d{1,3}\s*leg\b[\s\w]{0,30}\bprops?\b/.test(t)) {
    return "";
  }
  const propCount = opts.picks.filter((p) => !!p.isProp).length;
  const gameLineCount = opts.picks.length - propCount;
  if (opts.picks.length === 0 || gameLineCount <= 0) return "";
  if (propCount > 0 && gameLineCount === 0) return "";
  if (opts.propsOnly) {
    return ` [PROPS_ONLY_LEAKED_GAME_LINES: props=${propCount} gameLines=${gameLineCount}]`;
  }
  const legs = parseRequestedLegs(raw);
  return (
    ` [PROPS_ASK_GOT_GAME_LINES: propsOnly=false legs=${legs}` +
    ` props=${propCount} gameLines=${gameLineCount}` +
    ` ask=${JSON.stringify(normalizeCoachLegTypos(raw).slice(0, 80))}]`
  );
}

/**
 * Parse market constraints from Coach asks so "rushing and passing yards"
 * cannot stage rush attempts, receptions-count, INTs, or game totals.
 *
 * Sport scoping stays elsewhere. This module is market-only and does not
 * change hold / delivery / UI — only which markets may enter the scan pool
 * and survive final ticket selection.
 */

export type CoachAskMarketConstraint = {
  /** Stage props only — no ML / spread / total game lines. */
  propsOnly: boolean;
  /**
   * Allowed Odds API market keys (canonical, without `_alternate` / period suffix).
   * Empty array = no market allowlist (all props OK when propsOnly).
   * null = no market constraint at all.
   */
  allowedMarketKeys: string[] | null;
};

const RUSH_YARDS_KEYS = ["player_rush_yds"] as const;
const REC_YARDS_KEYS = ["player_reception_yds"] as const;
const PASS_YARDS_KEYS = ["player_pass_yds"] as const;

/** Strip alternate / period suffixes so allowlist checks stay stable. */
export function canonicalPropMarketKey(marketKey: string | null | undefined): string {
  let k = String(marketKey ?? "").trim().toLowerCase();
  if (!k) return "";
  if (k.endsWith("_alternate")) k = k.slice(0, -"_alternate".length);
  k = k.replace(/_(q1|q2|q3|q4|h1|h2|1h|2h|f5)$/i, "");
  return k;
}

/**
 * Pair skill words that share a trailing "yards" (or each name yards).
 * Does NOT treat "rushing yards and passing TDs" as pass-yards — yards must
 * bind to the skill word, not merely appear somewhere in the ask.
 */
function yardsScopesBothSidesOfAnd(t: string, left: RegExp, right: RegExp): boolean {
  const L = left.source;
  const R = right.source;
  // "rushing and passing yards" / "passing and receiving yards"
  const shared = new RegExp(
    `(?:${L})(?:\\s+\\w+){0,2}\\s+and\\s+(?:${R})(?:\\s+\\w+){0,2}\\s+yards?\\b`,
    "i",
  );
  const sharedRev = new RegExp(
    `(?:${R})(?:\\s+\\w+){0,2}\\s+and\\s+(?:${L})(?:\\s+\\w+){0,2}\\s+yards?\\b`,
    "i",
  );
  // "rushing yards and passing yards"
  const both = new RegExp(
    `(?:${L})\\s+yards?\\b[\\s\\S]{0,32}\\band\\b[\\s\\S]{0,32}(?:${R})\\s+yards?\\b`,
    "i",
  );
  const bothRev = new RegExp(
    `(?:${R})\\s+yards?\\b[\\s\\S]{0,32}\\band\\b[\\s\\S]{0,32}(?:${L})\\s+yards?\\b`,
    "i",
  );
  return shared.test(t) || sharedRev.test(t) || both.test(t) || bothRev.test(t);
}

/** "rushing, passing, and receiving yards" list form. */
function yardsFamilyListFlags(t: string): {
  rush: boolean;
  pass: boolean;
  rec: boolean;
} | null {
  const m = t.match(
    /\b((?:rush(?:ing)?|pass(?:ing)?|receiv\w*)(?:\s*,\s*(?:rush(?:ing)?|pass(?:ing)?|receiv\w*))+(?:\s*,?\s*and\s+(?:rush(?:ing)?|pass(?:ing)?|receiv\w*))?)\s+yards?\b/i,
  );
  if (!m) return null;
  const chunk = m[1].toLowerCase();
  return {
    rush: /rush/.test(chunk),
    pass: /pass/.test(chunk),
    rec: /receiv/.test(chunk),
  };
}

function hasRushYardsAsk(t: string): boolean {
  if (
    /\brush(?:ing)?\s+yards?\b/i.test(t) ||
    /\brush(?:ing)?\s+yds?\b/i.test(t)
  ) {
    return true;
  }
  const list = yardsFamilyListFlags(t);
  if (list?.rush) return true;
  return (
    yardsScopesBothSidesOfAnd(t, /\brush(?:ing)?\b/i, /\breceiv(?:ing|e|er)?\b/i) ||
    yardsScopesBothSidesOfAnd(t, /\brush(?:ing)?\b/i, /\bpass(?:ing)?\b/i)
  );
}

function hasRecYardsAsk(t: string): boolean {
  if (
    /\breceiv(?:ing|e)?\s+yards?\b/i.test(t) ||
    /\breception\s+yards?\b/i.test(t) ||
    /\brec(?:eiving)?\s+yds?\b/i.test(t)
  ) {
    return true;
  }
  const list = yardsFamilyListFlags(t);
  if (list?.rec) return true;
  return (
    yardsScopesBothSidesOfAnd(t, /\brush(?:ing)?\b/i, /\breceiv(?:ing|e|er)?\b/i) ||
    yardsScopesBothSidesOfAnd(t, /\bpass(?:ing)?\b/i, /\breceiv(?:ing|e|er)?\b/i)
  );
}

function hasPassYardsAsk(t: string): boolean {
  if (
    /\bpass(?:ing)?\s+yards?\b/i.test(t) ||
    /\bpass(?:ing)?\s+yds?\b/i.test(t)
  ) {
    return true;
  }
  const list = yardsFamilyListFlags(t);
  if (list?.pass) return true;
  return (
    yardsScopesBothSidesOfAnd(t, /\brush(?:ing)?\b/i, /\bpass(?:ing)?\b/i) ||
    yardsScopesBothSidesOfAnd(t, /\bpass(?:ing)?\b/i, /\breceiv(?:ing|e|er)?\b/i)
  );
}

/**
 * Market allowlist + props-only flag for a Coach ask.
 * Example: "10 lag rushing and passing yards"
 * → propsOnly + player_rush_yds + player_pass_yds (alts included via canonical key).
 */
export function parseCoachAskMarketConstraint(
  text: string | null | undefined,
): CoachAskMarketConstraint {
  const t = String(text ?? "").trim();
  if (!t) return { propsOnly: false, allowedMarketKeys: null };

  const rushYds = hasRushYardsAsk(t);
  const recYds = hasRecYardsAsk(t);
  const passYds = hasPassYardsAsk(t);

  if (rushYds || recYds || passYds) {
    const keys: string[] = [];
    if (rushYds) keys.push(...RUSH_YARDS_KEYS);
    if (recYds) keys.push(...REC_YARDS_KEYS);
    if (passYds) keys.push(...PASS_YARDS_KEYS);
    // Naming yards families means a yards-prop ticket — keep game lines out so
    // F5/TOTAL/ALT SPREAD cannot fill legs the user asked for as yards.
    return {
      propsOnly: true,
      allowedMarketKeys: keys,
    };
  }

  return { propsOnly: false, allowedMarketKeys: null };
}

export function propMarketKeyAllowed(
  marketKey: string | null | undefined,
  allowed: readonly string[] | null | undefined,
): boolean {
  if (!allowed || allowed.length === 0) return true;
  const canon = canonicalPropMarketKey(marketKey);
  if (!canon) return false;
  const allow = new Set(allowed.map((k) => canonicalPropMarketKey(k)));
  return allow.has(canon);
}

/** Filter posted prop-pool rows to the ask's market allowlist. */
export function filterPropPoolByAskMarkets<
  T extends { marketKey?: string | null },
>(pool: T[], allowed: readonly string[] | null | undefined): T[] {
  if (!allowed || allowed.length === 0) return pool;
  return pool.filter((row) => propMarketKeyAllowed(row.marketKey, allowed));
}

/** Final ticket defense: drop legs outside the allowlist (or non-props when props-only). */
export function filterPicksByAskMarketConstraint<
  T extends {
    isProp?: boolean;
    propMarketKey?: string | null;
    market?: string | null;
  },
>(picks: T[], constraint: CoachAskMarketConstraint): T[] {
  let out = picks;
  if (constraint.propsOnly) {
    out = out.filter((p) => !!p.isProp);
  }
  if (constraint.allowedMarketKeys && constraint.allowedMarketKeys.length > 0) {
    out = out.filter((p) =>
      propMarketKeyAllowed(p.propMarketKey ?? null, constraint.allowedMarketKeys),
    );
  }
  return out;
}

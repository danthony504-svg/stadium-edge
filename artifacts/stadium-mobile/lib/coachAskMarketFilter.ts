/**
 * Parse market constraints from Coach asks so "rushing and receiving yards only"
 * cannot stage rush attempts, receptions-count, or game totals.
 *
 * Sport scoping stays elsewhere (chatContextPriority). This module is market-only.
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

function hasRushYardsAsk(t: string): boolean {
  if (
    /\brush(?:ing)?\s+yards?\b/i.test(t) ||
    /\brush(?:ing)?\s+yds?\b/i.test(t)
  ) {
    return true;
  }
  // "rushing and receiving yards" — yards applies to both sides of the "and".
  return (
    /\byards?\b/i.test(t) &&
    /\brush(?:ing)?\b/i.test(t) &&
    /\brush(?:ing)?\b[\s\S]{0,48}\band\b[\s\S]{0,24}\breceiv/i.test(t)
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
  return (
    /\byards?\b/i.test(t) &&
    /\breceiv/i.test(t) &&
    (/\brush(?:ing)?\b[\s\S]{0,48}\band\b[\s\S]{0,24}\breceiv/i.test(t) ||
      /\breceiv[\s\S]{0,48}\band\b[\s\S]{0,24}\brush(?:ing)?\b/i.test(t))
  );
}

function hasPassYardsAsk(t: string): boolean {
  return (
    /\bpass(?:ing)?\s+yards?\b/i.test(t) ||
    /\bpass(?:ing)?\s+yds?\b/i.test(t)
  );
}

function yardsOnlyPhrase(t: string): boolean {
  return /\byards?\s+only\b/i.test(t) || /\bonly\s+(?:rush|pass|rec|receiv)/i.test(t);
}

/**
 * Market allowlist + props-only flag for a Coach ask.
 * Example: "5 leg NFL rushing and receiving yards only"
 * → propsOnly + player_rush_yds + player_reception_yds (alts included via canonical key).
 */
export function parseCoachAskMarketConstraint(
  text: string | null | undefined,
): CoachAskMarketConstraint {
  const t = String(text ?? "").trim();
  if (!t) return { propsOnly: false, allowedMarketKeys: null };

  const rushYds = hasRushYardsAsk(t);
  const recYds = hasRecYardsAsk(t);
  const passYds = hasPassYardsAsk(t);
  const yardsOnly = yardsOnlyPhrase(t);

  // Explicit yards families (optionally "… yards only").
  if (rushYds || recYds || passYds) {
    const keys: string[] = [];
    if (rushYds) keys.push(...RUSH_YARDS_KEYS);
    if (recYds) keys.push(...REC_YARDS_KEYS);
    if (passYds) keys.push(...PASS_YARDS_KEYS);
    // "… yards only" / "… only" → props-only ticket (no ML/totals).
    // Naming yards without "only" still allowlists those keys but can mix game lines.
    const propsOnly = yardsOnly || /\bonly\b/i.test(t);
    return {
      propsOnly,
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
  T extends { marketKey?: string | null; marketLabel?: string | null },
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

/**
 * User-facing shortfall copy when an explicit market lock graded real
 * candidates but fewer than requested cleared AI quality requirements.
 *
 * Copy/UI only — does not change selection, thresholds, or market lock.
 * Display names come from ExplicitMarketLockRule.label (canonical mapping).
 */

import { matchExplicitMarketLocks } from "./explicitMarketLock.ts";

/**
 * Resolve the canonical lock label for an ask, or null when unlocked.
 * Uses EXPLICIT_MARKET_LOCK_RULES via matchExplicitMarketLocks — no second list.
 */
export function lockedMarketLabelForAsk(
  ask: string | null | undefined,
): string | null {
  const labels = matchExplicitMarketLocks(ask)?.labels;
  if (!labels?.length) return null;
  const label = String(labels[0] ?? "").trim();
  return label || null;
}

/**
 * Turn canonical lock label into "... picks" phrase.
 * Inflection only — not a parallel market catalog.
 */
export function lockedMarketPickPhrase(label: string): string {
  const raw = String(label ?? "").trim();
  if (!raw) return "picks";
  // Combo labels (pts+reb+ast) / "combo props" read fine as-is.
  if (/\+|combo/i.test(raw)) return `${raw} picks`;

  const words = raw.split(/\s+/).filter(Boolean);
  const last = words[words.length - 1]!;
  // Keep unit / invariant plurals from lock labels (yards, bases, …).
  if (/^(yards|bases|points|threes|odds)$/i.test(last)) {
    return `${raw} picks`;
  }
  if (/ies$/i.test(last)) {
    words[words.length - 1] = last.replace(/ies$/i, "y");
  } else if (/s$/i.test(last) && !/ss$/i.test(last) && last.length > 1) {
    words[words.length - 1] = last.slice(0, -1);
  }
  return `${words.join(" ")} picks`;
}

export type LockedMarketQualityShortfallOpts = {
  /** Requested leg count (2–15). */
  requestedLegs: number;
  /** Props graded/analyzed in the locked market. */
  analyzed: number;
  /** Legs that cleared quality and are shown. */
  qualified: number;
  /** Human lock label from ExplicitMarketLockRule (e.g. "touchdowns"). */
  marketLabel: string;
};

/**
 * Honest shortfall note for locked-market underfills.
 * Returns "" when there is nothing useful to say (no analyzed candidates),
 * or when the ticket already met the requested count (N/N).
 */
export function lockedMarketQualityShortfallNote(
  opts: LockedMarketQualityShortfallOpts,
): string {
  const requested = Math.max(0, Math.floor(opts.requestedLegs));
  const analyzed = Math.max(0, Math.floor(opts.analyzed));
  const qualified = Math.max(0, Math.floor(opts.qualified));
  if (analyzed <= 0) return "";

  const phrase = lockedMarketPickPhrase(opts.marketLabel);

  if (qualified <= 0) {
    return (
      `I found and analyzed ${analyzed} ${phrase} for tonight, but none met Stadium Edge's quality standards. ` +
      `I won't add weaker picks just to fill your ${requested}-leg request.`
    );
  }

  if (qualified < requested) {
    return (
      `You asked for ${requested} ${phrase}. ` +
      `I found ${qualified} that met Stadium Edge's quality standards, ` +
      `so I'm showing ${qualified} instead of adding weaker picks.`
    );
  }

  return "";
}
